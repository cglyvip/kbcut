import { ipcMain, dialog, shell } from 'electron'
import { basename } from 'path'
import { requireFsPath, requireHttpUrlPublic } from '../utils/path-guard'
import { stat } from 'fs/promises'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { getFfmpegPath, getFfprobePath } from '../utils/ffmpeg-path'
import { extractAudio, cleanupTempFile } from '../utils/audio'
import { onlineAsr } from '../services/asr-online'
import { localAsr } from '../services/asr-local'
import { generateVariants } from '../services/variant-generator'
import { exportVariants } from '../services/video-export'
import { getLlmRpmLimit, setLlmRpmLimit, testLlmProvider, testLlmProviders, type LlmProvider } from '../services/llm-client'
import {
  saveBatchCheckpoint,
  loadBatchCheckpoint,
  deleteBatchCheckpoint,
  deleteBatchCheckpoints,
  clearAllBatchCheckpoints
} from '../services/batch-checkpoint'
import { loadAppSettings, saveAppSettings, getAppSettingsPath } from '../services/app-settings'
import { getLocalModelAdvice } from '../services/local-model-advisor'
import { checkCompliance } from '../services/compliance-checker'
import { getWhisperModelCacheDir, getWhisperModelInfo } from '../services/asr-model'

const execFileAsync = promisify(execFile)

function requireText(value: unknown, label: string, maxLength = 4096): string {
  const text = String(value || '').trim()
  if (!text) throw new Error(`${label}不能为空`)
  if (text.length > maxLength) throw new Error(`${label}过长`)
  return text
}

function requireHttpUrl(value: unknown, label: string): string {
  return requireHttpUrlPublic(value, label)
}

async function probeVideo(filePath: string) {
  filePath = requireFsPath(filePath, '视频路径')
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

    return probeVideo(result.filePaths[0]!)
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
      } catch (err: unknown) {
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
    if (!options || typeof options !== 'object') throw new Error('识别参数无效')
    const videoPath = requireFsPath(options.videoPath, '视频路径')
    const mode = options.mode === 'local' ? 'local' : options.mode === 'online' ? 'online' : null
    if (!mode) throw new Error('识别模式无效')
    const apiKey = String(options.apiKey || '').trim()
    const baseUrl = String(options.baseUrl || '').trim()
    const model = String(options.model || '').trim()
    let audioPath: string | null = null

    try {
      audioPath = await extractAudio(videoPath, mode === 'online' ? 'mp3' : 'pcm')

      if (mode === 'online') {
        if (!apiKey || !baseUrl) {
          throw new Error('在线模式需要填写 API Key 和 API 地址')
        }
        return await onlineAsr(audioPath, {
          apiKey,
          baseUrl: requireHttpUrl(baseUrl, 'Whisper API 地址'),
          model: model || 'whisper-1'
        })
      }

      return await localAsr(audioPath, getWhisperModelCacheDir())
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
    if (!options || typeof options !== 'object' || !Array.isArray(options.segments)) {
      throw new Error('AI 重组参数无效')
    }
    return generateVariants(options)
  })

  ipcMain.handle('test-llm-provider', async (_event, provider: LlmProvider) => {
    return testLlmProvider(provider)
  })

  ipcMain.handle('test-llm-providers', async (_event, providers: LlmProvider[]) => {
    return testLlmProviders(providers)
  })

  ipcMain.handle('set-llm-rpm-limit', async (_event, rpm: number) => {
    return setLlmRpmLimit(rpm)
  })

  ipcMain.handle('get-llm-rpm-limit', async () => {
    return getLlmRpmLimit()
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
    exportResolution?: '720' | '1080' | '1440' | 'source'
  }) => {
    try {
      if (!options || typeof options !== 'object') throw new Error('导出参数无效')
      const videoPath = requireFsPath(options.videoPath, '视频路径')
      const outputDir = requireFsPath(options.outputDir, '输出目录')
      return await exportVariants({
        ...options,
        videoPath,
        outputDir,
        onProgress: (current, total, detail) => {
          try {
            event.sender.send('export-progress', { current, total, detail: detail || '' })
          } catch {}
        }
      })
    } catch (err: unknown) {
      console.error('[export-variants] fatal:', err)
      return {
        files: [],
        errors: [err instanceof Error ? err.message : String(err)]
      }
    }
  })

  ipcMain.handle('open-folder', async (_event, folderPath: string) => {
    const target = requireFsPath(folderPath, '文件夹路径')
    const error = await shell.openPath(target)
    return error ? { ok: false, error } : { ok: true }
  })

  ipcMain.handle('open-external', async (_event, url: string) => {
    try {
      const target = requireHttpUrlPublic(url, '链接')
      await shell.openExternal(target)
      return { ok: true }
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // ---- Persistent app settings (LLM / ASR / outputDir) ----
  ipcMain.handle('load-app-settings', async () => {
    return loadAppSettings()
  })

  ipcMain.handle('save-app-settings', async (_event, partial: any) => {
    return saveAppSettings(partial && typeof partial === 'object' ? partial : {})
  })

  ipcMain.handle('get-app-settings-path', async () => {
    return getAppSettingsPath()
  })

  ipcMain.handle('get-local-model-advice', async () => {
    return getLocalModelAdvice()
  })

  ipcMain.handle('get-asr-model-info', async () => {
    return getWhisperModelInfo()
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
          if (now - st.mtimeMs > 30 * 60 * 1000) {
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
    } catch (err: unknown) {
      console.error('[cleanup-batch-memory]', err)
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('check-compliance', async (_event, texts: string[]) => {
    const safeTexts = Array.isArray(texts)
      ? texts.slice(0, 100).map((text) => String(text || '').slice(0, 100_000))
      : []
    return checkCompliance(safeTexts)
  })
}

