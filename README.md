# DS Responses RP Agent

SillyTavern 浏览器扩展——用 DeepSeek `/responses` API 驱动的 Agent 式角色扮演引擎。

## 项目结构

本仓库包含**两个相互补充**的 SillyTavern 扩展：

### 📌 ds-responses-rp/（主扩展）

- **七段 Agent 流水线**：预设整理 → 卡整理 → 决策中枢 → 草稿 → 审查 → 定稿 → 摘要/终检
- **验证回路**：E 审查发现问题 → F 修正 → E 复查（复查模式：只验旧问题）
- **分层记忆**：状态栏快照 > 数值链 > 修正指令 > 滚动摘要 > 阶段总结 > 向量检索（预算控制）
- **数值连贯**：独立数值链（valueLog）禁止回退——调教等级/受虐记录等不再漂移
- **自建向量记忆**：SiliconFlow bge-m3 嵌入 + IndexedDB 存储 + 余弦相似检索（可选）
- **CORS 代理**：非官方中转站自动走 ST 的 /proxy/（绕过浏览器跨域限制）
- **完整接管**：发送键/回车/菜单（重掷/续写/AI帮答）/swipe 箭头
- **记忆联动**：编辑/删除楼层自动截断对应记忆；删除聊天文件自动清向量

### 🧪 ds-responses-test/（测试工具）

DS Responses RP Agent 的配套测试器——独立配置 API 端点并跑连通/流式/链式测试。

**使用场景**：
- 调试 DeepSeek API 连接
- 测试中转站兼容性
- 验证流式、链式等特殊功能
- 模型列表和推理内容探测

---

## 🚀 快速安装

### 方式一：直接在 SillyTavern 中安装（推荐）

1. 打开 SillyTavern → 扩展面板
2. 选择「**从 GitHub 仓库安装**」
3. 提交仓库链接：
   ```
   https://github.com/Xuan-277/ST-DS-Responses-RP-Agent
   ```
4. 强制刷新浏览器（Ctrl+Shift+R）

ST 会自动识别根目录下的 `ds-responses-rp/` 和 `ds-responses-test/` 两个扩展文件夹并安装。

### 方式二：手动安装

1. 克隆本仓库到本地：
   ```bash
   git clone https://github.com/Xuan-277/ST-DS-Responses-RP-Agent.git
   ```

2. 复制 `ds-responses-rp/` 和 `ds-responses-test/` 两个文件夹到：
   ```
   SillyTavern/data/<用户名>/extensions/
   ```

3. 强制刷新浏览器（Ctrl+Shift+R）

---

## ⚙️ 配置

### DS Responses RP Pipeline 主面板

| 项 | 说明 |
|---|---|
| Base URL | 官方填 `https://api.deepseek.com`；中转站填 `https://你的中转/v1`（自动走代理）|
| 主力模型 | C 决策 + D 草稿（推荐 deepseek-v4-pro）|
| 快模型 | A/B/E~H（推荐 deepseek-v4-flash）|
| 嵌入 Key | SiliconFlow（免费注册）——填了启用自建向量 |

### DS Responses Tester 配置

嵌在 DSRP 主面板内，或独立显示于扩展区（若主扩展被禁用）。

1. 展开高级覆盖 → 填 Base URL / API Key / 模型
2. 点「全部测试」→ 依次跑 5 项测试（连通/流式/链式/推理/模型列表）
3. 底部日志区显示结果（绿色成功/红色失败）

---

## 📖 使用

### 主扩展命令

- 接管开关：控制发送键/回车/菜单/swipe 是否走本扩展
- `/dsrp retry` 重掷 · `/dsrp continue` 续写 · `/dsrp impersonate` 帮答 · `/dsrp stop` 停止
- 记忆面板：查看/导出/导入/清空记忆库，重建向量索引
- 「查看注入」显示的就是实际发给 AI 的内容（含宏替换/注释剥离后）

### 测试工具命令

```
/dsrt all       全部测试
/dsrt 1         连通性 + input 方言探测
/dsrt 2         流式 SSE 方言
/dsrt 3         链式调用（previous_response_id）
/dsrt 4         推理模型思考内容格式
/dsrt 5         模型列表
```

---

## ⚠️ 重要提示

- **使用此扩展时请关闭其他记忆类扩展**
- **不要配置 SillyTavern 的原生 AI API 页面**
- Token 消耗会增加，但体验感明显增强

---

## 📦 依赖

- SillyTavern 1.12+
- DeepSeek API Key（官方或任意兼容 /responses 的中转）
- （可选）SiliconFlow API Key 用于向量嵌入

---

## 📄 License

AGPL-3.0
