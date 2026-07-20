import { create } from 'zustand'
import { loadPermanentSettings, savePermanentSettings } from './permanentSettings'

export type BatchTaskStatus =
  | 'queued'
  | 'extracting'
  | 'asr'
  | 'generating'
  | 'exporting'
  | 'done'
  | 'failed'
  | 'paused_ai'

export interface CachedAsrSegment {
  start: number
  end: number
  text: string
  duration: number
  words?: { start: number; end: number; text: string }[]
}

export interface CachedVariant {
  id: number
  name: string
  strategy: string
  segments: CachedAsrSegment[]
  totalDuration: number
}

export type BatchCheckpoint = 'none' | 'asr_done' | 'generate_done'

export interface BatchTask {
  id: string
  orderNo: number
  filePath: string
  fileName: string
  duration: number
  status: BatchTaskStatus
  stageText: string
  error?: string
  outputFiles: string[]
  variantCount: number
  usedProviderName?: string
  checkpoint?: BatchCheckpoint
  /** Disk checkpoint exists for this task (ASR/AI payloads not kept in memory/localStorage). */
  hasDiskCheckpoint?: boolean
  /** Runtime-only: loaded for the currently processing task, never persisted. */
  asrSegments?: CachedAsrSegment[]
  /** Runtime-only: loaded for the currently processing task, never persisted. */
  variants?: CachedVariant[]
  asrMs?: number
  generateMs?: number
  exportMs?: number
  totalMs?: number
}

interface BatchState {
  tasks: BatchTask[]
  running: boolean
  pausedForApi: boolean
  pauseMessage: string | null
  currentTaskId: string | null
  outputDir: string
  lastStopReason: string | null
  setOutputDir: (dir: string) => void
  addTasks: (videos: { filePath: string; fileName: string; duration: number }[]) => void
  clearFinished: () => void
  removeTask: (id: string) => void
  clearAll: () => void
  setRunning: (v: boolean) => void
  setPausedForApi: (paused: boolean, message?: string | null) => void
  setCurrentTaskId: (id: string | null) => void
  setLastStopReason: (reason: string | null) => void
  updateTask: (id: string, partial: Partial<BatchTask>) => void
  prepareResume: () => void
  getNextQueuedId: () => string | null
  recoverInterrupted: () => void
  /** Drop heavy in-memory caches; disk checkpoints remain for unfinished tasks. */
  releaseMemoryAfterTask: (finishedTaskId?: string | null) => void
  hydrateFromDisk: () => Promise<void>
}

