import { existsSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import { app } from 'electron'

function findSystemBinary(name: string): string | null {
  try {
    const result = execSync(`where ${name}`, { encoding: 'utf-8', windowsHide: true }).trim()
    const first = result.split(/\r?\n/).map((s) => s.trim()).find(Boolean)
    return first || null
  } catch {
    return null
  }
}

function candidateResourceBins(name: string): string[] {
  const file = process.platform === 'win32' ? `${name}.exe` : name
  const list: string[] = []
  try {
    // packaged app resources
    list.push(join(process.resourcesPath || '', 'bin', file))
  } catch {}
  try {
    // project resources during dev
    list.push(join(app.getAppPath(), 'resources', 'bin', file))
  } catch {}
  list.push(join(process.cwd(), 'resources', 'bin', file))
  return list
}

function findLocalBinary(name: string): string | null {
  for (const p of candidateResourceBins(name)) {
    if (p && existsSync(p)) return p
  }
  return null
}

export function getFfmpegPath(): string {
  const local = findLocalBinary('ffmpeg')
  if (local) return local

  const systemPath = findSystemBinary('ffmpeg')
  if (systemPath) return systemPath

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static') as string
    if (p && existsSync(p)) return p
  } catch {}

  throw new Error('未找到 FFmpeg。请安装 FFmpeg（winget install ffmpeg）或将 ffmpeg.exe 放到 resources/bin/')
}

export function getFfprobePath(): string {
  const local = findLocalBinary('ffprobe')
  if (local) return local

  const systemPath = findSystemBinary('ffprobe')
  if (systemPath) return systemPath

  // Some environments only have ffmpeg-static (no ffprobe). Export can degrade without probe.
  throw new Error('未找到 FFprobe。请安装完整 FFmpeg（包含 ffprobe）或将 ffprobe.exe 放到 resources/bin/')
}
