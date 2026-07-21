import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { unlink } from 'fs/promises'
import { getFfmpegPath } from '../utils/ffmpeg-path'

const execFileAsync = promisify(execFile)

export type AudioExtractFormat = 'pcm' | 'wav'

export async function extractAudio(
  videoPath: string,
  format: AudioExtractFormat = 'pcm'
): Promise<string> {
  const ffmpegPath = getFfmpegPath()
  const ext = format === 'wav' ? 'wav' : 'pcm'
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

  await execFileAsync(ffmpegPath, args, {
    timeout: 10 * 60 * 1000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  })
  return outputPath
}

export async function cleanupTempFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath)
  } catch {}
}
