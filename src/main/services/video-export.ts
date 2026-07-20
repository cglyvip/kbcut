import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { mkdir, writeFile, unlink, rm, copyFile, access } from 'fs/promises'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { getFfmpegPath, getFfprobePath } from '../utils/ffmpeg-path'
import type { VariantPlan } from './variant-generator'

export interface ExportOptions {
  videoPath: string
  variants: VariantPlan[]
  outputDir: string
  enableSubtitle: boolean
  onProgress?: (variantIndex: number, total: number, detail?: string) => void
}

export interface ExportResult {
  files: string[]
  errors: string[]
}

interface MediaProbe {
  hasVideo: boolean
  hasAudio: boolean
  duration: number
  width: number
  height: number
}

function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_').slice(0, 50)
}

function toSrtTime(seconds: number): string {
  const clamped = Math.max(0, seconds)
  const h = Math.floor(clamped / 3600)
  const m = Math.floor((clamped % 3600) / 60)
  const s = Math.floor(clamped % 60)
  const ms = Math.round((clamped - Math.floor(clamped)) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

function buildSrt(segments: { start: number; end: number; text?: string }[]): string {
  let cursor = 0
  const blocks: string[] = []
  for (const seg of segments) {
    const text = (seg.text || '').trim()
    if (!text) continue
    const duration = Math.max(0.05, (Number(seg.end) || 0) - (Number(seg.start) || 0))
    const start = cursor
    const end = cursor + duration
    cursor = end
    blocks.push(`${blocks.length + 1}\n${toSrtTime(start)} --> ${toSrtTime(end)}\n${text}`)
  }
  return blocks.join('\n\n')
}

function normalizeSegments(
  segs: { start: number; end: number; text?: string }[],
  mediaDuration: number
): { start: number; end: number; text?: string }[] {
  const out: { start: number; end: number; text?: string }[] = []
  for (const seg of segs || []) {
    let start = Number(seg.start)
    let end = Number(seg.end)
    if (!Number.isFinite(start)) start = 0
    if (!Number.isFinite(end)) end = start + 0.2
    start = Math.max(0, start)
    end = Math.max(start + 0.05, end)
    if (mediaDuration > 0) {
      start = Math.min(start, Math.max(0, mediaDuration - 0.05))
      end = Math.min(end, mediaDuration)
      if (end - start < 0.05) continue
    }
    out.push({ start, end, text: seg.text })
  }

  // Merge tiny adjacent fragments to keep ffmpeg graph light
  if (out.length <= 1) return out
  const merged: typeof out = [out[0]]
  for (let i = 1; i < out.length; i++) {
    const prev = merged[merged.length - 1]
    const cur = out[i]
    const gap = cur.start - prev.end
    if (gap >= 0 && gap <= 0.04) {
      prev.end = cur.end
      prev.text = `${prev.text || ''}${cur.text || ''}`
    } else {
      merged.push({ ...cur })
    }
  }
  return merged
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p)
    return true
  } catch {
    return false
  }
}

function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  options?: { timeoutMs?: number; label?: string }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 10 * 60 * 1000
  const label = options?.label || 'ffmpeg'

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })

    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGKILL') } catch {}
      reject(new Error(`${label} 超时（>${Math.round(timeoutMs / 1000)}s）。可能是视频过长、片段过多或编码器卡住。`))
    }, timeoutMs)

    child.stderr.on('data', (buf) => {
      stderr += buf.toString()
      if (stderr.length > 80_000) {
        stderr = stderr.slice(-40_000)
      }
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`${label} 启动失败: ${err.message}`))
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve()
        return
      }
      const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-12).join('\n')
      reject(new Error(`${label} 失败(code=${code})\n${tail || '无详细日志'}`))
    })
  })
}

