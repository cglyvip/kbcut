import { ipcMain, dialog, shell } from 'electron'
import { basename } from 'path'
import { stat } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getFfmpegPath, getFfprobePath } from '../utils/ffmpeg-path'
import { extractAudio, cleanupTempFile } from '../utils/audio'
import { onlineAsr } from '../services/asr-online'
import { localAsr } from '../services/asr-local'
import { generateVariants } from '../services/variant-generator'
import { exportVariants } from '../services/video-export'
import { testLlmProvider, testLlmProviders, type LlmProvider } from '../services/llm-client'
import {
  saveBatchCheckpoint,
  loadBatchCheckpoint,
  deleteBatchCheckpoint,
  deleteBatchCheckpoints,
  clearAllBatchCheckpoints
} from '../services/batch-checkpoint'
import { loadAppSettings, saveAppSettings, getAppSettingsPath } from '../services/app-settings'

const execFileAsync = promisify(execFile)

async function probeVideo(filePath: string) {
  const ffprobe = getFfprobePath()
  const { stdout } = await execFileAsync(ffprobe, [
    '-v', 'quiet',
    '-print_format', 'json',
    '-show_format',
    '-show_streams',
    filePath
  ], { maxBuffer: 20 * 1024 * 1024 })

  const data = JSON.parse(stdout)
  const videoStream = (data.streams || []).find((s: any) => s.codec_type === 'video')
  const fileStat = await stat(filePath)

  let fps = 0
  if (videoStream?.r_frame_rate) {
    const [num, den] = videoStream.r_frame_rate.split('/').map(Number)
    fps = den ? num / den : num
  }

  return {
    filePath,
    fileName: basename(filePath),
    duration: parseFloat(data.format?.duration || '0'),
    width: videoStream?.width || 0,
    height: videoStream?.height || 0,
    fps,
    fileSize: fileStat.size,
    codec: videoStream?.codec_name || 'unknown'
  }
}

export function registerIpcHandlers(): void {
  ipcMain.handle('select-video', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择口播视频',
      filters: [
        { name: '视频文件', extensions: ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return probeVideo(result.filePaths[0])
  })

  ipcMain.handle('select-videos', async () => {
    const result = await dialog.showOpenDialog({
      title: '批量选择口播视频',
      filters: [
        { name: '视频文件', extensions: ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv'] }
      ],
      properties: ['openFile', 'multiSelections']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return []
    }

    const videos = []
    for (const filePath of result.filePaths) {
      try {
        videos.push(await probeVideo(filePath))
      } catch (err: any) {
        console.error('[select-videos] probe failed:', filePath, err)
      }
    }
    return videos
  })

  ipcMain.handle('get-video-info', async (_event, filePath: string) => {
    return probeVideo(filePath)
  })

  ipcMain.handle('asr-recognize', async (_event, options: {
    videoPath: string
    mode: 'online' | 'local'
    apiKey?: string
    baseUrl?: string
    model?: string
  }) => {
    const { videoPath, mode, apiKey, baseUrl, model } = options
    let audioPath: string | null = null

    try {
      audioPath = await extractAudio(videoPath, mode === 'online' ? 'wav' : 'pcm')

      if (mode === 'online') {
        if (!apiKey || !baseUrl) {
          throw new Error('在线模式需要填写 API Key 和 API 地址')
        }
        return await onlineAsr(audioPath, { apiKey, baseUrl, model })
      }

      return await localAsr(audioPath)
    } catch (err) {
      console.error('[asr-recognize] error:', err)
      throw err
    } finally {
      if (audioPath) await cleanupTempFile(audioPath)
    }
  })

  ipcMain.handle('generate-variants', async (_event, options: {
    segments: any[]
    minDuration: number
    maxDuration: number
    variantCount: number
    topFluencyOnly?: boolean
    topFluencyCount?: number
    providers?: LlmProvider[]
    allowFallback?: boolean
    apiKey?: string
    baseUrl?: string
    model?: string
  }) => {
    return generateVariants(options)
  })

  ipcMain.handle('test-llm-provider', async (_event, provider: LlmProvider) => {
    return testLlmProvider(provider)
  })

  ipcMain.handle('test-llm-providers', async (_event, providers: LlmProvider[]) => {
    return testLlmProviders(providers)
  })

  ipcMain.handle('select-output-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择导出文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('export-variants', async (event, options: {
    videoPath: string
    variants: any[]
    outputDir: string
    enableSubtitle: boolean
  }) => {
    return exportVariants({
      ...options,
      onProgress: (current, total) => {
        event.sender.send('export-progress', { current, total })
      }
    })
  })

  ipcMain.handle('open-folder', async (_event, folderPath: string) => {
    shell.openPath(folderPath)
  })

  // ---- Persistent app settings (LLM / ASR / outputDir) ----
  ipcMain.handle('load-app-settings', async () => {
    return loadAppSettings()
  })

  ipcMain.handle('save-app-settings', async (_event, partial: any) => {
    return saveAppSettings(partial || {})
  })

  ipcMain.handle('get-app-settings-path', async () => {
    return getAppSettingsPath()
  })

  // ---- Batch checkpoint (disk) ----
  ipcMain.handle('save-batch-checkpoint', async (_event, taskId: string, payload: any) => {
    return saveBatchCheckpoint(taskId, payload || {})
  })

  ipcMain.handle('load-batch-checkpoint', async (_event, taskId: string) => {
    return loadBatchCheckpoint(taskId)
  })

  ipcMain.handle('delete-batch-checkpoint', async (_event, taskId: string) => {
    return deleteBatchCheckpoint(taskId)
  })

  ipcMain.handle('delete-batch-checkpoints', async (_event, taskIds: string[]) => {
    return deleteBatchCheckpoints(taskIds || [])
  })

  ipcMain.handle('clear-all-batch-checkpoints', async () => {
    return clearAllBatchCheckpoints()
  })

  ipcMain.handle('cleanup-batch-memory', async () => {
    try {
      // Best-effort temp cleanup for leftover cut-claude files
      const { readdir, unlink, stat } = await import('fs/promises')
      const { join } = await import('path')
      const { tmpdir } = await import('os')
      const dir = tmpdir()
      const names = await readdir(dir)
      let removed = 0
      const now = Date.now()
      for (const name of names) {
        if (!name.startsWith('cut-claude-')) continue
        const full = join(dir, name)
        try {
          const st = await stat(full)
          // only remove files older than 2 minutes to avoid racing current task
          if (now - st.mtimeMs > 2 * 60 * 1000) {
            await unlink(full)
            removed++
          }
        } catch {}
      }

      // Optional GC if electron started with --expose-gc
      const g: any = global
      if (typeof g.gc === 'function') {
        g.gc()
      }

      return { ok: true, removed }
    } catch (err: any) {
      console.error('[cleanup-batch-memory]', err)
      return { ok: false, error: err?.message || String(err) }
    }
  })
}

