import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { mkdir, writeFile, unlink, access } from 'fs/promises'
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
}

interface NormSeg {
  start: number
  end: number
  text?: string
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

function buildSrt(segments: NormSeg[]): string {
  let cursor = 0
  const blocks: string[] = []
  for (const seg of segments) {
    const text = (seg.text || '').trim()
    if (!text) continue
    const duration = Math.max(0.05, seg.end - seg.start)
    const start = cursor
    const end = cursor + duration
    cursor = end
    blocks.push(`${blocks.length + 1}\n${toSrtTime(start)} --> ${toSrtTime(end)}\n${text}`)
  }
  return blocks.join('\n\n')
}

function normalizeSegments(segs: { start: number; end: number; text?: string }[], mediaDuration: number): NormSeg[] {
  const out: NormSeg[] = []
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

  if (out.length <= 1) return out

  // Merge near-adjacent clips aggressively to cut encode complexity
  const merged: NormSeg[] = [{ ...out[0] }]
  for (let i = 1; i < out.length; i++) {
    const prev = merged[merged.length - 1]
    const cur = out[i]
    const gap = cur.start - prev.end
    if (gap >= -0.02 && gap <= 0.18) {
      prev.end = Math.max(prev.end, cur.end)
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

let cachedHwEncoder: string | null | undefined

async function detectHwEncoder(ffmpegPath: string): Promise<string | null> {
  if (cachedHwEncoder !== undefined) return cachedHwEncoder
  const candidates = ['h264_nvenc', 'h264_qsv', 'h264_amf']
  for (const enc of candidates) {
    try {
      await runFfmpeg(ffmpegPath, ['-hide_banner', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1', '-c:v', enc, '-f', 'null', '-'], {
        timeoutMs: 12000,
        label: `probe ${enc}`
      })
      cachedHwEncoder = enc
      return enc
    } catch {
      // try next
    }
  }
  cachedHwEncoder = null
  return null
}

function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  options?: { timeoutMs?: number; label?: string; onProgressLine?: (line: string) => void }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 8 * 60 * 1000
  const label = options?.label || 'ffmpeg'

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })

    let stderr = ''
    let settled = false
    let lastLine = ''

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGKILL') } catch {}
      reject(new Error(`${label} 超时（>${Math.round(timeoutMs / 1000)}s）`))
    }, timeoutMs)

    child.stderr.on('data', (buf) => {
      const text = buf.toString()
      stderr += text
      if (stderr.length > 100_000) stderr = stderr.slice(-50_000)
      const lines = text.split(/\r|\n/).filter(Boolean)
      if (lines.length) {
        lastLine = lines[lines.length - 1]
        options?.onProgressLine?.(lastLine)
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
      const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-15).join('\n')
      reject(new Error(`${label} 失败(code=${code})\n${tail || lastLine || '无详细日志'}`))
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
      '-show_entries', 'format=duration:stream=codec_type',
      '-of', 'json',
      videoPath
    ], { timeout: 20000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
    const data = JSON.parse(stdout || '{}')
    const streams = Array.isArray(data.streams) ? data.streams : []
    return {
      hasVideo: streams.some((s: any) => s.codec_type === 'video'),
      hasAudio: streams.some((s: any) => s.codec_type === 'audio'),
      duration: parseFloat(data.format?.duration || '0') || 0
    }
  } catch {
    return { hasVideo: true, hasAudio: true, duration: 0 }
  }
}

/** Fit into 1080p box (1920x1080) without upscaling; works for landscape & portrait. */
function buildScale1080Filter(): string {
  // force_original_aspect_ratio=decrease keeps AR; force_divisible_by=2 keeps yuv420p friendly
  return 'scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2'
}

function buildVideoEncoderArgs(hw: string | null): string[] {
  if (hw === 'h264_nvenc') {
    // 1080p target bitrate-ish quality, prioritize speed
    return ['-c:v', 'h264_nvenc', '-preset', 'p1', '-rc', 'vbr', '-cq', '23', '-b:v', '0', '-maxrate', '8M', '-bufsize', '16M']
  }
  if (hw === 'h264_qsv') {
    return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '23']
  }
  if (hw === 'h264_amf') {
    return ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '23', '-qp_p', '23']
  }
  // software: prioritize speed for batch
  return ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-threads', '0']
}

