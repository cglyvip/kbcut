import { execSync } from 'child_process'

function findSystemBinary(name: string): string | null {
  try {
    const result = execSync(`where ${name}`, { encoding: 'utf-8' }).trim()
    // `where` may return multiple lines; take first existing-looking path
    const first = result.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    return first || null
  } catch {
    return null
  }
}

export function getFfmpegPath(): string {
  const systemPath = findSystemBinary('ffmpeg')
  if (systemPath) return systemPath

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('ffmpeg-static') as string
  } catch {
    throw new Error('未找到 FFmpeg，请先安装 FFmpeg（推荐 winget install ffmpeg）')
  }
}

export function getFfprobePath(): string {
  const systemPath = findSystemBinary('ffprobe')
  if (systemPath) return systemPath

  // ffmpeg-static usually does NOT include ffprobe. Prefer clear error.
  throw new Error('未找到 FFprobe，请安装完整 FFmpeg（需包含 ffprobe，推荐 winget install ffmpeg）')
}
