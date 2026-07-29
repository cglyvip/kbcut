import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { unlink } from 'fs/promises'
import { getFfmpegPath } from '../utils/ffmpeg-path'

const execFileAsync = promisify(execFile)

export type AudioExtractFormat = 'pcm' | 'wav' | 'mp3'

export async function extractAudio(
  videoPath: string,
  format: AudioExtractFormat = 'pcm'
): Promise<string> {
  const ffmpegPath = getFfmpegPath()
  const ext = format === 'wav' ? 'wav' : format === 'mp3' ? 'mp3' : 'pcm'
  const outputPath = join(tmpdir(), `cut-claude-${randomUUID()}.${ext}`)

  const args =
    format === 'wav'
      ? [
          '-hide_banner',
          '-loglevel', 'error',
          '-i', videoPath,
          '-vn',
          '-acodec', 'pcm_s16le',
          '-ar', '16000',
          '-ac', '1',
          '-f', 'wav',
          '-y',
          outputPath
        ]
      : format === 'mp3'
        ? [
            '-hide_banner',
            '-loglevel', 'error',
            '-i', videoPath,
            '-vn',
            '-acodec', 'libmp3lame',
            '-b:a', '48k',
            '-ar', '16000',
            '-ac', '1',
            '-map_metadata', '-1',
            '-f', 'mp3',
            '-y',
            outputPath
          ]
      : [
          '-hide_banner',
          '-loglevel', 'error',
          '-i', videoPath,
          '-vn',
          '-acodec', 'pcm_s16le',
          '-ar', '16000',
          '-ac', '1',
          '-f', 's16le',
          '-y',
          outputPath
        ]

  try {
    await execFileAsync(ffmpegPath, args, {
      timeout: 10 * 60 * 1000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    })
    return outputPath
  } catch (err) {
    // ffmpeg 失败时清理可能已部分写入的临时文件，避免磁盘残留
    try { await unlink(outputPath) } catch {}
    throw err
  }
}

export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch (err: unknown) {
    // 记录日志便于排查磁盘残留问题，不抛错
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[cleanupTempFile] 清理临时文件失败:', filePath, err instanceof Error ? err.message : String(err))
    }
  }
}
