import { spawn } from 'child_process'
import { join, dirname } from 'path'
import { mkdir, writeFile, unlink, access, copyFile } from 'fs/promises'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { getFfmpegPath, getFfprobePath } from '../utils/ffmpeg-path'
import type { VariantPlan } from './variant-generator'

export type ExportResolution = '720' | '1080' | '1440' | 'source'

export interface ExportOptions {
  videoPath: string
  variants: VariantPlan[]
  outputDir: string
  enableSubtitle: boolean
  exportResolution?: ExportResolution
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

function parseFfmpegClock(clock: string): number {
  const parts = clock.trim().split(':').map(Number)
  if (parts.some((n) => !Number.isFinite(n))) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] || 0
}

function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--'
  const s = Math.max(0, Math.ceil(seconds))
  if (s < 60) return `${s}秒`
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m < 60) return `${m}分${r}秒`
  const h = Math.floor(m / 60)
  return `${h}小时${m % 60}分`
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

  const merged: NormSeg[] = [{ ...out[0] }]
  for (let i = 1; i < out.length; i++) {
    const prev = merged[merged.length - 1]
    const cur = out[i]
    const gap = cur.start - prev.end
    if (gap >= -0.02 && gap <= 0.25) {
      prev.end = Math.max(prev.end, cur.end)
      prev.text = `${prev.text || ''}${cur.text || ''}`
    } else {
      merged.push({ ...cur })
    }
  }
  return merged
}

function totalSegDuration(segs: NormSeg[]): number {
  return segs.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0)
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
  for (const enc of ['h264_nvenc', 'h264_qsv', 'h264_amf']) {
    try {
      await runFfmpeg(
        ffmpegPath,
        ['-hide_banner', '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.1', '-c:v', enc, '-f', 'null', '-'],
        { timeoutMs: 10000, stallMs: 8000, label: `probe ${enc}` }
      )
      cachedHwEncoder = enc
      return enc
    } catch {}
  }
  cachedHwEncoder = null
  return null
}

function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  options?: {
    timeoutMs?: number
    stallMs?: number
    label?: string
    expectedDurationSec?: number
    onProgress?: (info: { encodedSec: number; speed: number; etaSec: number | null; line: string }) => void
  }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 6 * 60 * 1000
  const stallMs = options?.stallMs ?? 40_000
  const label = options?.label || 'ffmpeg'
  const expected = Math.max(0.1, options?.expectedDurationSec || 0)

  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    })

    let stderr = ''
    let settled = false
    let lastLine = ''
    let lastEncodedSec = 0
    let lastProgressAt = Date.now()
    let lastSpeed = 0

    const hardTimer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGKILL') } catch {}
      reject(new Error(`${label} 超时（>${Math.round(timeoutMs / 1000)}s）。已强制结束导出进程。`))
    }, timeoutMs)

    const stallTimer = setInterval(() => {
      if (settled) return
      const idle = Date.now() - lastProgressAt
      if (idle > stallMs) {
        settled = true
        clearTimeout(hardTimer)
        clearInterval(stallTimer)
        try { child.kill('SIGKILL') } catch {}
        reject(new Error(`${label} 卡死（${Math.round(idle / 1000)}秒无进度，已编码 ${lastEncodedSec.toFixed(1)}s）。已强制结束。`))
      }
    }, 2000)

    child.stderr.on('data', (buf) => {
      const text = buf.toString()
      stderr += text
      if (stderr.length > 120_000) stderr = stderr.slice(-60_000)

      const chunks = text.split(/\r|\n/).filter(Boolean)
      for (const line of chunks) {
        lastLine = line
        const tm = line.match(/time=\s*([0-9:.]+)/)
        const sm = line.match(/speed=\s*([0-9.]+)x/)
        if (!tm && !sm) continue

        if (tm) {
          const encodedSec = parseFfmpegClock(tm[1])
          if (encodedSec > lastEncodedSec + 0.05 || lastEncodedSec === 0) {
            lastEncodedSec = encodedSec
            lastProgressAt = Date.now()
          }
        }
        if (sm) {
          const speed = Number(sm[1])
          if (Number.isFinite(speed) && speed > 0) {
            lastSpeed = speed
            lastProgressAt = Date.now()
          }
        }

        let etaSec: number | null = null
        if (expected > 0) {
          const remain = Math.max(0, expected - lastEncodedSec)
          if (lastSpeed > 0.01) etaSec = remain / lastSpeed
          else if (lastEncodedSec > 0.5) etaSec = remain / 0.5
        }

        options?.onProgress?.({
          encodedSec: lastEncodedSec,
          speed: lastSpeed,
          etaSec,
          line
        })
      }
    })

    child.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(hardTimer)
      clearInterval(stallTimer)
      reject(new Error(`${label} 启动失败: ${err.message}`))
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(hardTimer)
      clearInterval(stallTimer)
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

