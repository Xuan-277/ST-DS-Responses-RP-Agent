/*! DS Responses Tester
 * Copyright (C) 2026 <YOUR-NAME>
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, version 3.
 * See the LICENSE file for details.
 */

/**
 * DS Responses Tester v0.1.2 — 探测 DeepSeek /responses 端点的方言
 *
 * 五个测试：
 *  1. 连通性 + input 方言（字符串 / 数组 / 简版数组）
 *  2. 流式 SSE（失败自动降级：不带 stream 做对照）
 *  3. 链式调用（store 失败自动降级：不带 store 重试）
 *  4. 推理模型（先拉 /models 核对模型名，自动纠正）
 *  5. 模型列表（GET /models，展示全部可用模型）
 *
 * 所有失败都会把完整错误响应体记入 lastRaw，「复制原始响应」可导出。
 */

const MODULE_NAME = 'ds-responses-test';
const DEFAULTS = {
    baseUrl: 'https://api.deepseek.com',
    apiKey: '',
    model: 'DeepSeek V4 Pro',
    reasoningModel: 'DeepSeek V4 Pro',
};

try {
    const ctx = SillyTavern.getContext();
    // getContext() 暴露的是 extensionSettings（驼峰），不是 extension_settings
    const extSettings = ctx.extensionSettings ?? ctx.extension_settings;
    if (!extSettings) throw new Error('getContext() 里找不到 extensionSettings');
    const settings = extSettings[MODULE_NAME] ?? (extSettings[MODULE_NAME] = {});
    for (const [k, v] of Object.entries(DEFAULTS)) {
        if (settings[k] === undefined) settings[k] = v;
    }
    // 同步 DSRP 主扩展配置——仅当 Tester 自己没有配置时（防止覆盖用户自定义的中转站）
    const dsrp = extSettings['ds-responses-rp'];
    if (dsrp) {
        if (!settings.apiKey && dsrp.apiKey) settings.apiKey = dsrp.apiKey;
        if (!settings.baseUrl || settings.baseUrl === 'https://api.deepseek.com') {
            // 只在 Tester 还是默认值或空时才同步
            if (dsrp.baseUrl) settings.baseUrl = dsrp.baseUrl;
        }
        if (!settings.model || settings.model === 'deepseek-v4-pro') {
            if (dsrp.model) settings.model = dsrp.model;
        }
        if (!settings.reasoningModel || settings.reasoningModel === 'deepseek-v4-flash') {
            if (dsrp.fastModel) settings.reasoningModel = dsrp.fastModel;
        }
    }
    window.__dsrt = { ctx, settings }; // 便于控制台调试
    bootstrap(ctx, settings);
} catch (e) {
    console.error('[DSRT] 扩展初始化失败:', e);
    try {
        if (typeof toastr !== 'undefined') {
            toastr.error('DS Responses Tester 加载失败: ' + (e?.message ?? e));
        }
    } catch { /* ignore */ }
}

