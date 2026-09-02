# DS Responses RP Agent

SillyTavern 扩展——用 DeepSeek `/responses` API 驱动的 **Agent 式角色扮演引擎**。

## 特性

- **七段 Agent 流水线**（A 整理→B 卡档→C 决策→D 草稿→E 审查→F 定稿→G 摘要/H 终检）+ 验证回路
- **StepRunner 步进器**：每步 校验→重试/降级/中止——错误不再静默传播
- **分层记忆 L1-L6**（状态栏快照>数值链>修正指令>摘要>阶段>向量）+ 预算控制
- **数值连贯**：独立 valueLog 禁止回退
- **自建向量记忆**（SiliconFlow bge-m3 + IndexedDB）
- **完整接管**：发送键/菜单三项/swipe 箭头（document 捕获阶段拦截）
- **连接测试**：内置 5 项自检（连通/流式/链式/推理/模型）
- **CORS 代理**：中转站自动走 ST /proxy/
- **ST 原生正则**：直接调用 ST 的 regex engine

## 安装

放入 `SillyTavern/data/<用户名>/extensions/ds-responses-rp/`，强刷浏览器，扩展面板填 Base URL + API Key。

## 更新

manifest 已开 `auto_update`——git clone 安装的用户会收到更新提醒。

## License

AGPL-3.0