function uid() {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** Compact ASR cache: keep only fields needed by AI generate/export. */
export function compactAsrSegments(segments: CachedAsrSegment[] | undefined): CachedAsrSegment[] | undefined {
  if (!segments || segments.length === 0) return undefined
  return segments.map((s) => ({
    start: s.start,
    end: s.end,
    text: s.text,
    duration: s.duration
  }))
}

export function compactVariants(variants: CachedVariant[] | undefined): CachedVariant[] | undefined {
  if (!variants || variants.length === 0) return undefined
  return variants.map((v) => ({
    id: v.id,
    name: v.name,
    strategy: v.strategy,
    totalDuration: v.totalDuration,
    segments: (v.segments || []).map((s) => ({
      start: s.start,
      end: s.end,
      text: s.text,
      duration: s.duration
    }))
  }))
}

export const OUTPUT_DIR_STORAGE_KEY = 'cut-claude-output-dir'
const BATCH_QUEUE_STORAGE_KEY = 'cut-claude-batch-queue-v1'

function loadOutputDir(): string {
  try {
    return localStorage.getItem(OUTPUT_DIR_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function saveOutputDir(dir: string) {
  try {
    if (dir) localStorage.setItem(OUTPUT_DIR_STORAGE_KEY, dir)
    else localStorage.removeItem(OUTPUT_DIR_STORAGE_KEY)
  } catch {}
  savePermanentSettings({ outputDir: dir || '' })
}

/** Persist queue metadata only — never write ASR/variants into localStorage. */
function toPersistableTasks(tasks: BatchTask[]): BatchTask[] {
  return tasks.map((t) => {
    const checkpoint: BatchCheckpoint =
      t.checkpoint ||
      (t.variants?.length ? 'generate_done' : t.asrSegments?.length ? 'asr_done' : 'none')

    const hasDiskCheckpoint =
      t.status === 'done'
        ? false
        : !!(t.hasDiskCheckpoint || t.asrSegments?.length || t.variants?.length || (checkpoint && checkpoint !== 'none'))

    return {
      id: t.id,
      orderNo: t.orderNo,
      filePath: t.filePath,
      fileName: t.fileName,
      duration: t.duration,
      status: t.status,
      stageText: t.stageText,
      error: t.error,
      outputFiles: t.outputFiles || [],
      variantCount: t.variantCount || 0,
      usedProviderName: t.usedProviderName,
      checkpoint,
      hasDiskCheckpoint,
      asrMs: t.asrMs,
      generateMs: t.generateMs,
      exportMs: t.exportMs,
      totalMs: t.totalMs
    }
  })
}

function saveQueueSnapshot(state: {
  tasks: BatchTask[]
  pausedForApi: boolean
  pauseMessage: string | null
  lastStopReason: string | null
}) {
  try {
    const payload = {
      version: 2,
      savedAt: Date.now(),
      pausedForApi: state.pausedForApi,
      pauseMessage: state.pauseMessage,
      lastStopReason: state.lastStopReason,
      tasks: toPersistableTasks(state.tasks)
    }
    localStorage.setItem(BATCH_QUEUE_STORAGE_KEY, JSON.stringify(payload))
  } catch (err) {
    console.error('[batch] persist queue failed:', err)
    try {
      const lightTasks = state.tasks.map((t) => ({
        id: t.id,
        orderNo: t.orderNo,
        filePath: t.filePath,
        fileName: t.fileName,
        duration: t.duration,
        status: t.status,
        stageText: t.stageText,
        error: t.error,
        outputFiles: t.outputFiles || [],
        variantCount: t.variantCount || 0,
        usedProviderName: t.usedProviderName,
        checkpoint: t.checkpoint || 'none',
        hasDiskCheckpoint: !!t.hasDiskCheckpoint,
        asrMs: t.asrMs,
        generateMs: t.generateMs,
        exportMs: t.exportMs,
        totalMs: t.totalMs
      }))
      localStorage.setItem(BATCH_QUEUE_STORAGE_KEY, JSON.stringify({
        version: 2,
        savedAt: Date.now(),
        pausedForApi: state.pausedForApi,
        pauseMessage: state.pauseMessage,
        lastStopReason: state.lastStopReason,
        tasks: lightTasks
      }))
    } catch (err2) {
      console.error('[batch] persist queue metadata failed:', err2)
    }
  }
}

function loadQueueSnapshot(): {
  tasks: BatchTask[]
  pausedForApi: boolean
  pauseMessage: string | null
  lastStopReason: string | null
  needsLegacyMigration: boolean
} | null {
  try {
    const raw = localStorage.getItem(BATCH_QUEUE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || !Array.isArray(parsed.tasks)) return null
    const needsLegacyMigration = parsed.tasks.some((t: any) =>
      (t?.asrSegments && t.asrSegments.length > 0) || (t?.variants && t.variants.length > 0)
    )
    return {
      tasks: parsed.tasks,
      pausedForApi: !!parsed.pausedForApi,
      pauseMessage: parsed.pauseMessage || null,
      lastStopReason: parsed.lastStopReason || null,
      needsLegacyMigration
    }
  } catch {
    return null
  }
}

function resumeStageText(t: BatchTask): string {
  if (t.checkpoint === 'generate_done' || (t.variants && t.variants.length > 0)) {
    return '待继续（已生成，待导出）'
  }
  if (t.checkpoint === 'asr_done' || (t.asrSegments && t.asrSegments.length > 0) || t.hasDiskCheckpoint) {
    return '待继续（已识别，待AI）'
  }
  return '排队中'
}

/** After crash/refresh: in-progress tasks become queued. Optionally keep legacy payloads for one-time disk migration. */
function normalizeLoadedTasks(tasks: BatchTask[], keepLegacyPayload = false): BatchTask[] {
  return tasks.map((t) => {
    const inProgress =
      t.status === 'extracting' ||
      t.status === 'asr' ||
      t.status === 'generating' ||
      t.status === 'exporting'

    const checkpoint: BatchCheckpoint =
      t.checkpoint ||
      (t.variants?.length ? 'generate_done' : t.asrSegments?.length ? 'asr_done' : 'none')

    const hasDiskCheckpoint =
      t.status === 'done'
        ? false
        : !!(t.hasDiskCheckpoint || checkpoint === 'asr_done' || checkpoint === 'generate_done' || t.asrSegments?.length || t.variants?.length)

    const legacyAsr = keepLegacyPayload && t.status !== 'done' ? compactAsrSegments(t.asrSegments) : undefined
    const legacyVariants = keepLegacyPayload && t.status !== 'done' ? compactVariants(t.variants) : undefined

    if (inProgress) {
      return {
        ...t,
        status: 'queued' as const,
        stageText: resumeStageText({ ...t, checkpoint, hasDiskCheckpoint }),
        error: undefined,
        asrSegments: legacyAsr,
        variants: legacyVariants,
        checkpoint,
        hasDiskCheckpoint
      }
    }

    return {
      ...t,
      asrSegments: legacyAsr,
      variants: legacyVariants,
      variantCount: t.variantCount || 0,
      checkpoint,
      hasDiskCheckpoint
    }
  })
}

/** One-time: move old localStorage ASR/AI payloads onto disk, then strip from store. */
async function migrateLegacyCheckpointsToDisk(tasks: BatchTask[]): Promise<BatchTask[]> {
  if (typeof window === 'undefined' || typeof window.api?.saveBatchCheckpoint !== 'function') {
    return tasks.map((t) => ({ ...t, asrSegments: undefined, variants: undefined }))
  }

  const next: BatchTask[] = []
  for (const t of tasks) {
    if (t.status === 'done' || (!t.asrSegments?.length && !t.variants?.length)) {
      next.push({ ...t, asrSegments: undefined, variants: undefined })
      continue
    }

    const checkpoint: BatchCheckpoint =
      t.variants?.length ? 'generate_done' : t.asrSegments?.length ? 'asr_done' : (t.checkpoint || 'none')

    try {
      const res = await window.api.saveBatchCheckpoint(t.id, {
        checkpoint,
        asrSegments: compactAsrSegments(t.asrSegments),
        variants: compactVariants(t.variants),
        usedProviderName: t.usedProviderName,
        asrMs: t.asrMs,
        generateMs: t.generateMs
      })
      next.push({
        ...t,
        asrSegments: undefined,
        variants: undefined,
        checkpoint,
        hasDiskCheckpoint: !!res?.ok
      })
    } catch (err) {
      console.error('[batch] migrate checkpoint failed:', t.id, err)
      next.push({
        ...t,
        asrSegments: undefined,
        variants: undefined,
        checkpoint,
        hasDiskCheckpoint: false
      })
    }
  }
  return next
}

const restored = loadQueueSnapshot()

export const useBatchStore = create<BatchState>((set, get) => ({
  tasks: restored ? normalizeLoadedTasks(restored.tasks, restored.needsLegacyMigration) : [],
  running: false,
  pausedForApi: restored?.pausedForApi || false,
  pauseMessage: restored?.pauseMessage || null,
  currentTaskId: null,
  outputDir: loadOutputDir(),
  lastStopReason: restored?.lastStopReason || null,

  setOutputDir: (dir) => {
    saveOutputDir(dir)
    set({ outputDir: dir })
  },

  hydrateFromDisk: async () => {
    const disk = await loadPermanentSettings()
    const localDir = loadOutputDir()
    const diskDir = String(disk?.outputDir || '')
    const outputDir = diskDir || localDir || ''
    if (outputDir) {
      try { localStorage.setItem(OUTPUT_DIR_STORAGE_KEY, outputDir) } catch {}
      set({ outputDir })
      // ensure permanent file also has it
      savePermanentSettings({ outputDir })
    }
  },

  addTasks: (videos) => {
    const existing = new Set(get().tasks.map((t) => t.filePath))
    let orderNo = get().tasks.length
    const incoming: BatchTask[] = []
    for (const v of videos) {
      if (!v?.filePath || existing.has(v.filePath)) continue
      existing.add(v.filePath)
      orderNo += 1
      incoming.push({
        id: uid(),
        orderNo,
        filePath: v.filePath,
        fileName: v.fileName,
        duration: v.duration || 0,
        status: 'queued',
        stageText: '排队中',
        outputFiles: [],
        variantCount: 0,
        checkpoint: 'none',
        hasDiskCheckpoint: false
      })
    }
    if (incoming.length === 0) return
    const tasks = [...get().tasks, ...incoming]
    set({ tasks, lastStopReason: null })
    saveQueueSnapshot({ ...get(), tasks, lastStopReason: null })
  },

  clearFinished: () => {
    const finishedIds = get().tasks.filter((t) => t.status === 'done').map((t) => t.id)
    const tasks = get().tasks
      .filter((t) => t.status !== 'done')
      .map((t, i) => ({ ...t, orderNo: i + 1 }))
    set({ tasks })
    saveQueueSnapshot({ ...get(), tasks })
    // best-effort delete disk checkpoints for finished tasks
    if (finishedIds.length > 0 && typeof window !== 'undefined' && window.api?.deleteBatchCheckpoints) {
      void window.api.deleteBatchCheckpoints(finishedIds)
    }
  },

  removeTask: (id) => {
    const target = get().tasks.find((t) => t.id === id)
    if (!target) return

    // Do not remove the actively processing task mid-flight
    const activeStatuses = new Set(['extracting', 'asr', 'generating', 'exporting'])
    if (get().running && (get().currentTaskId === id || activeStatuses.has(target.status))) {
      return
    }

    const tasks = get().tasks
      .filter((t) => t.id !== id)
      .map((t, i) => ({ ...t, orderNo: i + 1 }))

    const next: Partial<BatchState> = { tasks }
    if (get().currentTaskId === id) next.currentTaskId = null
    set(next as any)
    saveQueueSnapshot({ ...get(), tasks })

    // cleanup disk checkpoint for removed task
    if (typeof window !== 'undefined' && window.api?.deleteBatchCheckpoint) {
      void window.api.deleteBatchCheckpoint(id)
    }
  },

  clearAll: () => {
    set({
      tasks: [],
      running: false,
      pausedForApi: false,
      pauseMessage: null,
      currentTaskId: null,
      lastStopReason: null
    })
    try { localStorage.removeItem(BATCH_QUEUE_STORAGE_KEY) } catch {}
    if (typeof window !== 'undefined' && window.api?.clearAllBatchCheckpoints) {
      void window.api.clearAllBatchCheckpoints()
    }
  },

  setRunning: (v) => set({ running: v }),

  setPausedForApi: (paused, message = null) => {
    const next = {
      pausedForApi: paused,
      pauseMessage: message,
      running: paused ? false : get().running,
      lastStopReason: paused ? (message || 'AI 失败暂停') : get().lastStopReason
    }
    set(next)
    saveQueueSnapshot({ ...get(), ...next })
  },

  setCurrentTaskId: (id) => set({ currentTaskId: id }),

  setLastStopReason: (reason) => {
    set({ lastStopReason: reason })
    saveQueueSnapshot({ ...get(), lastStopReason: reason })
  },

  updateTask: (id, partial) => {
    const tasks = get().tasks.map((t) => {
      if (t.id !== id) return t
      const merged = { ...t, ...partial }

      if (merged.status === 'done') {
        // Success: free memory; disk checkpoint deleted by processOne
        merged.asrSegments = undefined
        merged.variants = undefined
        merged.hasDiskCheckpoint = false
      } else {
        // Compact any temporary runtime caches
        if (merged.asrSegments) merged.asrSegments = compactAsrSegments(merged.asrSegments)
        if (merged.variants) merged.variants = compactVariants(merged.variants)
        if (merged.asrSegments?.length || merged.variants?.length || (merged.checkpoint && merged.checkpoint !== 'none')) {
          merged.hasDiskCheckpoint = true
        }
      }
      return merged
    })
    set({ tasks })
    saveQueueSnapshot({ ...get(), tasks })
  },

  prepareResume: () => {
    const tasks = get().tasks.map((t) => {
      if (t.status !== 'failed' && t.status !== 'paused_ai') return t
      return {
        ...t,
        status: 'queued' as const,
        stageText: resumeStageText(t),
        error: undefined,
        // keep hasDiskCheckpoint/checkpoint markers; heavy data stays on disk
        asrSegments: undefined,
        variants: undefined
      }
    })
    const next = {
      tasks,
      pausedForApi: false,
      pauseMessage: null as string | null,
      lastStopReason: null as string | null
    }
    set(next)
    saveQueueSnapshot({ ...get(), ...next })
  },

  getNextQueuedId: () => get().tasks.find((t) => t.status === 'queued')?.id || null,

  recoverInterrupted: () => {
    // Keep any temporary legacy payloads only long enough to migrate onto disk.
    const hasLegacy = get().tasks.some((t) => !!t.asrSegments?.length || !!t.variants?.length)
    const tasks = normalizeLoadedTasks(get().tasks, hasLegacy)
    set({ tasks, running: false, currentTaskId: null })
    saveQueueSnapshot({ ...get(), tasks })

    if (hasLegacy) {
      void migrateLegacyCheckpointsToDisk(tasks).then((migrated) => {
        // Only apply if queue id set still matches (avoid clobbering concurrent edits)
        const currentIds = useBatchStore.getState().tasks.map((t) => t.id).join('|')
        const migratedIds = migrated.map((t) => t.id).join('|')
        if (currentIds !== migratedIds) return
        set({ tasks: migrated })
        saveQueueSnapshot({ ...useBatchStore.getState(), tasks: migrated })
      })
    }
  },

  releaseMemoryAfterTask: (finishedTaskId = null) => {
    const tasks = get().tasks.map((task) => {
      // Always drop in-memory heavy payloads after a task ends.
      // Unfinished tasks keep checkpoint markers + disk files for resume.
      if (task.status === 'done') {
        if (!task.asrSegments && !task.variants && !task.hasDiskCheckpoint) return task
        return {
          ...task,
          asrSegments: undefined,
          variants: undefined,
          hasDiskCheckpoint: false
        }
      }

      // Keep metadata only in store; processOne will reload from disk when needed
      if (!task.asrSegments && !task.variants) return task
      return {
        ...task,
        asrSegments: undefined,
        variants: undefined,
        hasDiskCheckpoint:
          task.hasDiskCheckpoint ||
          task.checkpoint === 'asr_done' ||
          task.checkpoint === 'generate_done'
      }
    })

    set({ tasks })
    saveQueueSnapshot({ ...get(), tasks })

    // finished task: delete its disk checkpoint (success path)
    if (finishedTaskId) {
      const finished = tasks.find((t) => t.id === finishedTaskId)
      if (finished?.status === 'done' && typeof window !== 'undefined' && window.api?.deleteBatchCheckpoint) {
        void window.api.deleteBatchCheckpoint(finishedTaskId)
      }
    }

    try {
      const g: any = globalThis as any
      if (typeof g.gc === 'function') g.gc()
    } catch {}
  }
}))




