import { app } from 'electron'
import { join } from 'path'
import { mkdir, readdir, stat } from 'fs/promises'

const MODEL_ID = 'onnx-community/whisper-small'
const MODEL_DIR_NAME = 'whisper-small'

export function getWhisperModelCacheDir(): string {
  return join(app.getPath('userData'), 'models', MODEL_DIR_NAME)
}

async function directoryStats(directory: string): Promise<{ fileCount: number; sizeBytes: number }> {
  let fileCount = 0
  let sizeBytes = 0
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name)
      if (entry.isDirectory()) {
        const nested = await directoryStats(entryPath)
        fileCount += nested.fileCount
        sizeBytes += nested.sizeBytes
      } else if (entry.isFile()) {
        const file = await stat(entryPath)
        fileCount++
        sizeBytes += file.size
      }
    }
  } catch {}
  return { fileCount, sizeBytes }
}

export async function getWhisperModelInfo(): Promise<{
  modelId: string
  cacheDir: string
  downloaded: boolean
  fileCount: number
  sizeBytes: number
  mirrorUrl: string
  officialUrl: string
}> {
  const cacheDir = getWhisperModelCacheDir()
  await mkdir(cacheDir, { recursive: true })
  const stats = await directoryStats(cacheDir)
  return {
    modelId: MODEL_ID,
    cacheDir,
    downloaded: stats.fileCount > 0 && stats.sizeBytes > 100 * 1024 * 1024,
    fileCount: stats.fileCount,
    sizeBytes: stats.sizeBytes,
    mirrorUrl: `https://hf-mirror.com/${MODEL_ID}`,
    officialUrl: `https://huggingface.co/${MODEL_ID}`
  }
}
