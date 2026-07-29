# KBCut（口播智剪）

Windows 口播视频 AI 剪辑工具。把口播视频识别成文字后，用大模型重组为更适合投流的短视频变体，并自动导出。

> 当前开源范围：**仅 Windows 10/11 x64**  
> 版本：`1.0.3`  
> 协议：MIT

## 适合谁

- 需要批量处理口播视频的运营 / 剪辑人员
- 有 OpenAI 兼容 ASR / LLM API 的用户
- Windows 64 位电脑用户

不提供 macOS / Linux 安装包。

## 功能

- 拖入 / 批量导入口播视频（按拖入顺序排队）
- 在线 Whisper API 或本地 Whisper 识别
- 大模型重组：通顺优先，支持 Top 爆款变体
- 多模型 API 候补：失败自动切换，成功的提到第一位
- 全自动串行批量：识别 → AI 重组 → 导出
- 断点续跑：识别完成后暂停/失败，不重跑识别
- 可选字幕烧录
- 输出目录记忆
- 每条任务显示识别 / AI / 导出耗时

## 系统要求

- Windows 10 或 Windows 11
- 64 位（x64）
- 建议 8GB 以上内存
- Release 安装包内置 FFmpeg / FFprobe，普通用户无需另外安装
- 本地识别需要更多磁盘空间和首次模型下载时间
- 本地 Whisper 首次识别自动下载，国内镜像失败后会尝试 Hugging Face 官方源
- 在线识别 / AI 重组需要可用网络和用户自己的 API Key

## 下载（给最终用户）

1. 打开 [最新 Release](https://github.com/cglyvip/kbcut/releases/latest)
2. 下载 `KBCut-*-win-x64-setup.exe`
3. 双击安装。若 Windows SmartScreen 提示未知发布者，选择「仍要运行」（开源构建默认无付费代码签名）
4. 打开「口播智剪」→ 设置里填写大模型 API → 选择输出目录 → 拖入口播视频开始处理

软件不提供免费模型额度；Key 只保存在本机。

## 普通用户怎么用

1. 打开 [Releases](https://github.com/cglyvip/kbcut/releases)
2. 下载最新 Windows 安装包（`.exe`）
3. 安装并启动「口播智剪」
4. 在设置中填写：
   - 大模型 API（可填多个做候补）
   - 可选：在线 Whisper API
5. 选择输出目录
6. 拖入视频，开始全自动处理

## 从零开始的 5 步使用指南

如果你不知道什么是 API，也不知道什么是 Whisper：[从零开始使用指南](docs/从零开始使用.md)会告诉你安装后怎么做。

## 教程与规划

- [语音识别教程](docs/语音识别教程.md)：本地 Whisper 自动下载、离线复制、在线 API 配置和错误排查
- [从零开始使用](docs/从零开始使用.md)：安装后没有 API/模型/FFmpeg 也能一步步配好的完整引导
- [爆款能力规划](docs/爆款能力规划.md)：商品 Brief、多维评分、素材缺口、投放数据回流等后续方向

### API 说明

- 软件本身不提供免费大模型额度
- ASR / LLM 都使用你自己配置的服务商
- API Key 保存在本机，请勿截图外传

## 开发者安装

```powershell
git clone https://github.com/cglyvip/kbcut.git
cd kbcut
npm ci
npm run dev
```

## 构建 Windows 安装包

```powershell
npm run build
npm run dist
```

产物在 `dist/`：

- NSIS 安装包：`*.exe`
- 可选更新元数据：`latest*.yml`

## 发布流程

推送版本标签会触发 GitHub Actions，自动构建 Windows 安装包并创建 Release：

```powershell
# 1) package.json 的 version 必须和 tag 对应，例如 1.0.4 -> v1.0.4
npm run check
git add -A
git commit -m "release: vX.Y.Z"
git push origin main
git tag -a vX.Y.Z -m "vX.Y.Z"
git push origin vX.Y.Z
```

GitHub Actions 会自动构建 Windows 安装包并发布到 Releases。用户只需打开：

https://github.com/cglyvip/kbcut/releases

然后到 Actions 查看构建，再到 Releases 确认安装包。

## 隐私

- 视频导入、切片、导出在本地完成
- 在线识别会把音频发给你配置的 ASR 服务
- AI 重组会把文本发给你配置的大模型服务
- 项目维护者不中转、不收集这些内容

详见 [PRIVACY.md](PRIVACY.md)。

## 开源协议

MIT，见 [LICENSE](LICENSE)。

欢迎 Issue / PR。提交前请勿包含真实 API Key。


