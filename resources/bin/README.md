# 可选 FFmpeg 二进制

面向 Windows x64 用户。

如需减少“用户本机未装 FFmpeg”的问题，可在打包前将以下文件放到本目录：

- `ffmpeg.exe`
- `ffprobe.exe`

打包后会进入应用 `resources/bin`。

注意：

- 二进制默认不提交到 Git 仓库
- 发布安装包时建议在 CI 或本机打包环境准备好这些文件
- 若使用 `ffmpeg-static` 依赖，导出链路也可能直接走依赖内的 ffmpeg
