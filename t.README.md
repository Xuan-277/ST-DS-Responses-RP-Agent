# DS Responses Tester

DS Responses RP Agent 的配套测试器——独立配置 API 端点并跑连通/流式/链式测试。

## 使用

嵌在 DSRP 主面板内（或独立显示于扩展区，若主扩展被禁用）。

1. 展开高级覆盖 → 填 Base URL / API Key / 模型
2. 点「全部测试」→ 依次跑 5 项测试（连通/流式/链式/推理/模型列表）
3. 底部日志区显示结果（绿色成功/红色失败）

## 说明

- 未配置时自动从 DSRP 主面板同步（一旦自己填过就保留自己的）
- 中转站 URL 自动走 ST 的 /proxy/ 代理（绕过 CORS）
- 模型名需填 API ID（如 `deepseek-v4-pro-0813`），不是网页显示名

## License

AGPL-3.0
