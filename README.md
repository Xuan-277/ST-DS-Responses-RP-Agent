# DS Responses RP Agent

SillyTavern 浏览器扩展——用 DeepSeek `/responses` API 驱动的 Agent 式角色扮演引擎。

## 特性

- **七段 Agent 流水线**：预设整理 → 卡整理 → 决策中枢 → 草稿 → 审查 → 定稿 → 摘要/终检
- **验证回路**：E 审查发现问题 → F 修正 → E 复查（复查模式：只验旧问题）
- **分层记忆**：状态栏快照 > 数值链 > 修正指令 > 滚动摘要 > 阶段总结 > 向量检索（预算控制）
- **数值连贯**：独立数值链（valueLog）禁止回退——调教等级/受虐记录等不再漂移
- **自建向量记忆**：SiliconFlow bge-m3 嵌入 + IndexedDB 存储 + 余弦相似检索（可选）
- **CORS 代理**：非官方中转站自动走 ST 的 /proxy/（绕过浏览器跨域限制）
- **完整接管**：发送键/回车/菜单（重掷/续写/AI帮答）/swipe 箭头
- **记忆联动**：编辑/删除楼层自动截断对应记忆；删除聊天文件自动清向量

## 安装

1. 将 `ds-responses-rp` 文件夹放入 `SillyTavern/data/<用户名>/extensions/`
2. （可选）配套测试器 `ds-responses-test` 同样放入
3. 强制刷新浏览器（Ctrl+Shift+R）
4. 扩展面板 → 展开「DS Responses RP Agent」→ 填 Base URL 和 API Key

## 配置

| 项 | 说明 |
|---|---|
| Base URL | 官方填 `https://api.deepseek.com`；中转站填 `https://你的中转/v1`（自动走代理）|
| 主力模型 | C 决策 + D 草稿（推荐 deepseek-v4-pro）|
| 快模型 | A/B/E~H（推荐 deepseek-v4-flash）|
| 嵌入 Key | SiliconFlow（免费注册）——填了启用自建向量 |

## 使用

- 接管开关：控制发送键/回车/菜单/swipe 是否走本扩展
- `/dsrp retry` 重掷 · `/dsrp continue` 续写 · `/dsrp impersonate` 帮答 · `/dsrp stop` 停止
- 记忆面板：查看/导出/导入/清空记忆库，重建向量索引
- 「查看注入」显示的就是实际发给 AI 的内容（含宏替换/注释剥离后）


## ⚠️ 重要提示


- **使用此扩展时请关闭其他记忆类扩展**
- **不要配置 SillyTavern 的原生 AI API 页面**
- Token 消耗会增加，但体验感明显增强


## 依赖

- SillyTavern 1.12+
- DeepSeek API Key（官方或任意兼容 /responses 的中转）
- （可选）SiliconFlow API Key 用于向量嵌入

## License

AGPL-3.0