async function probeMedia(videoPath: string): Promise<MediaProbe> {
  try {
    const ffprobe = getFfprobePath()
    const { execFile } = await import('child_process')
    const { promisify } = await import('util')
    const execFileAsync = promisify(execFile)
    const { stdout } = await execFileAsync(ffprobe, [
      '-v', 'error',
      '-show_entries', 'format=duration:stream=codec_type,width,height',
      '-of', 'json',
      videoPath
    ], { timeout: 30000, windowsHide: true, maxBuffer: 5 * 1024 * 1024 })

    const data = JSON.parse(stdout || '{}')
    const streams = Array.isArray(data.streams) ? data.streams : []
    const video = streams.find((s: any) => s.codec_type === 'video')
    const audio = streams.find((s: any) => s.codec_type === 'audio')
    return {
      hasVideo: !!video,
      hasAudio: !!audio,
      duration: parseFloat(data.format?.duration || '0') || 0,
      width: Number(video?.width) || 0,
      height: Number(video?.height) || 0
    }
  } catch (err: any) {
    console.error('[export] probe failed:', err?.message || err)
    // Don't hard-fail export on probe errors; assume typical phone video
    return { hasVideo: true, hasAudio: true, duration: 0, width: 0, height: 0 }
  }
}

async function cutSegment(
  ffmpegPath: string,
  videoPath: string,
  start: number,
  end: number,
  outputPath: string,
  withAudio: boolean
): Promise<void> {
  const duration = Math.max(0.05, end - start)
  // Put -ss after -i for better accuracy with ASR timestamps
  const args = [
    '-y',
    '-i', videoPath,
    '-ss', start.toFixed(3),
    '-t', duration.toFixed(3),
    '-map', '0:v:0',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart'
  ]

  if (withAudio) {
    args.push('-map', '0:a:0?', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100')
  } else {
    args.push('-an')
  }

  args.push(outputPath)

  try {
    await runFfmpeg(ffmpegPath, args, {
      timeoutMs: 8 * 60 * 1000,
      label: `裁剪片段 ${start.toFixed(2)}-${end.toFixed(2)}`
    })
  } catch (err: any) {
    // Retry video-only if audio mapping fails
    if (withAudio) {
      const msg = String(err?.message || err || '')
      if (/audio|0:a|Stream map|matches no streams/i.test(msg)) {
        await cutSegment(ffmpegPath, videoPath, start, end, outputPath, false)
        return
      }
    }
    throw err
  }
}

async function concatSegments(
  ffmpegPath: string,
  segmentFiles: string[],
  outputPath: string,
  withAudio: boolean
): Promise<void> {
  if (segmentFiles.length === 0) throw new Error('没有可拼接的片段')
  if (segmentFiles.length === 1) {
    await copyFile(segmentFiles[0], outputPath)
    return
  }

  const listPath = join(tmpdir(), `cut-claude-concat-${randomUUID()}.txt`)
  // ffmpeg concat demuxer needs escaped single quotes in paths
  const listBody = segmentFiles
    .map((f) => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n')
  await writeFile(listPath, listBody, 'utf8')

  try {
    // Re-encode on concat for higher compatibility across phone MOV segments
    const args = [
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', listPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart'
    ]
    if (withAudio) {
      args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100')
    } else {
      args.push('-an')
    }
    args.push(outputPath)

    await runFfmpeg(ffmpegPath, args, {
      timeoutMs: 10 * 60 * 1000,
      label: `拼接 ${segmentFiles.length} 个片段`
    })
  } finally {
    try { await unlink(listPath) } catch {}
  }
}

async function burnSubtitles(
  ffmpegPath: string,
  inputPath: string,
  segs: { start: number; end: number; text?: string }[],
  outputPath: string
): Promise<void> {
  const srtPath = join(tmpdir(), `cut-claude-sub-${randomUUID()}.srt`)
  await writeFile(srtPath, buildSrt(segs), 'utf8')
  const escaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'")

  try {
    const args = [
      '-y',
      '-i', inputPath,
      '-vf', `subtitles='${escaped}':force_style='FontName=Microsoft YaHei,FontSize=18,Outline=1,Shadow=0,MarginV=40'`,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '20',
      '-c:a', 'copy',
      '-movflags', '+faststart',
      outputPath
    ]
    await runFfmpeg(ffmpegPath, args, {
      timeoutMs: 10 * 60 * 1000,
      label: '烧录字幕'
    })
  } finally {
    try { await unlink(srtPath) } catch {}
  }
}

async function exportSingleVariant(
  ffmpegPath: string,
  videoPath: string,
  variant: VariantPlan,
  outputPath: string,
  enableSubtitle: boolean,
  media: MediaProbe,
  onDetail?: (detail: string) => void
): Promise<void> {
  const segs = normalizeSegments(variant.segments || [], media.duration)
  if (segs.length === 0) throw new Error('变体没有可用片段')

  // Safety: too many tiny cuts can explode runtime; keep top continuous cuts
  const maxSegs = 80
  const useSegs = segs.length > maxSegs ? segs.slice(0, maxSegs) : segs
  if (segs.length > maxSegs) {
    console.warn(`[export] variant "${variant.name}" has ${segs.length} segments, truncated to ${maxSegs}`)
  }

  const workDir = join(tmpdir(), `cut-claude-export-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })

  // Prefer ASCII temp output first, then copy to final path (avoids Chinese-path ffmpeg issues)
  const tempOut = join(workDir, 'final.mp4')
  const tempNoSub = join(workDir, 'nosub.mp4')
  const segmentFiles: string[] = []
  let withAudio = media.hasAudio

  try {
    for (let i = 0; i < useSegs.length; i++) {
      const seg = useSegs[i]
      onDetail?.(`裁剪 ${i + 1}/${useSegs.length}`)
      const segFile = join(workDir, `seg_${String(i).padStart(3, '0')}.mp4`)
      await cutSegment(ffmpegPath, videoPath, seg.start, seg.end, segFile, withAudio)
      // If first segment has no audio stream effectively, subsequent can still try; probe by retry
      segmentFiles.push(segFile)
    }

    onDetail?.(`拼接 ${segmentFiles.length} 段`)
    try {
      await concatSegments(ffmpegPath, segmentFiles, enableSubtitle ? tempNoSub : tempOut, withAudio)
    } catch (err: any) {
      // Fallback: force video-only concat
      const msg = String(err?.message || err || '')
      if (withAudio && /audio|0:a|Stream map|matches no streams/i.test(msg)) {
        withAudio = false
        // re-cut without audio only if needed is expensive; try concat an first
        await concatSegments(ffmpegPath, segmentFiles, enableSubtitle ? tempNoSub : tempOut, false)
      } else {
        throw err
      }
    }

    if (enableSubtitle) {
      onDetail?.('烧录字幕')
      try {
        await burnSubtitles(ffmpegPath, tempNoSub, useSegs, tempOut)
      } catch (err) {
        console.error('[export] subtitle burn failed, keep no-subtitle output:', err)
        await copyFile(tempNoSub, tempOut)
      }
    }

    // Ensure parent exists and copy to destination (temp ASCII path avoids Chinese path ffmpeg issues)
    await mkdir(dirname(outputPath), { recursive: true })
    await copyFile(tempOut, outputPath)

    if (!(await pathExists(outputPath))) {
      throw new Error('导出完成但未找到输出文件')
    }
  } finally {
    try {
      await rm(workDir, { recursive: true, force: true })
    } catch {}
  }
}

export async function exportVariants(options: ExportOptions): Promise<ExportResult> {
  const { videoPath, variants, outputDir, enableSubtitle, onProgress } = options
  const ffmpegPath = getFfmpegPath()
  const files: string[] = []
  const errors: string[] = []
  const usedNames = new Set<string>()

  if (!videoPath) throw new Error('视频路径为空')
  if (!(await pathExists(videoPath))) throw new Error(`源视频不存在: ${videoPath}`)

  await mkdir(outputDir, { recursive: true })

  onProgress?.(0, variants.length, '探测视频信息')
  const media = await probeMedia(videoPath)
  if (!media.hasVideo) {
    throw new Error('源视频没有可用视频流，无法导出')
  }

  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i]
    onProgress?.(i + 1, variants.length, `开始导出：${variant.name || `变体${i + 1}`}`)

    try {
      let safeName = sanitizeFileName(variant.name) || `variant_${i + 1}`
      if (usedNames.has(safeName.toLowerCase())) {
        safeName = `${safeName}_${i + 1}`
      }
      usedNames.add(safeName.toLowerCase())

      const outputPath = join(outputDir, `${safeName}.mp4`)
      await exportSingleVariant(
        ffmpegPath,
        videoPath,
        variant,
        outputPath,
        enableSubtitle,
        media,
        (detail) => onProgress?.(i + 1, variants.length, `${variant.name || `变体${i + 1}`} · ${detail}`)
      )
      files.push(outputPath)
      onProgress?.(i + 1, variants.length, `完成：${safeName}.mp4`)
    } catch (e: any) {
      const msg = e?.message || String(e)
      console.error('[export] variant failed:', variant?.name, msg)
      errors.push(`${variant?.name || `变体${i + 1}`}: ${msg}`)
    }
  }

  return { files, errors }
}

