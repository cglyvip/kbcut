import { contextBridge, ipcRenderer, webUtils } from 'electron'

export interface VideoInfo {
  filePath: string
  fileName: string
  duration: number
  width: number
  height: number
  fps: number
  fileSize: number
  codec: string
}

export interface AsrWord {
  start: number
  end: number
  text: string
}

export interface AsrSegment {
  start: number
  end: number
  text: string
  words: AsrWord[]
}

export interface AsrResult {
  segments: AsrSegment[]
  fullText: string
  language: string
}

export interface AsrOptions {
  videoPath: string
  mode: 'online' | 'local'
  apiKey?: string
  baseUrl?: string
  model?: string
}

export interface LlmProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  enabled?: boolean
}

export interface VariantPlan {
  id: number
  name: string
  strategy: string
  segments: any[]
  totalDuration: number
}

export interface GenerateVariantsOptions {
  segments: {
    start: number
    end: number
    text: string
    duration: number
    words?: { start: number; end: number; text: string }[]
  }[]
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
}

export interface GenerateVariantsResult {
  variants: VariantPlan[]
  usedProvider?: LlmProvider | null
  usedProviderIndex?: number
  failedProviders?: { name: string; error: string }[]
  usedFallback?: boolean
  notice?: string
}

export interface LlmTestResult {
  ok: boolean
  providerId: string
  providerName: string
  message: string
  latencyMs: number
  model?: string
}

export interface ExportOptions {
  videoPath: string
  variants: VariantPlan[]
  outputDir: string
  enableSubtitle: boolean
  exportResolution?: '720' | '1080' | '1440' | 'source'
}

export interface ExportResult {
  files: string[]
  errors: string[]
}

export interface BatchCheckpointData {
  taskId: string
  checkpoint: 'none' | 'asr_done' | 'generate_done'
  asrSegments?: any[]
  variants?: any[]
  usedProviderName?: string
  asrMs?: number
  generateMs?: number
  updatedAt: number
}

const api = {
  selectVideo: (): Promise<VideoInfo | null> => ipcRenderer.invoke('select-video'),
  selectVideos: (): Promise<VideoInfo[]> => ipcRenderer.invoke('select-videos'),
  getVideoInfo: (filePath: string): Promise<VideoInfo> => ipcRenderer.invoke('get-video-info', filePath),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  asrRecognize: (options: AsrOptions): Promise<AsrResult> => ipcRenderer.invoke('asr-recognize', options),
  generateVariants: (options: GenerateVariantsOptions): Promise<GenerateVariantsResult> => ipcRenderer.invoke('generate-variants', options),
  testLlmProvider: (provider: LlmProvider): Promise<LlmTestResult> => ipcRenderer.invoke('test-llm-provider', provider),
  testLlmProviders: (providers: LlmProvider[]): Promise<LlmTestResult[]> => ipcRenderer.invoke('test-llm-providers', providers),
  setLlmRpmLimit: (rpm: number): Promise<number> => ipcRenderer.invoke('set-llm-rpm-limit', rpm),
  getLlmRpmLimit: (): Promise<number> => ipcRenderer.invoke('get-llm-rpm-limit'),
  selectOutputDir: (): Promise<string | null> => ipcRenderer.invoke('select-output-dir'),
  exportVariants: (options: ExportOptions): Promise<ExportResult> => ipcRenderer.invoke('export-variants', options),
openFolder: (folderPath: string): Promise<void> => ipcRenderer.invoke('open-folder', folderPath),
  openExternal: (url: string): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('open-external', url),
  saveBatchCheckpoint: (
    taskId: string,
    payload: {
      checkpoint: 'none' | 'asr_done' | 'generate_done'
      asrSegments?: any[]
      variants?: any[]
      usedProviderName?: string
      asrMs?: number
      generateMs?: number
    }
  ): Promise<{ ok: boolean; path?: string; error?: string }> =>
    ipcRenderer.invoke('save-batch-checkpoint', taskId, payload),
  loadBatchCheckpoint: (taskId: string): Promise<BatchCheckpointData | null> =>
    ipcRenderer.invoke('load-batch-checkpoint', taskId),
  deleteBatchCheckpoint: (taskId: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('delete-batch-checkpoint', taskId),
  deleteBatchCheckpoints: (taskIds: string[]): Promise<{ ok: boolean; removed: number; error?: string }> =>
    ipcRenderer.invoke('delete-batch-checkpoints', taskIds),
  clearAllBatchCheckpoints: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('clear-all-batch-checkpoints'),
  loadAppSettings: (): Promise<any> => ipcRenderer.invoke('load-app-settings'),
  saveAppSettings: (partial: any): Promise<{ ok: boolean; settings?: any; error?: string }> =>
    ipcRenderer.invoke('save-app-settings', partial),
  getAppSettingsPath: (): Promise<string> => ipcRenderer.invoke('get-app-settings-path'),
  getLocalModelAdvice: (): Promise<any> => ipcRenderer.invoke('get-local-model-advice'),
  cleanupBatchMemory: (): Promise<{ ok: boolean; removed?: number; error?: string }> =>
    ipcRenderer.invoke('cleanup-batch-memory'),
  onExportProgress: (callback: (data: { current: number; total: number; detail?: string }) => void) => {
    ipcRenderer.on('export-progress', (_event, data) => callback(data))
    return () => { ipcRenderer.removeAllListeners('export-progress') }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api




