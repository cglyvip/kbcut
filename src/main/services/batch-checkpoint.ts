import { app } from 'electron'
import { join } from 'path'
import { mkdir, readFile, writeFile, unlink, readdir, rm, rename } from 'fs/promises'

export interface BatchCheckpointPayload {
  taskId: string
  checkpoint: 'none' | 'asr_done' | 'generate_done'
  asrSegments?: any[]
  variants?: any[]
  usedProviderName?: string
  asrMs?: number
  generateMs?: number
  updatedAt: number
}

function checkpointDir(): string {
  return join(app.getPath('userData'), 'batch-checkpoints')
}

function checkpointPath(taskId: string): string {
  const safeId = String(taskId || '').replace(/[\\/:*?"<>|]/g, '_')
  return join(checkpointDir(), `${safeId}.json`)
}

async function ensureDir(): Promise<string> {
  const dir = checkpointDir()
  await mkdir(dir, { recursive: true })
  return dir
}

export async function saveBatchCheckpoint(
  taskId: string,
  payload: Omit<BatchCheckpointPayload, 'taskId' | 'updatedAt'> & { updatedAt?: number }
): Promise<{ ok: boolean; path?: string; error?: string }> {
  try {
    if (!taskId) throw new Error('taskId 不能为空')
    await ensureDir()
    const full: BatchCheckpointPayload = {
      taskId,
      checkpoint: payload.checkpoint || 'none',
      asrSegments: payload.asrSegments,
      variants: payload.variants,
      usedProviderName: payload.usedProviderName,
      asrMs: payload.asrMs,
      generateMs: payload.generateMs,
      updatedAt: payload.updatedAt || Date.now()
    }
    const filePath = checkpointPath(taskId)
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tempPath, JSON.stringify(full), 'utf-8')
    try {
      await rename(tempPath, filePath)
    } catch {
      await rm(filePath, { force: true })
      await rename(tempPath, filePath)
    }
    return { ok: true, path: filePath }
  } catch (err: any) {
    console.error('[saveBatchCheckpoint]', err)
    return { ok: false, error: err?.message || String(err) }
  }
}

export async function loadBatchCheckpoint(
  taskId: string
): Promise<BatchCheckpointPayload | null> {
  try {
    if (!taskId) return null
    const filePath = checkpointPath(taskId)
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!parsed || parsed.taskId !== taskId) {
      // still accept if content looks valid
      if (!parsed || typeof parsed !== 'object') return null
    }
    return parsed as BatchCheckpointPayload
  } catch {
    return null
  }
}

export async function deleteBatchCheckpoint(
  taskId: string
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!taskId) return { ok: true }
    await unlink(checkpointPath(taskId))
    return { ok: true }
  } catch (err: any) {
    // missing file is fine
    if (err?.code === 'ENOENT') return { ok: true }
    console.error('[deleteBatchCheckpoint]', err)
    return { ok: false, error: err?.message || String(err) }
  }
}

export async function deleteBatchCheckpoints(
  taskIds: string[]
): Promise<{ ok: boolean; removed: number; error?: string }> {
  let removed = 0
  try {
    for (const id of taskIds || []) {
      const r = await deleteBatchCheckpoint(id)
      if (r.ok) removed++
    }
    return { ok: true, removed }
  } catch (err: any) {
    return { ok: false, removed, error: err?.message || String(err) }
  }
}

export async function clearAllBatchCheckpoints(): Promise<{ ok: boolean; error?: string }> {
  try {
    const dir = checkpointDir()
    await rm(dir, { recursive: true, force: true })
    await ensureDir()
    return { ok: true }
  } catch (err: any) {
    console.error('[clearAllBatchCheckpoints]', err)
    return { ok: false, error: err?.message || String(err) }
  }
}

export async function listBatchCheckpointIds(): Promise<string[]> {
  try {
    const dir = checkpointDir()
    const names = await readdir(dir)
    return names
      .filter((n) => n.endsWith('.json'))
      .map((n) => n.replace(/\.json$/, ''))
  } catch {
    return []
  }
}