async function exportByFilterGraph(
  ffmpegPath: string,
  videoPath: string,
  segs: NormSeg[],
  outputPath: string,
  withAudio: boolean,
  enableSubtitle: boolean,
  hw: string | null,
  onDetail?: (detail: string) => void
): Promise<void> {
  const filterParts: string[] = []
  for (let i = 0; i < segs.length; i++) {
    const start = segs[i].start.toFixed(3)
    const end = segs[i].end.toFixed(3)
    if (withAudio) {
      filterParts.push(
        `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}];` +
        `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}];`
      )
    } else {
      filterParts.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}];`)
    }
  }

  let videoMap = '[outv]'
  let srtPath: string | null = null

  if (withAudio) {
    const concatInputs = segs.map((_, i) => `[v${i}][a${i}]`).join('')
    filterParts.push(`${concatInputs}concat=n=${segs.length}:v=1:a=1[cv][outa]`)
  } else {
    const concatInputs = segs.map((_, i) => `[v${i}]`).join('')
    filterParts.push(`${concatInputs}concat=n=${segs.length}:v=1:a=0[cv]`)
  }

  // Always downscale to 1080p (no 4K output) after concat, once per variant
  filterParts.push(`[cv]${buildScale1080Filter()}[outv]`)

  if (enableSubtitle) {
    srtPath = join(tmpdir(), `cut-claude-sub-${randomUUID()}.srt`)
    await writeFile(srtPath, buildSrt(segs), 'utf8')
    const escaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:')
    filterParts.push(
      `[outv]subtitles='${escaped}':force_style='FontName=Microsoft YaHei,FontSize=18,Outline=1,Shadow=0,MarginV=40'[subv]`
    )
    videoMap = '[subv]'
  }

  // Encode to temp ASCII path first, then move (more stable on Chinese dest paths)
  const tempOut = join(tmpdir(), `cut-claude-out-${randomUUID()}.mp4`)
  const args = [
    '-y',
    '-hide_banner',
    '-i', videoPath,
    '-filter_complex', filterParts.join(''),
    '-map', videoMap
  ]
  if (withAudio) {
    args.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '44100')
  } else {
    args.push('-an')
  }
  args.push(
    ...buildVideoEncoderArgs(hw),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    tempOut
  )

  try {
    onDetail?.(`单次编码 ${segs.length} 段`)
    await runFfmpeg(ffmpegPath, args, {
      timeoutMs: 8 * 60 * 1000,
      label: '单次滤镜导出',
      onProgressLine: (line) => {
        const m = line.match(/time=\s*(\d+:\d+:\d+\.\d+)/)
        if (m) onDetail?.(`编码中 ${m[1]}`)
      }
    })
    await mkdir(dirname(outputPath), { recursive: true })
    // use copyFile via fs
    const { copyFile, unlink: unl } = await import('fs/promises')
    await copyFile(tempOut, outputPath)
    try { await unl(tempOut) } catch {}
  } catch (err) {
    try { await unlink(tempOut) } catch {}
    throw err
  } finally {
    if (srtPath) {
      try { await unlink(srtPath) } catch {}
    }
  }
}

async function exportSingleVariantFast(
  ffmpegPath: string,
  videoPath: string,
  variant: VariantPlan,
  outputPath: string,
  enableSubtitle: boolean,
  media: MediaProbe,
  hw: string | null,
  onDetail?: (detail: string) => void
): Promise<void> {
  let segs = normalizeSegments(variant.segments || [], media.duration)
  if (segs.length === 0) throw new Error('变体没有可用片段')

  // Cap extreme fragmentation (keeps speed sane)
  if (segs.length > 40) {
    // keep longest pieces first then restore timeline order by start
    const top = [...segs]
      .sort((a, b) => (b.end - b.start) - (a.end - a.start))
      .slice(0, 40)
      .sort((a, b) => a.start - b.start)
    segs = normalizeSegments(top, media.duration)
    onDetail?.(`片段过多，已压缩为 ${segs.length} 段`)
  }

  // Preferred: one encode per variant (much faster than N re-encodes)
  try {
    await exportByFilterGraph(
      ffmpegPath,
      videoPath,
      segs,
      outputPath,
      media.hasAudio,
      enableSubtitle,
      hw,
      onDetail
    )
    return
  } catch (err: any) {
    const msg = String(err?.message || err || '')
    console.error('[export] filter graph failed, fallback no-subtitle/no-audio:', msg.slice(0, 300))

    // Retry without subtitle
    if (enableSubtitle) {
      try {
        await exportByFilterGraph(ffmpegPath, videoPath, segs, outputPath, media.hasAudio, false, hw, onDetail)
        return
      } catch {}
    }

    // Retry video-only
    if (media.hasAudio) {
      try {
        await exportByFilterGraph(ffmpegPath, videoPath, segs, outputPath, false, false, hw, onDetail)
        return
      } catch (err2: any) {
        throw new Error(err2?.message || msg)
      }
    }

    throw err
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

  onProgress?.(0, variants.length, '准备编码器')
  const media = await probeMedia(videoPath)
  if (!media.hasVideo) throw new Error('源视频没有可用视频流，无法导出')

  const hw = await detectHwEncoder(ffmpegPath)
  onProgress?.(0, variants.length, hw ? `硬件加速: ${hw}` : '软件编码: ultrafast')

  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i]
    const label = variant.name || `变体${i + 1}`
    onProgress?.(i + 1, variants.length, `开始 ${label}`)

    try {
      let safeName = sanitizeFileName(variant.name) || `variant_${i + 1}`
      if (usedNames.has(safeName.toLowerCase())) safeName = `${safeName}_${i + 1}`
      usedNames.add(safeName.toLowerCase())
      const outputPath = join(outputDir, `${safeName}.mp4`)

      const t0 = Date.now()
      await exportSingleVariantFast(
        ffmpegPath,
        videoPath,
        variant,
        outputPath,
        enableSubtitle,
        media,
        hw,
        (detail) => onProgress?.(i + 1, variants.length, `${label} · ${detail}`)
      )

      if (!(await pathExists(outputPath))) {
        throw new Error('导出完成但未找到输出文件')
      }

      files.push(outputPath)
      const sec = ((Date.now() - t0) / 1000).toFixed(1)
      onProgress?.(i + 1, variants.length, `完成 ${safeName}.mp4（${sec}s）`)
    } catch (e: any) {
      const msg = e?.message || String(e)
      console.error('[export] variant failed:', variant?.name, msg)
      errors.push(`${variant?.name || `变体${i + 1}`}: ${msg}`)
    }
  }

  return { files, errors }
}


