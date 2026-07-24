# 安全说明（公开分发）

KBCut 面向个人与小团队的 Windows 本地工具。公开下载时请注意：

## 用户侧

- 只从官方 GitHub Releases 下载安装包
- 不要把 API Key 发到 Issue、截图、聊天记录
- 在线 ASR / LLM 会把音频或文本发到**你配置的**第三方服务，请阅读对方隐私政策
- Windows 可能提示 SmartScreen：未购买代码签名证书时属于常见现象

## 维护者侧（本仓库已做）

- Renderer：`contextIsolation`、关闭 `nodeIntegration`、开启 `sandbox`
- CSP 限制默认脚本来源
- IPC 路径要求绝对本地路径；外链仅 http/https 且禁止 URL 内嵌账号密码
- 设置中的 API Key 优先使用 Windows `safeStorage` 加密落盘
- 批量断点 taskId 白名单，避免路径穿越

## 已知边界

- 应用可读写用户选择的本地视频/输出目录（产品功能需要）
- 用户可配置任意 OpenAI 兼容 API 地址（含内网）；请勿在不可信环境填写敏感内网地址
- 未做 EV 代码签名时，浏览器/系统可能警告“未知发布者”

欢迎通过 Issue 报告安全问题。请勿在公开 Issue 粘贴真实密钥。
