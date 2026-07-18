# KBCut（口播智剪）

一款基于 Electron、React 和 TypeScript 的 Windows 口播视频 AI 剪辑工具，支持语音识别、AI 内容分析、短视频变体生成、片段重排和字幕烧录导出。

> 当前版本：`0.1.0`，处于内部测试阶段。本仓库为私有仓库，未经许可不得复制或分发。

## 功能

- 在线 Whisper API 或本地 Whisper 语音识别
- 按字选择、排除和重新组合视频内容
- 使用兼容 OpenAI Chat Completions 的接口分析口播结构
- 生成不同时长和叙事策略的视频变体
- 使用 FFmpeg 重排片段并导出 MP4
- 可选字幕烧录
- 使用操作系统安全存储加密保存 API Key

## 环境要求

- Windows 10/11 x64
- Node.js 20 或更高版本
- npm
- FFmpeg 与 FFprobe

FFmpeg 可以安装到系统 `PATH`，也可以在内部构建安装包时将 `ffmpeg.exe` 和 `ffprobe.exe` 放入 `resources/bin/`。二进制文件默认不会提交到仓库。

本地语音识别首次使用时会从 Hugging Face 镜像下载 Whisper 模型，需要网络连接、较长等待时间和足够的磁盘空间。

## 开发

```powershell
npm ci
npm run dev
```

## 检查与构建

```powershell
npm run typecheck
npm run build
npm run pack
```

- `npm run check`：类型检查并构建
- `npm run pack`：生成未安装版本
- `npm run dist`：生成 Windows NSIS 安装包

## 配置

在线 ASR 和 AI 分析服务由用户在应用内填写 API 地址、模型名和 API Key。API Key 使用 Electron `safeStorage` 加密保存，不写入浏览器 `localStorage` 或项目文件。

请勿在源码、`.env`、截图、问题记录或提交信息中包含真实 API Key。

## 数据与隐私

在线模式会把音频或文本发送到用户配置的第三方 API 服务；本地识别模式不会把音频发送给在线 ASR 服务。详细说明见 [PRIVACY.md](PRIVACY.md)。

## 发布

推送 `v*` 格式的 Git 标签会触发 GitHub Actions 构建 Windows 安装包并创建草稿 Release：

```powershell
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

发布前应在干净的 Windows 环境验证安装、视频导入、在线/本地识别、字幕和导出流程。

## 目录结构

- `src/main`：Electron 主进程、IPC、ASR、AI 与视频导出
- `src/preload`：受限的渲染进程 API 桥
- `src/renderer`：React 界面和状态管理
- `resources/bin`：可选的 FFmpeg/FFprobe 随包二进制
- `.github/workflows`：持续集成和版本发布流程