function bootstrap(ctx, settings) {

    /** 保存最近一次原始响应（按测试编号），供「复制原始响应」用 */
    const lastRaw = {};
    let running = false;

    /* ---------------------------------------------------------------- 日志 ---- */

    function ts() {
        return new Date().toLocaleTimeString('zh-CN', { hour12: false });
    }

    function log(msg, cls = '') {
        const box = $('#dsrt_log');
        if (box.length) {
            box.append(`<div class="dsrt-line dsrt-${cls}"><span class="dsrt-time">[${ts()}]</span> ${msg}</div>`);
            box.scrollTop(box[0].scrollHeight);
        }
        console.log(`[DSRT] ${msg.replace(/<[^>]+>/g, '')}`);
    }

    function esc(s) {
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function preview(obj, max = 600) {
        let s;
        try { s = JSON.stringify(obj); } catch { s = String(obj); }
        return s.length > max ? s.slice(0, max) + '…' : s;
    }

    /* --------------------------------------------------------------- 请求 ---- */

    /** API URL：官方直连（CORS 支持），中转站走 ST /proxy/（绕过 CORS） */
    function apiUrl(path) {
        const base = String(settings.baseUrl).replace(/\/+$/, '');
        if (base.includes('api.deepseek.com')) return base + path;
        return location.origin + '/proxy/' + base + path;
    }

    async function dsFetch(body, timeoutMs = 120000) {
        const headers = { 'Content-Type': 'application/json' };
        if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
        // 走 /proxy/ 时带 ST 会话鉴权
        if (!apiUrl('/x').includes('api.deepseek.com')) {
            try { Object.assign(headers, ctx.getRequestHeaders()); } catch { /* noop */ }
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        try {
            return await fetch(apiUrl('/responses'), {
                method: 'POST',
                headers,
                body: JSON.stringify(body),
                signal: ctrl.signal,
            });
        } finally {
            clearTimeout(timer);
        }
    }

    /** 读取错误响应：完整存入 lastRaw[slot]，日志里显示前 500 字 */
    async function readError(resp, slot) {
        let body = '';
        try { body = await resp.text(); } catch { /* ignore */ }
        if (slot) lastRaw[slot] = { httpStatus: resp.status, statusText: resp.statusText, errorBody: body.slice(0, 3000) };
        return `HTTP ${resp.status} ${resp.statusText} — ${esc(body.slice(0, 500))}`;
    }

    function failHint(e) {
        if (e instanceof TypeError) {
            return '网络层失败（TypeError）：可能是 CORS / 断网 / 域名解析。打开浏览器控制台(F12)看具体报错。';
        }
        if (e.name === 'AbortError') return '请求超时被中止。';
        return `异常: ${esc(e?.message ?? e)}`;
    }

    /** 从 responses 响应对象里尽力抽出正文文本（兼容多种可能的方言） */
    function extractText(resp) {
        const found = [];
        if (typeof resp.output_text === 'string') found.push({ via: 'output_text', text: resp.output_text });
        if (Array.isArray(resp.output)) {
            for (const item of resp.output) {
                if (typeof item?.content === 'string') found.push({ via: `output[${item.type}].content(string)`, text: item.content });
                if (Array.isArray(item?.content)) {
                    for (const c of item.content) {
                        if (typeof c?.text === 'string' && (c.type === undefined || String(c.type).includes('text'))) {
                            found.push({ via: `output[${item.type}].content[${c.type}]`, text: c.text });
                        }
                    }
                }
                if (typeof item?.text === 'string') found.push({ via: `output[${item.type}].text`, text: item.text });
            }
        }
        if (Array.isArray(resp.choices) && resp.choices[0]?.message?.content) {
            found.push({ via: 'choices[0].message.content', text: resp.choices[0].message.content });
        }
        return found;
    }

    /** 抽出推理/思考内容（reasoner 方言探测） */
    function extractReasoning(resp) {
        const out = [];
        if (Array.isArray(resp.output)) {
            for (const item of resp.output) {
                const t = String(item?.type ?? '');
                if (t.includes('reasoning')) {
                    out.push({ via: `output[${t}]`, summary: item.summary ?? null, text: (typeof item.text === 'string' ? item.text.slice(0, 150) : item.text ?? null), keys: Object.keys(item) });
                }
            }
        }
        for (const k of ['reasoning_content', 'reasoning']) {
            if (typeof resp[k] === 'string' && resp[k]) out.push({ via: `resp.${k}`, len: resp[k].length, head: resp[k].slice(0, 150) });
        }
        if (Array.isArray(resp.choices) && resp.choices[0]?.message) {
            const m = resp.choices[0].message;
            for (const k of ['reasoning_content', 'reasoning']) {
                if (typeof m[k] === 'string' && m[k]) out.push({ via: `choices[0].message.${k}`, len: m[k].length, head: m[k].slice(0, 150) });
            }
        }
        return out;
    }

    /* ------------------------------------------------------- 模型列表 ---- */

    /** GET /models，返回模型 ID 数组（失败返回 null） */
    async function fetchModels(slot) {
        try {
            const headers = {};
            if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
            const resp = await fetch(apiUrl('/models'), { headers });
            if (!resp.ok) {
                log(`  ✗ GET /models 失败：${await readError(resp, slot)}`, 'bad');
                return null;
            }
            const data = await resp.json();
            if (slot) lastRaw[slot] = data;
            const ids = (data.data ?? data.models ?? [])
                .map(m => m?.id ?? m?.name ?? (typeof m === 'string' ? m : null))
                .filter(x => typeof x === 'string');
            return ids;
        } catch (e) {
            log(`  ✗ GET /models ${failHint(e)}`, 'bad');
            return null;
        }
    }

    /** 测试 5: 模型列表 */
    async function test5() {
        log('▶ 测试 5：模型列表（GET /models）', 'head');
        const ids = await fetchModels(5);
        if (!ids) return null;
        if (!ids.length) {
            log('  ⚠ 响应里没找到模型列表字段', 'warn');
            return null;
        }
        log(`  ✓ 共 ${ids.length} 个模型可用:`, 'good');
        for (const id of ids) log(`    - ${esc(id)}`);
        return ids;
    }

    /* --------------------------------------------------------------- 测试 ---- */

    /** 测试 1: 连通性 + input 方言探测 */
    async function test1() {
        log('▶ 测试 1：连通性 + input 方言探测', 'head');
        const base = { model: settings.model, store: false };
        const forms = [
            { label: 'input=字符串', body: { ...base, input: '只回复两个字：收到' } },
            { label: 'input=消息数组', body: { ...base, input: [{ role: 'user', content: [{ type: 'input_text', text: '只回复两个字：收到' }] }] } },
            { label: 'input=简版消息数组', body: { ...base, input: [{ role: 'user', content: '只回复两个字：收到' }] } },
        ];
        for (const f of forms) {
            log(`  尝试 ${f.label} …`);
            try {
                const t0 = performance.now();
                const resp = await dsFetch(f.body);
                const ms = Math.round(performance.now() - t0);
                if (!resp.ok) {
                    log(`  ✗ ${f.label} 失败：${await readError(resp, `1-${f.label}`)}`, 'bad');
                    continue;
                }
                const data = await resp.json();
                lastRaw[1] = data;
                const texts = extractText(data);
                log(`  ✓ ${f.label} 可用（HTTP 200, ${ms}ms）`, 'good');
                log(`    响应顶层字段: ${esc(Object.keys(data).join(', '))}`);
                log(`    response.id: ${esc(data.id ?? '(无)')}  status: ${esc(data.status ?? '(无)')}`);
                for (const t of texts) log(`    文本(${t.via}): ${esc(t.text.slice(0, 80))}`);
                if (!texts.length) log(`    ⚠ 没找到文本字段！原始响应: ${preview(data)}`, 'warn');
                if (data.usage) log(`    usage: ${preview(data.usage, 200)}`);
                log(`  → 后续测试将使用「${f.label}」形式`, 'info');
                settings.workingInputForm = f.label;
                try { ctx.saveSettings(); } catch { try { ctx.saveSettingsDebounced(); } catch { /* ignore */ } }
                return f.label;
            } catch (e) {
                log(`  ✗ ${f.label} ${failHint(e)}`, 'bad');
            }
        }
        log('  三种 input 形式全部失败，测试终止。', 'bad');
        return null;
    }

    function buildInput(formLabel, text) {
        if (formLabel === 'input=消息数组') return [{ role: 'user', content: [{ type: 'input_text', text }] }];
        if (formLabel === 'input=简版消息数组') return [{ role: 'user', content: text }];
        return text;
    }

    /** 测试 2: 流式 SSE 方言（失败自动降级对照） */
    async function test2(formLabel) {
        log('▶ 测试 2：流式 SSE 探测', 'head');
        const body = {
            model: settings.model,
            input: buildInput(formLabel, '从 1 数到 10，每个数字单独一行。'),
            stream: true,
            store: false,
        };
        let resp;
        try {
            resp = await dsFetch(body);
        } catch (e) {
            log(`  ✗ ${failHint(e)}`, 'bad');
            return;
        }
        if (!resp.ok) {
            log(`  ✗ stream:true 被拒：${await readError(resp, '2-stream-rejected')}`, 'bad');
            log('  ↓ 降级对照：用非流式请求确认端点本身还活着 …', 'info');
            try {
                const r2 = await dsFetch({ model: settings.model, input: buildInput(formLabel, '只回复：收到'), store: false });
                if (r2.ok) {
                    const d = await r2.json();
                    lastRaw['2-fallback-nonstream'] = d;
                    log('  ✓ 非流式正常 —— 结论：该端点【不支持 stream 参数】或流式路径故障', 'warn');
                    log('    → 翻译层对策：正文调用走非流式（ST 端表现为整段输出）', 'info');
                } else {
                    log(`  ✗ 非流式对照也失败：${await readError(r2, '2-fallback-failed')}`, 'bad');
                }
            } catch (e) {
                log(`  ✗ 对照请求 ${failHint(e)}`, 'bad');
            }
            return;
        }
        if (!resp.body) {
            log('  ⚠ 响应没有 body 流（可能不支持流式，直接返回了完整 JSON）', 'warn');
            const data = await resp.json().catch(() => ({}));
            lastRaw[2] = data;
            log(`    完整响应: ${preview(data)}`);
            return;
        }
        const reader = resp.body.getReader();
        const dec = new TextDecoder();
        const eventTypes = new Set();
        let buf = '';
        let assembled = '';
        let finalResp = null;
        let ttft = null;
        const t0 = performance.now();

        const handleDataLine = (line) => {
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') return;
            let ev;
            try { ev = JSON.parse(payload); } catch { return; }
            const t = String(ev.type ?? '(no type)');
            eventTypes.add(t);
            if (typeof ev.delta === 'string' && (t.includes('delta') || t.includes('output_text'))) {
                if (ttft === null && ev.delta) ttft = Math.round(performance.now() - t0);
                assembled += ev.delta;
            }
            if (t.includes('completed') || t.includes('done')) {
                finalResp = ev.response ?? ev;
            }
            if (Array.isArray(ev.choices) && typeof ev.choices[0]?.delta?.content === 'string') {
                assembled += ev.choices[0].delta.content;
            }
        };

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += dec.decode(value, { stream: true });
                const lines = buf.split(/\r?\n/);
                buf = lines.pop() ?? '';
                for (const line of lines) {
                    if (line.startsWith('data:')) handleDataLine(line);
                }
            }
            if (buf.startsWith('data:')) handleDataLine(buf);
        } catch (e) {
            log(`  ✗ 流读取中断：${failHint(e)}`, 'bad');
        }
        const totalMs = Math.round(performance.now() - t0);
        lastRaw[2] = finalResp ?? { eventTypes: [...eventTypes], assembled };
        log(`  ✓ 流结束，总耗时 ${totalMs}ms${ttft !== null ? `，首字延迟 ${ttft}ms` : '（未捕获到文本增量）'}`, 'good');
        log(`  事件类型清单(${eventTypes.size}): ${esc([...eventTypes].join(' | '))}`);
        log(`  增量拼接结果(${assembled.length}字): ${esc(assembled.slice(0, 100))}`);
        if (finalResp) {
            const texts = extractText(finalResp);
            for (const t of texts) log(`  完成事件的最终文本(${t.via}): ${esc(t.text.slice(0, 100))}`);
            if (finalResp.usage) log(`  usage: ${preview(finalResp.usage, 200)}`);
            const assembledN = assembled.replace(/\s+/g, '');
            const finalN = (texts[0]?.text ?? '').replace(/\s+/g, '');
            if (assembledN && finalN && assembledN !== finalN) {
                log('  ⚠ 增量拼接 ≠ 最终文本，翻译层需要注意两者取舍', 'warn');
            }
        } else {
            log('  ⚠ 没收到 completed 类事件（或其中不含 response 对象）', 'warn');
        }
    }

    /** 测试 3: 链式调用（store 失败自动降级） */
    async function test3(formLabel) {
        log('▶ 测试 3：链式调用（previous_response_id）', 'head');
        let resp;
        try {
            resp = await dsFetch({ model: settings.model, input: buildInput(formLabel, '我的名字叫小明。请记住这个名字。'), store: true });
        } catch (e) {
            log(`  ✗ 第一跳 ${failHint(e)}`, 'bad');
            return;
        }
        if (!resp.ok) {
            log(`  ✗ 第一跳失败（store:true 被拒）：${await readError(resp, '3-store-rejected')}`, 'bad');
            log('  ↓ 降级：不带 store 参数重试第一跳 …', 'info');
            try {
                resp = await dsFetch({ model: settings.model, input: buildInput(formLabel, '我的名字叫小明。请记住这个名字。') });
            } catch (e) {
                log(`  ✗ 降级第一跳 ${failHint(e)}`, 'bad');
                return;
            }
            if (!resp.ok) {
                log(`  ✗ 不带 store 也失败：${await readError(resp, '3-nostore-failed')}`, 'bad');
                return;
            }
            log('  ✓ 不带 store 的第一跳成功（store 参数不被支持，先继续测链式）', 'warn');
        }
        const d1 = await resp.json();
        lastRaw[3] = { first: d1 };
        if (!d1.id) {
            log(`  ⚠ 响应里没有 id，无法链式。顶层字段: ${esc(Object.keys(d1).join(', '))}`, 'warn');
            return;
        }
        log(`  ✓ 第一跳 OK，response.id = ${esc(d1.id)}`, 'good');
        try {
            resp = await dsFetch({ model: settings.model, input: buildInput(formLabel, '我叫什么名字？'), previous_response_id: d1.id });
        } catch (e) {
            log(`  ✗ 第二跳 ${failHint(e)}`, 'bad');
            return;
        }
        if (!resp.ok) {
            log(`  ✗ 第二跳失败（previous_response_id 被拒）：${await readError(resp, '3-previd-rejected')}`, 'bad');
            log('  → 结论：链式调用不可用。流水线降级为显式文本传递——A/B 的产物直接拼进后续调用的 prompt，架构不变。', 'warn');
            return;
        }
        const d2 = await resp.json();
        lastRaw[3].second = d2;
        const texts = extractText(d2);
        const answer = texts.map(t => t.text).join(' ');
        log(`  第二跳回答: ${esc(answer.slice(0, 120))}`);
        if (answer.includes('小明')) {
            log('  ✓✓ 链式记忆成立：previous_response_id 可用！A→B→C 回合内链可以白嫖长思考', 'good');
        } else {
            log('  ⚠ 调用成功但回答里没有「小明」——链可能没接上，或模型自己忘了。看原始响应判断。', 'warn');
        }
    }

    /** 测试 4: 推理模型（先核对模型名） */
    async function test4(formLabel) {
        log('▶ 测试 4：推理模型思考内容格式', 'head');
        let model = settings.reasoningModel;
        // 先拉模型列表核对名字
        log('  先拉 /models 核对模型名 …');
        const ids = await fetchModels('4-models');
        if (ids && ids.length) {
            const norm = s => String(s).toLowerCase().replace(/[\s_-]/g, '');
            const exact = ids.find(id => norm(id) === norm(model));
            if (exact && exact !== model) {
                log(`  ⚠ 配置名「${esc(model)}」实际 ID 是「${esc(exact)}」，自动改用`, 'warn');
                model = exact;
            } else if (!exact) {
                const candidate = ids.find(id => /reasoner|r1|thinking/i.test(id))
                    ?? ids.find(id => /v4|deepseek/i.test(id))
                    ?? ids[0];
                log(`  ⚠ 配置的「${esc(model)}」不在模型列表里，自动改用「${esc(candidate)}」`, 'warn');
                model = candidate;
            } else {
                log(`  ✓ 模型「${esc(model)}」在列表中`, 'good');
            }
        } else {
            log('  ⚠ 拉不到模型列表，按配置的名字直接测', 'warn');
        }
        log(`  用模型 ${esc(model)} 发起推理请求（9.11 vs 9.9）…`);
        let resp;
        try {
            resp = await dsFetch({
                model,
                input: buildInput(formLabel, '9.11 和 9.9 哪个大？'),
                store: false,
            }, 180000);
        } catch (e) {
            log(`  ✗ ${failHint(e)}`, 'bad');
            return;
        }
        if (!resp.ok) {
            log(`  ✗ ${await readError(resp, '4-reasoner-failed')}`, 'bad');
            return;
        }
        const data = await resp.json();
        lastRaw[4] = data;
        log(`  ✓ HTTP 200，顶层字段: ${esc(Object.keys(data).join(', '))}`);
        if (Array.isArray(data.output)) {
            log(`  output 共 ${data.output.length} 项: ${esc(data.output.map(i => i.type).join(' | '))}`);
        }
        const reasoning = extractReasoning(data);
        if (reasoning.length) {
            for (const r of reasoning) log(`  ✓ 思考内容(${r.via}): ${preview(r, 260)}`, 'good');
            log('  → 翻译层需要把思考内容映射到 ST 的 reasoning_content 显示链路', 'info');
        } else {
            log('  ⚠ 没探测到思考内容字段（可能被过滤，或方言不同）。看原始响应。', 'warn');
        }
        const texts = extractText(data);
        for (const t of texts) log(`  正文(${t.via}): ${esc(t.text.slice(0, 80))}`);
        if (data.usage) log(`  usage: ${preview(data.usage, 200)}`);
    }

    /* --------------------------------------------------------------- 编排 ---- */

    async function runAll() {
        if (running) { toastr.warning('测试正在运行中'); return; }
        running = true;
        $('#dsrt_log').empty();
        $('.dsrt-run-btn').prop('disabled', true);
        try {
            if (!settings.apiKey) {
                log('✗ 请先在面板里填入 API Key', 'bad');
                toastr.error('缺少 API Key');
                return;
            }
            log(`目标: ${esc(settings.baseUrl)}/responses  模型: ${esc(settings.model)} / ${esc(settings.reasoningModel)}`, 'info');
            const form = await test1();
            if (!form) return;
            await test2(form);
            await test3(form);
            await test4(form);
            await test5();
            log('—— 全部测试完成。「复制原始响应」可导出各测试的原始 JSON ——', 'head');
            toastr.success('Responses 测试完成');
        } finally {
            running = false;
            $('.dsrt-run-btn').prop('disabled', false);
        }
    }

    async function runSingle(n) {
        if (running) { toastr.warning('测试正在运行中'); return; }
        running = true;
        $('.dsrt-run-btn').prop('disabled', true);
        try {
            if (!settings.apiKey) { log('✗ 请先填 API Key', 'bad'); return; }
            if (n === 5) { await test5(); return; }
            if (!settings.workingInputForm && n !== 1) {
                log('先跑测试 1 确定 input 方言，再跑其他测试。', 'warn');
                return;
            }
            if (n === 1) await test1();
            if (n === 2) await test2(settings.workingInputForm);
            if (n === 3) await test3(settings.workingInputForm);
            if (n === 4) await test4(settings.workingInputForm);
        } finally {
            running = false;
            $('.dsrt-run-btn').prop('disabled', false);
        }
    }

    /* ----------------------------------------------------------------- UI ---- */

    const PANEL_HTML = `
<div class="dsrt-panel">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>DS Responses Tester</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
    <details>
        <summary>高级覆盖（默认复用 DSRP 主面板配置）</summary>
        <div class="dsrt-inner">
            <label class="dsrt-label">Base URL（自动拼 /responses）
                <input id="dsrt_baseurl" class="text_pole textarea_compact dsrt-input" type="text" placeholder="https://api.deepseek.com"/>
            </label>
            <label class="dsrt-label">API Key
                <input id="dsrt_apikey" class="text_pole textarea_compact dsrt-input" type="password" placeholder="sk-..."/>
            </label>
            <label class="dsrt-label">对话模型
                <input id="dsrt_model" class="text_pole textarea_compact dsrt-input" type="text" placeholder="deepseek-v4-pro"/>
            </label>
            <label class="dsrt-label">推理模型
                <input id="dsrt_rmodel" class="text_pole textarea_compact dsrt-input" type="text" placeholder="deepseek-v4-pro"/>
            </label>
        </div>
    </details>
    <div class="dsrt-btnrow">
        <div id="dsrt_run_all" class="menu_button dsrt-run-btn dsrt-wide">▶ 全部测试</div>
    </div>
    <div class="dsrt-btnrow">
        <div id="dsrt_t1" class="menu_button dsrt-run-btn">1 连通</div>
        <div id="dsrt_t2" class="menu_button dsrt-run-btn">2 流式</div>
        <div id="dsrt_t3" class="menu_button dsrt-run-btn">3 链式</div>
        <div id="dsrt_t4" class="menu_button dsrt-run-btn">4 推理</div>
        <div id="dsrt_t5" class="menu_button dsrt-run-btn">5 模型</div>
    </div>
    <div class="dsrt-btnrow">
        <div id="dsrt_copy" class="menu_button">复制原始响应</div>
        <div id="dsrt_clear" class="menu_button">清空日志</div>
    </div>
    <div id="dsrt_log" class="dsrt-log"></div>
    <div class="dsrt-hint">
        连接信息自动复用 DSRP 主面板的配置；改这里的值只影响测试器本身。
    </div>
        </div>
    </div>
</div>`;

    function addPanel() {
        if ($('#dsrt_log').length) return;
        // 优先挂载到 DSRP 主面板内的容器（主扩展就绪后拉取）
        // 回退：DSRP 未加载时挂到扩展区（独立显示）
        const tryMount = (attempts) => {
            const mount = $('#dsrp_tester_mount');
            if (mount.length) {
                mount.append(PANEL_HTML);
                bindPanel();
                return;
            }
            if (attempts > 0) {
                setTimeout(() => tryMount(attempts - 1), 500);
            } else {
                // DSRP 不在（比如被禁用）——独立显示
                $('#extensions_settings').append(PANEL_HTML);
                bindPanel();
            }
        };
        tryMount(6);
        return;
    }

    function bindPanel() {
        $('#dsrt_baseurl').val(settings.baseUrl).on('input change', function () {
            settings.baseUrl = String($(this).val()).trim();
            ctx.saveSettingsDebounced();
        });
        $('#dsrt_apikey').val(settings.apiKey).on('input change', function () {
            settings.apiKey = String($(this).val()).trim();
            ctx.saveSettingsDebounced();
        });
        $('#dsrt_model').val(settings.model).on('input change', function () {
            settings.model = String($(this).val()).trim();
            ctx.saveSettingsDebounced();
        });
        $('#dsrt_rmodel').val(settings.reasoningModel).on('input change', function () {
            settings.reasoningModel = String($(this).val()).trim();
            ctx.saveSettingsDebounced();
        });
        $('#dsrt_run_all').on('click', () => runAll().catch(e => log(failHint(e), 'bad')));
        $('#dsrt_t1').on('click', () => runSingle(1).catch(e => log(failHint(e), 'bad')));
        $('#dsrt_t2').on('click', () => runSingle(2).catch(e => log(failHint(e), 'bad')));
        $('#dsrt_t3').on('click', () => runSingle(3).catch(e => log(failHint(e), 'bad')));
        $('#dsrt_t4').on('click', () => runSingle(4).catch(e => log(failHint(e), 'bad')));
        $('#dsrt_t5').on('click', () => runSingle(5).catch(e => log(failHint(e), 'bad')));
        $('#dsrt_clear').on('click', () => $('#dsrt_log').empty());
        $('#dsrt_copy').on('click', async () => {
            try {
                await navigator.clipboard.writeText(JSON.stringify(lastRaw, null, 2));
                toastr.success('已复制到剪贴板');
            } catch {
                console.log('[DSRT] lastRaw =', lastRaw);
                toastr.info('复制失败，已打印到控制台(F12)');
            }
        });
        log('面板就绪（v0.1.2）。填好 Key 后点「全部测试」。', 'info');
    }

    /* ------------------------------------------------------- slash 命令 ---- */

    try {
        ctx.SlashCommandParser.addCommandObject(ctx.SlashCommand.fromProps({
            name: 'dsrt',
            help: '运行 DS Responses 测试。用法: /dsrt all | 1 | 2 | 3 | 4 | 5',
            unnamedArgumentList: [
                ctx.SlashCommandArgument.fromProps({
                    description: 'all=全部，1=连通 2=流式 3=链式 4=推理 5=模型列表',
                    acceptsMultiple: false,
                    enumList: ['all', '1', '2', '3', '4', '5'],
                }),
            ],
            callback: (_args, value) => {
                const v = String(value ?? 'all').trim().toLowerCase();
                if (v === 'all' || v === '') return runAll();
                if (['1', '2', '3', '4', '5'].includes(v)) return runSingle(Number(v));
                toastr.warning('用法: /dsrt all | 1 | 2 | 3 | 4 | 5');
            },
        }));
    } catch (e) {
        console.warn('[DSRT] slash 命令注册失败（不影响按钮测试）', e);
    }

    addPanel();
    console.log('[DSRT] 扩展加载完成（v0.1.2），面板已注入 #extensions_settings');
}
