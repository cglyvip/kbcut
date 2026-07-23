import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
  }
}

const deleteBatchCheckpoint = vi.fn(async () => ({ ok: true }))
let useBatchStore: typeof import('../src/renderer/src/stores/useBatchStore').useBatchStore

beforeAll(async () => {
  const storage = new MemoryStorage()
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true })
  Object.defineProperty(globalThis, 'window', {
    value: {
      api: {
        deleteBatchCheckpoint,
        deleteBatchCheckpoints: vi.fn(async () => ({ ok: true, removed: 0 })),
        clearAllBatchCheckpoints: vi.fn(async () => ({ ok: true })),
        loadAppSettings: vi.fn(async () => null),
        saveAppSettings: vi.fn(async () => ({ ok: true }))
      }
    },
    configurable: true
  })
  useBatchStore = (await import('../src/renderer/src/stores/useBatchStore')).useBatchStore
})

beforeEach(() => {
  localStorage.clear()
  deleteBatchCheckpoint.mockClear()
  useBatchStore.setState({
    tasks: [],
    running: false,
    pausedForApi: false,
    pauseMessage: null,
    currentTaskId: null,
    outputDir: '',
    lastStopReason: null
  })
})

describe('batch queue', () => {
  it('keeps serial order, resumes failed work, and resets checkpoints', async () => {
    useBatchStore.getState().addTasks([
      { filePath: 'D:\\videos\\first.mp4', fileName: 'first.mp4', duration: 30 },
      { filePath: 'D:\\videos\\second.mp4', fileName: 'second.mp4', duration: 40 }
    ])

    const [first, second] = useBatchStore.getState().tasks
    expect(useBatchStore.getState().getNextQueuedId()).toBe(first.id)
    expect(second.orderNo).toBe(2)

    useBatchStore.getState().updateTask(first.id, { status: 'done', stageText: '完成' })
    expect(useBatchStore.getState().getNextQueuedId()).toBe(second.id)

    useBatchStore.getState().updateTask(second.id, {
      status: 'failed',
      stageText: '失败',
      checkpoint: 'asr_done',
      hasDiskCheckpoint: true,
      qualityScore: 82,
      diagnosticScore: 67,
      diagnosticMissing: ['信任证据'],
      llmInputTokens: 1200,
      llmOutputTokens: 300
    })
    useBatchStore.getState().prepareResume()

    const resumed = useBatchStore.getState().tasks.find((task) => task.id === second.id)
    expect(resumed?.status).toBe('queued')
    expect(resumed?.checkpoint).toBe('asr_done')
    expect(resumed?.hasDiskCheckpoint).toBe(true)
    expect(useBatchStore.getState().getNextQueuedId()).toBe(second.id)

    const reset = await useBatchStore.getState().resetTask(second.id)
    expect(reset).toBe(true)
    expect(deleteBatchCheckpoint).toHaveBeenCalledWith(second.id)

    const restarted = useBatchStore.getState().tasks.find((task) => task.id === second.id)
    expect(restarted?.checkpoint).toBe('none')
    expect(restarted?.hasDiskCheckpoint).toBe(false)
    expect(restarted?.status).toBe('queued')
    expect(restarted?.qualityScore).toBeUndefined()
    expect(restarted?.diagnosticMissing).toBeUndefined()
    expect(restarted?.llmInputTokens).toBeUndefined()
  })

  it('does not claim a resumable stage when disk persistence failed', () => {
    useBatchStore.getState().addTasks([
      { filePath: 'D:\\videos\\broken.mp4', fileName: 'broken.mp4', duration: 20 }
    ])
    const task = useBatchStore.getState().tasks[0]

    useBatchStore.getState().updateTask(task.id, {
      status: 'failed',
      stageText: '断点保存失败',
      checkpoint: 'asr_done',
      hasDiskCheckpoint: false
    })
    useBatchStore.getState().prepareResume()

    const resumed = useBatchStore.getState().tasks[0]
    expect(resumed.stageText).toBe('排队中')
    expect(resumed.hasDiskCheckpoint).toBe(false)
  })
})
