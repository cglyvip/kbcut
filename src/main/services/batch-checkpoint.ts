import { app } from 'electron'
import { join } from 'path'
import { mkdir, readFile, writeFile, unlink, readdir, rm, rename } from 'fs/promises'
import type { ModelTokenUsage } from './variant-generator'

export interface BatchCheckpointPayload {
  taskId: string
  checkpoint: 'none' | 'asr_done' | 'generate_done'
  asrSegments?: any[]
  variants?: any[]
  usedProviderName?: string
  usedModelName?: string
  modelUsages?: ModelTokenUsage[]
  asrMs?: number
  generateMs?: number
  updatedAt: number
}

function checkpointDir(): string {
  return join(app.getPath('userData'), 'batch-checkpoints')
}

function isValidTaskId(taskId: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(String(taskId || ''))
}

function checkpointPath(taskId: string): string {
  if (!isValidTaskId(taskId)) throw new Error('taskId 格式无效')
  return join(checkpointDir(), `${taskId}.json`)
}

function isFiniteNonNegative(value: unknown): boolean {
  return value === undefined || (Number.isFinite(Number(value)) && Number(value) >= 0)
}

function isValidPayload(payload: any): payload is BatchCheckpointPayload {
  if (!payload || typeof payload !== 'object' || !isValidTaskId(payload.taskId)) return false
  if (!['none', 'asr_done', 'generate_done'].includes(payload.checkpoint)) return false
  if (!Number.isFinite(Number(payload.updatedAt)) || Number(payload.updatedAt) <= 0) return false
  if (!isFiniteNonNegative(payload.asrMs) || !isFiniteNonNegative(payload.generateMs)) return false
  if (payload.checkpoint === 'asr_done' && (!Array.isArray(payload.asrSegments) || payload.asrSegments.length === 0)) return false
  if (payload.checkpoint === 'generate_done' && (!Array.isArray(payload.variants) || payload.variants.length === 0)) return false
  if (payload.asrSegments !== undefined && !Array.isArray(payload.asrSegments)) return false
  if (payload.variants !== undefined && !Array.isArray(payload.variants)) return false
  if (payload.modelUsages !== undefined && !Array.isArray(payload.modelUsages)) return false
  if (Array.isArray(payload.modelUsages) && payload.modelUsages.some((item: any) => (
    !item || typeof item !== 'object' ||
    !isFiniteNonNegative(item.requestCount) ||
    !isFiniteNonNegative(item.inputTokens) ||
    !isFiniteNonNegative(item.outputTokens)
  ))) return false
  return true
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
  let tempPath = ''
  try {
    if (!isValidTaskId(taskId)) throw new Error('taskId 格式无效')
    await ensureDir()
    const full: BatchCheckpointPayload = {
      taskId,
      checkpoint: payload.checkpoint || 'none',
      asrSegments: payload.asrSegments,
      variants: payload.variants,
      usedProviderName: payload.usedProviderName,
      usedModelName: payload.usedModelName,
      modelUsages: payload.modelUsages,
      asrMs: payload.asrMs,
      generateMs: payload.generateMs,
      updatedAt: payload.updatedAt || Date.now()
    }
    if (!isValidPayload(full)) throw new Error('断点内容不完整或格式无效')
    const filePath = checkpointPath(taskId)
    tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    await writeFile(tempPath, JSON.stringify(full), 'utf-8')
    try {
      await rename(tempPath, filePath)
    } catch {
      await rm(filePath, { force: true })
      await rename(tempPath, filePath)
    }
    return { ok: true, path: filePath }
  } catch (err: any) {
    if (tempPath) {
      try { await rm(tempPath, { force: true }) } catch {}
    }
    console.error('[saveBatchCheckpoint]', err)
    return { ok: false, error: err?.message || String(err) }
  }
}

export async function loadBatchCheckpoint(
  taskId: string
): Promise<BatchCheckpointPayload | null> {
  try {
    if (!isValidTaskId(taskId)) return null
    const filePath = checkpointPath(taskId)
    const raw = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!isValidPayload(parsed) || parsed.taskId !== taskId) return null
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
    if (!isValidTaskId(taskId)) return { ok: false, error: 'taskId 格式无效' }
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