function buildScaleFilter(resolution: ExportResolution): string | null {
  // Keep aspect ratio; only fit into target box. Never stretch.
  if (resolution === 'source') return null
  if (resolution === '720') return 'scale=1280:720:force_original_aspect_ratio=decrease:force_divisible_by=2'
  if (resolution === '1440') return 'scale=2560:1440:force_original_aspect_ratio=decrease:force_divisible_by=2'
  return 'scale=1920:1080:force_original_aspect_ratio=decrease:force_divisible_by=2'
}

function resolutionLabel(resolution: ExportResolution): string {
  if (resolution === 'source') return '原画'
  if (resolution === '720') return '720P'
  if (resolution === '1440') return '2K/1440P'
  return '1080P'
}

function buildVideoEncoderArgs(hw: string | null): string[] {
  if (hw === 'h264_nvenc') {
    return ['-c:v', 'h264_nvenc', '-preset', 'p1', '-rc', 'vbr', '-cq', '24', '-b:v', '0', '-maxrate', '6M', '-bufsize', '12M']
  }
  if (hw === 'h264_qsv') {
    return ['-c:v', 'h264_qsv', '-preset', 'veryfast', '-global_quality', '24']
  }
  if (hw === 'h264_amf') {
    return ['-c:v', 'h264_amf', '-quality', 'speed', '-rc', 'cqp', '-qp_i', '24', '-qp_p', '24']
  }
  return ['-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '24', '-threads', '0']
}

async function exportByFilterGraph(
  ffmpegPath: string,
  videoPath: string,
  segs: NormSeg[],
  outputPath: string,
  withAudio: boolean,
  enableSubtitle: boolean,
  hw: string | null,
  resolution: ExportResolution,
  onDetail?: (detail: string) => void
): Promise<void> {
  const expectedSec = Math.max(0.5, totalSegDuration(segs))
  const scale = buildScaleFilter(resolution)
  const vfx = scale ? `,${scale}` : ''
  const chain: string[] = []

  // Optionally scale each clip immediately (keep AR, never stretch)
  for (let i = 0; i < segs.length; i++) {
    const start = segs[i].start.toFixed(3)
    const end = segs[i].end.toFixed(3)
    if (withAudio) {
      chain.push(
        `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS${vfx}[v${i}]`
      )
      chain.push(
        `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}]`
      )
    } else {
      chain.push(
        `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS${vfx}[v${i}]`
      )
    }
  }

  let videoMap = '[outv]'
  if (withAudio) {
    const concatInputs = segs.map((_, i) => `[v${i}][a${i}]`).join('')
    chain.push(`${concatInputs}concat=n=${segs.length}:v=1:a=1[outv][outa]`)
  } else {
    const concatInputs = segs.map((_, i) => `[v${i}]`).join('')
    chain.push(`${concatInputs}concat=n=${segs.length}:v=1:a=0[outv]`)
  }

  let srtPath: string | null = null
  if (enableSubtitle) {
    srtPath = join(tmpdir(), `cut-claude-sub-${randomUUID()}.srt`)
    await writeFile(srtPath, buildSrt(segs), 'utf8')
    const escaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:')
    chain.push(
      `[outv]subtitles='${escaped}':force_style='FontName=Microsoft YaHei,FontSize=18,Outline=1,Shadow=0,MarginV=40'[subv]`
    )
    videoMap = '[subv]'
  }

  const filterComplex = chain.join(';')
  const tempOut = join(tmpdir(), `cut-claude-out-${randomUUID()}.mp4`)
  const args = [
    '-y',
    '-hide_banner',
    '-hwaccel', 'auto',
    '-i', videoPath,
    '-filter_complex', filterComplex,
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
    onDetail?.(`${resolutionLabel(resolution)}编码 ${segs.length}段 · 片长约${expectedSec.toFixed(0)}s · 预计计算中`)
    await runFfmpeg(ffmpegPath, args, {
      // adaptive timeout: short clips finish fast; long clips get more room
      timeoutMs: Math.max(2 * 60 * 1000, Math.min(8 * 60 * 1000, expectedSec * 25 * 1000)),
      stallMs: 35_000,
      label: `${resolutionLabel(resolution)}导出`,
      expectedDurationSec: expectedSec,
      onProgress: ({ encodedSec, speed, etaSec }) => {
        const pct = Math.min(99, Math.floor((encodedSec / expectedSec) * 100))
        const etaText = etaSec == null ? '预计计算中' : `预计剩余 ${formatEta(etaSec)}`
        const speedText = speed > 0 ? ` · ${speed.toFixed(2)}x` : ''
        onDetail?.(`编码 ${pct}% ${encodedSec.toFixed(1)}/${expectedSec.toFixed(1)}s${speedText} · ${etaText}`)
      }
    })
    await mkdir(dirname(outputPath), { recursive: true })
    await copyFile(tempOut, outputPath)
    try { await unlink(tempOut) } catch {}
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
  resolution: ExportResolution,
  onDetail?: (detail: string) => void
): Promise<void> {
  let segs = normalizeSegments(variant.segments || [], media.duration)
  if (segs.length === 0) throw new Error('变体没有可用片段')

  if (segs.length > 30) {
    const top = [...segs]
      .sort((a, b) => (b.end - b.start) - (a.end - a.start))
      .slice(0, 30)
      .sort((a, b) => a.start - b.start)
    segs = normalizeSegments(top, media.duration)
    onDetail?.(`片段过多，已压缩为 ${segs.length} 段`)
  }

  try {
    await exportByFilterGraph(
      ffmpegPath, videoPath, segs, outputPath, media.hasAudio, enableSubtitle, hw, resolution, onDetail
    )
  } catch (err: any) {
    const msg = String(err?.message || err || '')
    console.error('[export] primary failed:', msg.slice(0, 400))

    if (enableSubtitle) {
      try {
        onDetail?.('字幕失败，改为无字幕重试')
        await exportByFilterGraph(
          ffmpegPath, videoPath, segs, outputPath, media.hasAudio, false, hw, resolution, onDetail
        )
        return
      } catch {}
    }

    if (media.hasAudio) {
      onDetail?.('音轨异常，改为无音轨重试')
      await exportByFilterGraph(
        ffmpegPath, videoPath, segs, outputPath, false, false, hw, resolution, onDetail
      )
      return
    }

    throw err
  }
}

export async function exportVariants(options: ExportOptions): Promise<ExportResult> {
  const { videoPath, variants, outputDir, enableSubtitle, onProgress } = options
  const resolution: ExportResolution =
    options.exportResolution === '720' ||
    options.exportResolution === '1080' ||
    options.exportResolution === '1440' ||
    options.exportResolution === 'source'
      ? options.exportResolution
      : '1080'
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
  onProgress?.(0, variants.length, hw ? `${resolutionLabel(resolution)} · 硬件加速 ${hw}` : `${resolutionLabel(resolution)} · 软件编码 ultrafast`)

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
        resolution,
        (detail) => onProgress?.(i + 1, variants.length, `${label} · ${detail}`)
      )

      if (!(await pathExists(outputPath))) {
        throw new Error('导出完成但未找到输出文件')
      }

      files.push(outputPath)
      const sec = ((Date.now() - t0) / 1000).toFixed(1)
      onProgress?.(i + 1, variants.length, `完成 ${safeName}.mp4（耗时 ${sec}s）`)
    } catch (e: any) {
      const msg = e?.message || String(e)
      console.error('[export] variant failed:', variant?.name, msg)
      errors.push(`${variant?.name || `变体${i + 1}`}: ${msg}`)
    }
  }

  return { files, errors }
}
