import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAsrStore, buildEditableWords, resolveIncludedSegments } from '../../stores/useAsrStore'
import { useLlmStore } from '../../stores/useLlmStore'
import { useBatchStore, compactAsrSegments, compactVariants, type BatchTask, type CachedAsrSegment, type CachedVariant } from '../../stores/useBatchStore'

function statusLabel(status: BatchTask['status']): string {
  switch (status) {
    case 'queued': return '排队中'
    case 'extracting': return '准备中'
    case 'asr': return '识别中'
    case 'generating': return 'AI重组中'
    case 'exporting': return '导出中'
    case 'done': return '已完成'
    case 'failed': return '失败'
    case 'paused_ai': return 'AI失败暂停'
    default: return status
  }
}

function statusColor(status: BatchTask['status']): string {
  switch (status) {
    case 'done': return '#52c41a'
    case 'failed': return '#ff4d4f'
    case 'paused_ai': return '#fa8c16'
    case 'queued': return '#8c8c8c'
    default: return '#1677ff'
  }
}

function sanitizeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 40) || 'video'
}

function formatDurationMs(ms?: number): string {
  if (ms === undefined || ms === null || Number.isNaN(ms)) return '-'
  const sec = ms / 1000
  if (sec < 10) return `${sec.toFixed(1)}s`
  if (sec < 60) return `${Math.round(sec)}s`
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}分${s}秒`
}

async function persistCheckpoint(
  taskId: string,
  payload: {
    checkpoint: 'none' | 'asr_done' | 'generate_done'
    asrSegments?: CachedAsrSegment[]
    variants?: CachedVariant[]
    usedProviderName?: string
    asrMs?: number
    generateMs?: number
  }
): Promise<boolean> {
  try {
    if (typeof window.api.saveBatchCheckpoint !== 'function') return false
    const res = await window.api.saveBatchCheckpoint(taskId, {
      checkpoint: payload.checkpoint,
      asrSegments: compactAsrSegments(payload.asrSegments),
      variants: compactVariants(payload.variants),
      usedProviderName: payload.usedProviderName,
      asrMs: payload.asrMs,
      generateMs: payload.generateMs
    })
    if (!res?.ok) {
      console.error('[batch] save checkpoint failed:', res?.error)
      return false
    }
    return true
  } catch (err) {
    console.error('[batch] save checkpoint error:', err)
    return false
  }
}

async function loadCheckpointFromDisk(taskId: string): Promise<{
  asrSegments?: CachedAsrSegment[]
  variants?: CachedVariant[]
  usedProviderName?: string
  asrMs?: number
  generateMs?: number
  checkpoint?: 'none' | 'asr_done' | 'generate_done'
} | null> {
  try {
    if (typeof window.api.loadBatchCheckpoint !== 'function') return null
    const data = await window.api.loadBatchCheckpoint(taskId)
    if (!data) return null
    return {
      asrSegments: compactAsrSegments(data.asrSegments),
      variants: compactVariants(data.variants),
      usedProviderName: data.usedProviderName,
      asrMs: data.asrMs,
      generateMs: data.generateMs,
      checkpoint: data.checkpoint
    }
  } catch (err) {
    console.error('[batch] load checkpoint error:', err)
    return null
  }
}

export default function BatchPanel() {
  const {
    tasks, running, pausedForApi, pauseMessage, currentTaskId, outputDir, lastStopReason,
    setOutputDir, addTasks, clearFinished, removeTask, resetTask, clearAll, setRunning, setPausedForApi,
    setCurrentTaskId, setLastStopReason, updateTask, prepareResume, recoverInterrupted
  } = useBatchStore()

  const asrSettings = useAsrStore((s) => s.settings)
  const {
    providers,
    promoteProvider,
    minDuration,
    maxDuration,
    variantCount,
    topFluencyOnly,
    enableSubtitle,
    exportResolution
  } = useLlmStore()

  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  const stopRef = useRef(false)
  const startedRef = useRef(false)

  // Restore unfinished queue after refresh/crash and normalize interrupted statuses
  useEffect(() => {
    recoverInterrupted()
  }, [recoverInterrupted])

  const safeReleaseMemory = useCallback(async (taskId?: string | null) => {
    try {
      const release = useBatchStore.getState().releaseMemoryAfterTask
      if (typeof release === 'function') {
        release(taskId)
      }
    } catch (err) {
      console.error('[batch] releaseMemoryAfterTask failed:', err)
    }
    try {
      if (typeof window.api.cleanupBatchMemory === 'function') {
        await window.api.cleanupBatchMemory()
      }
    } catch (err) {
      console.error('[batch] cleanupBatchMemory failed:', err)
    }
  }, [])

  const enabledProviders = useMemo(
    () => providers.filter((p) => p.enabled && p.apiKey.trim() && p.baseUrl.trim() && p.model.trim()),
    [providers]
  )

  const stats = useMemo(() => {
    const total = tasks.length
    const done = tasks.filter((t) => t.status === 'done').length
    const failed = tasks.filter((t) => t.status === 'failed' || t.status === 'paused_ai').length
    const queued = tasks.filter((t) => t.status === 'queued').length
    return { total, done, failed, queued }
  }, [tasks])

  const VIDEO_EXTS = ['mp4', 'mov', 'avi', 'mkv', 'flv', 'wmv']

  const importVideoFilesInOrder = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files || [])
    // Keep drop/select order exactly as provided by OS/browser FileList
    const videos: { filePath: string; fileName: string; duration: number }[] = []
    const skipped: string[] = []

    for (const file of list) {
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      if (!VIDEO_EXTS.includes(ext)) {
        skipped.push(file.name)
        continue
      }
      try {
        const filePath = window.api.getPathForFile(file)
        if (!filePath) {
          skipped.push(file.name)
          continue
        }
        const info = await window.api.getVideoInfo(filePath)
        videos.push({
          filePath: info.filePath,
          fileName: info.fileName,
          duration: info.duration
        })
      } catch {
        skipped.push(file.name)
      }
    }

    if (videos.length > 0) {
      addTasks(videos)
    }

    if (skipped.length > 0 && videos.length === 0) {
      setError(`没有可导入的视频。已跳过：${skipped.slice(0, 3).join('、')}${skipped.length > 3 ? ' 等' : ''}`)
    } else if (skipped.length > 0) {
      setError(`已按拖入顺序导入 ${videos.length} 个；跳过 ${skipped.length} 个非视频/失败文件`)
    } else {
      setError(null)
    }
  }, [addTasks])

  const handleSelectVideos = useCallback(async () => {
    setError(null)
    try {
      const videos = await window.api.selectVideos()
      if (!videos?.length) return
      // dialog multi-select order is preserved by OS selection order
      addTasks(videos.map((v) => ({
        filePath: v.filePath,
        fileName: v.fileName,
        duration: v.duration
      })))
    } catch (e: any) {
      setError(e?.message || String(e))
    }
  }, [addTasks])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (running || importing) return
    setDragOver(true)
  }, [running, importing])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    if (running || importing) return

    const files = e.dataTransfer.files
    if (!files || files.length === 0) return

    setImporting(true)
    setError(null)
    try {
      await importVideoFilesInOrder(files)
    } catch (err: any) {
      setError(err?.message || String(err))
    } finally {
      setImporting(false)
    }
  }, [running, importing, importVideoFilesInOrder])

  const handleSelectOutput = useCallback(async () => {
    const dir = await window.api.selectOutputDir()
    if (dir) setOutputDir(dir)
  }, [setOutputDir])

  const processOne = useCallback(async (task: BatchTask) => {
    setCurrentTaskId(task.id)

    // Runtime-only payload for current task. Never keep whole queue payloads in memory.
    let asrMs = task.asrMs
    let generateMs = task.generateMs
    let exportMs = task.exportMs
    let included = compactAsrSegments(task.asrSegments)
    let variants = compactVariants(task.variants)
    let usedProviderName = task.usedProviderName
    let checkpoint = task.checkpoint || 'none'

    updateTask(task.id, {
      error: undefined,
      outputFiles: []
    })

    // Load disk checkpoint when resuming (store only keeps markers)
    if ((!included || !included.length || !variants || !variants.length) && task.hasDiskCheckpoint) {
      updateTask(task.id, {
        status: 'extracting',
        stageText: '读取断点缓存...'
      })
      const disk = await loadCheckpointFromDisk(task.id)
      if (disk) {
        if (!included?.length && disk.asrSegments?.length) {
          included = compactAsrSegments(disk.asrSegments)
        }
        if (!variants?.length && disk.variants?.length) {
          variants = compactVariants(disk.variants)
        }
        if (disk.usedProviderName) usedProviderName = disk.usedProviderName
        if (disk.asrMs != null) asrMs = disk.asrMs
        if (disk.generateMs != null) generateMs = disk.generateMs
        if (disk.checkpoint) checkpoint = disk.checkpoint
      }
    }

    // 1) ASR (skip if variants already ready, or ASR already cached on disk)
    if (variants && variants.length > 0) {
      // generate_done checkpoint may not keep ASR payload — do not re-run recognition
      updateTask(task.id, {
        status: 'exporting',
        stageText: `跳过识别与AI（已缓存 ${formatDurationMs(generateMs)}），继续导出...`,
        checkpoint: 'generate_done',
        hasDiskCheckpoint: true,
        variantCount: variants.length,
        usedProviderName,
        asrMs,
        generateMs
      })
    } else if (included && included.length > 0) {
      updateTask(task.id, {
        status: 'generating',
        stageText: `跳过识别（已缓存 ${formatDurationMs(asrMs)}），继续 AI 重组...`,
        checkpoint: 'asr_done',
        hasDiskCheckpoint: true,
        asrMs
      })
    } else {
      updateTask(task.id, {
        status: 'asr',
        stageText: `语音识别中（${asrSettings.mode === 'online' ? '在线' : '本地'}）`
      })
      const asrStart = Date.now()
      const asr = await window.api.asrRecognize({
        videoPath: task.filePath,
        mode: asrSettings.mode,
        apiKey: asrSettings.apiKey,
        baseUrl: asrSettings.baseUrl,
        model: asrSettings.model
      })
      asrMs = Date.now() - asrStart

      const storeSegs = (asr.segments || []).map((seg) => ({
        start: seg.start,
        end: seg.end,
        text: seg.text,
        words: buildEditableWords(seg.start, seg.end, seg.text, seg.words)
      }))
      included = compactAsrSegments(resolveIncludedSegments(storeSegs))
      // free intermediate objects ASAP
      // @ts-ignore
      storeSegs.length = 0
      if (!included || !included.length) {
        throw new Error('识别结果为空，无法生成变体')
      }

      // Persist ASR checkpoint to disk (not localStorage)
      const saved = await persistCheckpoint(task.id, {
        checkpoint: 'asr_done',
        asrSegments: included,
        asrMs
      })
      updateTask(task.id, {
        asrMs,
        // keep only marker in store; payload stays in local var + disk
        asrSegments: undefined,
        checkpoint: 'asr_done',
        hasDiskCheckpoint: saved,
        stageText: `识别完成（${formatDurationMs(asrMs)}）`
      })
      checkpoint = 'asr_done'
    }

    // 2) Generate (skip if variants already cached from disk)
    if (variants && variants.length > 0) {
      // already jumped to export status above when loaded from disk
    } else {
      if (!included || included.length === 0) {
        throw new Error('缺少识别结果，无法继续 AI 重组')
      }

      updateTask(task.id, { status: 'generating', stageText: 'AI 重组爆款中...' })
      const genStart = Date.now()
      let gen
      try {
        gen = await window.api.generateVariants({
          segments: included,
          minDuration,
          maxDuration,
          variantCount,
          topFluencyOnly,
          topFluencyCount: 3,
          providers: enabledProviders,
          allowFallback: false
        })
      } catch (e: any) {
        generateMs = Date.now() - genStart
        const msg = e?.message || String(e)
        // Keep ASR on disk for resume; do not re-run recognition
        await persistCheckpoint(task.id, {
          checkpoint: 'asr_done',
          asrSegments: included,
          asrMs,
          generateMs
        })
        updateTask(task.id, {
          status: 'paused_ai',
          stageText: 'AI 失败，已暂停队列（识别结果已落盘）',
          error: msg,
          asrSegments: undefined,
          variants: undefined,
          checkpoint: 'asr_done',
          hasDiskCheckpoint: true,
          asrMs,
          generateMs,
          totalMs: (asrMs || 0) + (generateMs || 0)
        })
        setPausedForApi(true, msg)
        throw Object.assign(new Error(msg), { code: 'AI_ALL_FAILED' })
      }

      generateMs = Date.now() - genStart
      if (gen.usedProvider?.id) {
        promoteProvider(gen.usedProvider.id)
      }
      variants = compactVariants(gen.variants || [])
      usedProviderName = gen.usedProvider?.name || gen.usedProvider?.model
      // drop large response ASAP
      gen = null as any
      if (!variants || !variants.length) {
        throw new Error('未生成可用变体')
      }

      // Persist generate checkpoint; ASR can be dropped from disk payload after generate
      const saved = await persistCheckpoint(task.id, {
        checkpoint: 'generate_done',
        variants,
        usedProviderName,
        asrMs,
        generateMs
      })
      updateTask(task.id, {
        generateMs,
        variants: undefined,
        asrSegments: undefined,
        variantCount: variants.length,
        usedProviderName,
        checkpoint: 'generate_done',
        hasDiskCheckpoint: saved,
        stageText: `AI重组完成（${formatDurationMs(generateMs)}）`
      })
      checkpoint = 'generate_done'
      // free ASR memory after generate done
      included = undefined
    }

    // 3) Export
    if (!variants || variants.length === 0) {
      throw new Error('缺少变体结果，无法导出')
    }

    updateTask(task.id, {
      status: 'exporting',
      stageText: `导出中（${variants.length} 个变体）...`,
      variantCount: variants.length,
      usedProviderName,
      asrMs,
      generateMs
    })

    const baseName = sanitizeName(task.fileName.replace(/\.[^.]+$/, '')) || `video_${task.orderNo}`
    // include orderNo to avoid collisions when names sanitize to same folder
    const stableTaskSuffix = task.id.replace(/^t_/, '').slice(-8)
    const folderName = `${String(task.orderNo).padStart(3, '0')}_${baseName}_${stableTaskSuffix}`
    const taskOutputDir = `${outputDir}\\${folderName}`

    // Live progress + ETA so UI doesn't look frozen
    const variantTotal = variants.length
    let lastProgressAt = Date.now()
    let lastDetail = ''
    const stopProgress = typeof window.api.onExportProgress === 'function'
      ? window.api.onExportProgress((data) => {
          lastProgressAt = Date.now()
          const detail = data?.detail ? ` · ${data.detail}` : ''
          lastDetail = detail
          updateTask(task.id, {
            status: 'exporting',
            stageText: `导出中 ${data.current || 0}/${data.total || variantTotal}${detail}`
          })
        })
      : () => {}

    // Local heartbeat: if no progress event for a while, show waiting text
    const heartbeat = window.setInterval(() => {
      const idleSec = Math.round((Date.now() - lastProgressAt) / 1000)
      if (idleSec >= 8) {
        updateTask(task.id, {
          status: 'exporting',
          stageText: `导出中（等待编码响应 ${idleSec}s）${lastDetail || ''}`
        })
      }
    }, 1000)

    const exportStart = Date.now()
    let exportResult
    try {
      // FFmpeg has its own hard timeout and stall watchdog. Await the IPC call so a timed-out
      // renderer task cannot leave an orphan export running while the next task starts.
      exportResult = await window.api.exportVariants({
        videoPath: task.filePath,
        variants,
        outputDir: taskOutputDir,
        enableSubtitle,
        exportResolution
      })
    } finally {
      window.clearInterval(heartbeat)
      try { stopProgress() } catch {}
    }
    exportMs = Date.now() - exportStart

    if (!exportResult.files?.length) {
      // keep generate checkpoint for retry export
      await persistCheckpoint(task.id, {
        checkpoint: 'generate_done',
        variants,
        usedProviderName,
        asrMs,
        generateMs
      })
      updateTask(task.id, {
        asrMs,
        generateMs,
        exportMs,
        totalMs: (asrMs || 0) + (generateMs || 0) + (exportMs || 0),
        asrSegments: undefined,
        variants: undefined,
        checkpoint: 'generate_done',
        hasDiskCheckpoint: true
      })
      throw new Error(exportResult.errors?.join('; ') || '导出失败，未生成文件')
    }

    if (exportResult.errors?.length) {
      await persistCheckpoint(task.id, {
        checkpoint: 'generate_done',
        variants,
        usedProviderName,
        asrMs,
        generateMs
      })
      updateTask(task.id, {
        outputFiles: exportResult.files,
        variantCount: variants.length,
        asrMs,
        generateMs,
        exportMs,
        totalMs: (asrMs || 0) + (generateMs || 0) + (exportMs || 0),
        checkpoint: 'generate_done',
        hasDiskCheckpoint: true
      })
      throw new Error(
        `部分导出失败：成功 ${exportResult.files.length}/${variants.length} 个。已保留 AI 断点，可点击继续重试。\n${exportResult.errors.join('; ')}`
      )
    }

    const totalMs = (asrMs || 0) + (generateMs || 0) + (exportMs || 0)
    updateTask(task.id, {
      status: 'done',
      stageText: `完成，导出 ${exportResult.files.length} 个`,
      outputFiles: exportResult.files,
      variantCount: variants.length,
      asrMs,
      generateMs,
      exportMs,
      totalMs,
      asrSegments: undefined,
      variants: undefined,
      checkpoint: 'generate_done',
      hasDiskCheckpoint: false,
      error: exportResult.errors?.length ? exportResult.errors.join('; ') : undefined
    })

    // success: remove disk checkpoint
    try {
      if (typeof window.api.deleteBatchCheckpoint === 'function') {
        await window.api.deleteBatchCheckpoint(task.id)
      }
    } catch (err) {
      console.error('[batch] delete checkpoint failed:', err)
    }

    // local refs free
    included = undefined
    variants = undefined
  }, [
    asrSettings, enabledProviders, minDuration, maxDuration, variantCount,
    topFluencyOnly, enableSubtitle, exportResolution, outputDir, promoteProvider, setCurrentTaskId,
    setPausedForApi, updateTask
  ])

  const runQueue = useCallback(async () => {
    if (running || startedRef.current) return
    setError(null)

    if (!outputDir) {
      setError('请先选择输出文件夹')
      return
    }
    if (enabledProviders.length === 0) {
      setError('请先在设置中配置并启用至少一个大模型 API')
      return
    }
    if (asrSettings.mode === 'online' && (!asrSettings.apiKey || !asrSettings.baseUrl)) {
      setError('在线识别需要在设置中填写 Whisper API 地址和 Key')
      return
    }

    const state0 = useBatchStore.getState()
    const hasQueued = state0.tasks.some((t) => t.status === 'queued')
    const hasResumable = state0.tasks.some((t) => t.status === 'paused_ai' || t.status === 'failed')
    if (!hasQueued && hasResumable) {
      prepareResume()
    } else if (!hasQueued) {
      setError('没有排队中的任务')
      return
    }

    stopRef.current = false
    startedRef.current = true
    setRunning(true)
    setPausedForApi(false, null)
    setLastStopReason(null)

    try {
      let consecutiveEmptyReads = 0
      while (!stopRef.current) {
        // Always read latest queue from store (avoid stale closure / lost tasks)
        const nextId = useBatchStore.getState().getNextQueuedId()
        if (!nextId) {
          consecutiveEmptyReads += 1
          if (consecutiveEmptyReads >= 3) break
          await new Promise((resolve) => setTimeout(resolve, 250))
          continue
        }
        consecutiveEmptyReads = 0
        const task = useBatchStore.getState().tasks.find((t) => t.id === nextId)
        if (!task) {
          await new Promise((resolve) => setTimeout(resolve, 100))
          continue
        }

        try {
          await processOne(task)
        } catch (e: any) {
          if (e?.code === 'AI_ALL_FAILED') {
            // keep ASR checkpoint on disk for resume; still compact memory for other tasks
            await safeReleaseMemory(task.id)
            setLastStopReason(e?.message || 'AI 全部失败，队列已暂停')
            break
          }
          const prev = useBatchStore.getState().tasks.find((x) => x.id === task.id)
          // Non-AI failure: if we already had ASR, keep it on disk for smarter retry
          if (prev?.checkpoint === 'asr_done' || prev?.checkpoint === 'generate_done' || prev?.hasDiskCheckpoint) {
            // already persisted in processOne when possible
          }
          updateTask(task.id, {
            status: 'failed',
            stageText: '当前任务失败，继续下一条',
            error: e?.message || String(e),
            totalMs: prev?.totalMs,
            asrSegments: undefined,
            variants: undefined
          })
        } finally {
          // Every task ends: clear finished caches + temp files + optional GC
          await safeReleaseMemory(task.id)
          // yield to event loop so UI stays responsive and GC can run
          await new Promise((r) => setTimeout(r, 50))
        }
      }

      if (stopRef.current) {
        setLastStopReason('已手动停止（当前条结束后停止）')
      } else if (!useBatchStore.getState().pausedForApi) {
        const left = useBatchStore.getState().tasks.filter((t) => t.status === 'queued').length
        const failed = useBatchStore.getState().tasks.filter((t) => t.status === 'failed' || t.status === 'paused_ai').length
        if (left === 0) {
          setLastStopReason(failed > 0 ? `队列结束：有 ${failed} 条失败/暂停` : '全部任务处理完成')
        }
      }
    } catch (e: any) {
      // Prevent uncaught error from tearing down React tree / looking like "back to home"
      const msg = e?.message || String(e)
      setError(`队列异常中断：${msg}`)
      setLastStopReason(`队列异常中断：${msg}`)
      console.error('[batch] queue crashed:', e)
    } finally {
      startedRef.current = false
      setRunning(false)
      setCurrentTaskId(null)
    }
  }, [
    running, outputDir, enabledProviders, asrSettings,
    processOne, setRunning, setPausedForApi, setCurrentTaskId, updateTask, prepareResume, setLastStopReason,
    safeReleaseMemory
  ])

  const handleStop = () => {
    stopRef.current = true
    setLastStopReason('正在停止：等待当前视频处理结束后暂停')
  }

  const handleResumeAfterApiFix = () => {
    // keep paused task + failed AI as queued-like for retry
    prepareResume()
    // next tick run
    setTimeout(() => {
      void runQueue()
    }, 0)
  }

  const handleResetTask = async (task: BatchTask) => {
    const confirmed = window.confirm(
      `确定重置任务「${task.fileName}」吗？\n\n将清除识别、AI、导出状态和断点缓存，下次从语音识别重新开始。已导出的磁盘文件不会删除。`
    )
    if (!confirmed) return

    setError(null)
    const ok = await resetTask(task.id)
    if (!ok) {
      setError('任务正在处理中，当前无法重置。请先停止队列，等待当前任务结束。')
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.headerRow}>
          <div>
            <h3 style={styles.title}>全自动批量（串行队列）</h3>
            <p style={styles.desc}>按拖入顺序一条做完再下一条：识别 → AI重组 → 导出。断点落盘，暂停续跑不重识别。</p>
          </div>
        </div>

        <div
          style={{
            ...styles.dropZone,
            ...(dragOver ? styles.dropZoneActive : {}),
            ...((running || importing) ? styles.dropZoneDisabled : {})
          }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => {
            if (!running && !importing) void handleSelectVideos()
          }}
        >
          <div style={styles.dropTitle}>{importing ? '正在导入...' : '拖入口播视频到这里'}</div>
          <div style={styles.dropDesc}>支持多选/多文件拖入，按拖入顺序排队</div>
          <div style={styles.dropHint}>也可点击此处选择文件</div>
        </div>

        <div style={styles.controls}>
          <button style={styles.btn} onClick={handleSelectVideos} disabled={running || importing}>选择视频</button>
          <button style={styles.btn} onClick={handleSelectOutput} disabled={running}>
            {outputDir ? '更换输出目录' : '选择输出目录'}
          </button>
          {!running ? (
            <button
              style={styles.primaryBtn}
              onClick={() => { void runQueue() }}
              disabled={importing || tasks.length === 0}
            >
              {pausedForApi ? '修复API后继续' : '开始全自动'}
            </button>
          ) : (
            <button style={styles.warnBtn} onClick={handleStop}>停止（当前条结束后）</button>
          )}
          <button style={styles.btn} onClick={clearFinished} disabled={running}>清除已完成</button>
          <button style={styles.dangerBtn} onClick={clearAll} disabled={running}>清空队列</button>
        </div>

        <div style={styles.metaRow}>
          <span>输出：{outputDir || '未选择（会记住）'}</span>
          <span>总数 {stats.total}</span>
          <span>完成 {stats.done}</span>
          <span>失败/暂停 {stats.failed}</span>
          <span>排队 {stats.queued}</span>
        </div>

        <div style={styles.infoBox}>
          <div style={styles.infoTitle}>批量说明</div>
          <div style={styles.infoText}>
            1. 识别/AI 结果写入本地断点文件，队列元数据保持轻量，避免 localStorage 撑爆。<br />
            2. AI 全部失败会暂停整队并提醒换 API；续跑从 AI 或导出阶段继续，不重跑已完成识别。<br />
            3. 每条结束后清理内存与临时文件；成功任务自动删除其断点缓存。
          </div>
        </div>

        {pausedForApi && (
          <div style={styles.pauseBox}>
            <div style={styles.pauseTitle}>AI 失败，队列已暂停</div>
            <div style={styles.pauseText}>{pauseMessage || '请到设置中检查/更换大模型 API，然后点继续'}</div>
            <div style={styles.pauseActions}>
              <button style={styles.primaryBtn} onClick={handleResumeAfterApiFix} disabled={running}>
                已更换API，继续队列
              </button>
            </div>
          </div>
        )}

        {error && <div style={styles.error}>{error}</div>}
        {lastStopReason && !error && (
          <div style={{ ...styles.error, color: '#595959' }}>{lastStopReason}</div>
        )}

        <div style={styles.list}>
          {tasks.length === 0 && <div style={styles.empty}>还没有任务，拖入或选择视频开始</div>}
          {tasks.map((t) => (
            <div
              key={t.id}
              style={{
                ...styles.item,
                ...(currentTaskId === t.id ? styles.itemActive : {})
              }}
            >
              <div style={styles.itemTop}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                  <span style={styles.orderNo}>#{t.orderNo}</span>
                  <div style={styles.fileName} title={t.filePath}>{t.fileName}</div>
                </div>
                <div style={styles.itemActions}>
                  <span style={{ ...styles.badge, background: statusColor(t.status) }}>
                    {statusLabel(t.status)}
                  </span>
                  <button
                    style={{
                      ...styles.resetBtn,
                      ...(running ? styles.btnDisabled : {})
                    }}
                    disabled={running}
                    title={running ? '队列运行中，无法重置' : '清除该任务断点并从语音识别重新开始'}
                    onClick={(e) => {
                      e.stopPropagation()
                      void handleResetTask(t)
                    }}
                  >重置</button>
                  <button
                    style={{
                      ...styles.removeBtn,
                      ...((running && (currentTaskId === t.id || t.status === 'extracting' || t.status === 'asr' || t.status === 'generating' || t.status === 'exporting'))
                        ? styles.btnDisabled
                        : {})
                    }}
                    disabled={running && (currentTaskId === t.id || t.status === 'extracting' || t.status === 'asr' || t.status === 'generating' || t.status === 'exporting')}
                    title={
                      running && (currentTaskId === t.id || t.status === 'extracting' || t.status === 'asr' || t.status === 'generating' || t.status === 'exporting')
                        ? '正在处理中，无法删除'
                        : '从队列删除'
                    }
                    onClick={(e) => {
                      e.stopPropagation()
                      removeTask(t.id)
                    }}
                  >删除</button>
                </div>
              </div>
              <div style={styles.itemMeta}>
                <span>{t.stageText}</span>
                {t.variantCount > 0 && <span>变体 {t.variantCount}</span>}
                {t.usedProviderName && <span>模型 {t.usedProviderName}</span>}
                {(t.checkpoint === 'asr_done' || t.checkpoint === 'generate_done' || t.hasDiskCheckpoint) && t.status !== 'done' && (
                  <span style={styles.cpTag}>
                    {t.checkpoint === 'generate_done' ? '断点: 已AI' : '断点: 已识别'}
                  </span>
                )}
                {t.outputFiles.length > 0 && (
                  <button
                    style={styles.linkBtn}
                    onClick={() => {
                      const first = t.outputFiles[0]
                      const folder = first ? first.replace(/\\[^\\/]+$/, '') : outputDir
                      window.api.openFolder(folder || outputDir)
                    }}
                  >打开输出</button>
                )}
              </div>
              <div style={styles.timeRow}>
                <span style={styles.timeChip}>识别 {formatDurationMs(t.asrMs)}</span>
                <span style={styles.timeChip}>AI重组 {formatDurationMs(t.generateMs)}</span>
                <span style={styles.timeChip}>导出 {formatDurationMs(t.exportMs)}</span>
                <span style={{ ...styles.timeChip, ...styles.timeChipTotal }}>总耗时 {formatDurationMs(t.totalMs)}</span>
              </div>
              {t.error && <div style={styles.itemError}>{t.error}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '0 40px 24px' },
  card: {
    background: '#fff', borderRadius: 12, padding: 20,
    boxShadow: '0 2px 12px rgba(0,0,0,0.06)'
  },
  headerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 },
  title: { margin: 0, fontSize: 16, color: '#1a1a2e' },
  desc: { margin: '6px 0 0', fontSize: 12, color: '#8c8c8c' },
  dropZone: {
    border: '2px dashed #d9d9d9', borderRadius: 12, padding: '22px 16px',
    textAlign: 'center' as const, background: '#fafafa', marginBottom: 12,
    cursor: 'pointer', transition: 'all 0.2s'
  },
  dropZoneActive: {
    borderColor: '#1677ff', background: '#e6f4ff', transform: 'scale(1.01)'
  },
  dropZoneDisabled: {
    opacity: 0.6, cursor: 'not-allowed'
  },
  dropTitle: { fontSize: 15, fontWeight: 600, color: '#262626', marginBottom: 6 },
  dropDesc: { fontSize: 12, color: '#595959', marginBottom: 4 },
  dropHint: { fontSize: 12, color: '#8c8c8c' },
  orderNo: {
    fontSize: 12, color: '#1677ff', background: '#e6f4ff', borderRadius: 999,
    padding: '2px 8px', fontWeight: 600, flexShrink: 0
  },
  controls: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginBottom: 12 },
  btn: {
    border: '1px solid #d9d9d9', background: '#fff', color: '#262626',
    borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 13
  },
  primaryBtn: {
    border: 'none', background: '#1677ff', color: '#fff',
    borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 500
  },
  btnDisabled: { opacity: 0.6, cursor: 'not-allowed' },
  warnBtn: {
    border: 'none', background: '#fa8c16', color: '#fff',
    borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 13, fontWeight: 500
  },
  dangerBtn: {
    border: '1px solid #ffa39e', background: '#fff1f0', color: '#ff4d4f',
    borderRadius: 6, padding: '7px 12px', cursor: 'pointer', fontSize: 13
  },
  metaRow: { display: 'flex', flexWrap: 'wrap' as const, gap: 14, fontSize: 12, color: '#595959', marginBottom: 12 },
  infoBox: {
    background: '#f5f5f5', border: '1px solid #e8e8e8', borderRadius: 8,
    padding: 12, marginBottom: 12
  },
  infoTitle: { fontSize: 13, fontWeight: 600, color: '#262626', marginBottom: 4 },
  infoText: { fontSize: 12, color: '#595959', lineHeight: 1.6 },
  pauseBox: {
    background: '#fff7e6', border: '1px solid #ffd591', borderRadius: 8,
    padding: 12, marginBottom: 12
  },
  pauseTitle: { fontSize: 14, fontWeight: 600, color: '#d46b08', marginBottom: 6 },
  pauseText: { fontSize: 12, color: '#8c8c8c', whiteSpace: 'pre-wrap' as const, lineHeight: 1.6 },
  pauseActions: { marginTop: 10 },
  error: { color: '#ff4d4f', fontSize: 13, margin: '0 0 10px' },
  list: { display: 'flex', flexDirection: 'column' as const, gap: 8, maxHeight: 420, overflowY: 'auto' as const },
  empty: { padding: 24, textAlign: 'center' as const, color: '#8c8c8c', fontSize: 13 },
  item: { border: '1px solid #f0f0f0', borderRadius: 8, padding: '10px 12px', background: '#fafafa' },
  itemActive: { borderColor: '#91caff', background: '#f0f7ff' },
  itemTop: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' },
  itemActions: { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  removeBtn: {
    border: '1px solid #ffa39e', background: '#fff1f0', color: '#ff4d4f',
    borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 12
  },
  resetBtn: {
    border: '1px solid #ffd591', background: '#fff7e6', color: '#d46b08',
    borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 12
  },
  fileName: { fontSize: 13, color: '#262626', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  badge: { color: '#fff', borderRadius: 999, padding: '2px 8px', fontSize: 11, flexShrink: 0 },
  itemMeta: { display: 'flex', flexWrap: 'wrap' as const, gap: 10, marginTop: 6, fontSize: 12, color: '#8c8c8c' },
  cpTag: {
    fontSize: 11, color: '#389e0d', background: '#f6ffed', border: '1px solid #b7eb8f',
    borderRadius: 999, padding: '1px 8px'
  },
  timeRow: { display: 'flex', flexWrap: 'wrap' as const, gap: 8, marginTop: 8 },
  timeChip: {
    fontSize: 12, color: '#595959', background: '#f5f5f5', border: '1px solid #f0f0f0',
    borderRadius: 999, padding: '2px 10px'
  },
  timeChipTotal: { color: '#1677ff', background: '#e6f4ff', borderColor: '#91caff', fontWeight: 600 },
  itemError: { marginTop: 6, fontSize: 12, color: '#ff4d4f', whiteSpace: 'pre-wrap' as const },
  linkBtn: {
    border: 'none', background: 'transparent', color: '#1677ff', cursor: 'pointer',
    padding: 0, fontSize: 12
  }
}






