import { mkdtemp, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronState.userDataDir
  }
}))

import {
  deleteBatchCheckpoint,
  loadBatchCheckpoint,
  saveBatchCheckpoint
} from '../src/main/services/batch-checkpoint'

let testDir = ''

afterEach(async () => {
  if (testDir) await rm(testDir, { recursive: true, force: true })
  testDir = ''
})

describe('batch checkpoints', () => {
  it('atomically overwrites, loads, and deletes a checkpoint', async () => {
    testDir = await mkdtemp(join(tmpdir(), 'kbcut-checkpoint-test-'))
    electronState.userDataDir = testDir

    const taskId = 'task_001'
    const first = await saveBatchCheckpoint(taskId, {
      checkpoint: 'asr_done',
      asrSegments: [{ start: 0, end: 1, text: '第一句' }],
      asrMs: 1200
    })
    expect(first.ok).toBe(true)

    const second = await saveBatchCheckpoint(taskId, {
      checkpoint: 'generate_done',
      variants: [{ id: 1, name: '爆款1', segments: [] }],
      generateMs: 2300
    })
    expect(second.ok).toBe(true)

    const loaded = await loadBatchCheckpoint(taskId)
    expect(loaded?.checkpoint).toBe('generate_done')
    expect(loaded?.variants?.[0]?.name).toBe('爆款1')

    const files = await readdir(join(testDir, 'batch-checkpoints'))
    expect(files).toEqual([`${taskId}.json`])

    expect((await deleteBatchCheckpoint(taskId)).ok).toBe(true)
    expect(await loadBatchCheckpoint(taskId)).toBeNull()
  })
})
