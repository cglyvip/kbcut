import { execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { mkdir, writeFile, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { getFfmpegPath } from '../utils/ffmpeg-path'
import type { VariantPlan } from './variant-generator'

const execFileAsync = promisify(execFile)

export interface ExportOptions {
  videoPath: string
  variants: VariantPlan[]
  outputDir: string
  enableSubtitle: boolean
  onProgress?: (variantIndex: number, total: number) => void
}

export interface ExportResult {
  files: string[]
  errors: string[]
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

function buildSrt(segments: { start: number; end: number; text: string }[]): string {
  let cursor = 0
  const blocks: string[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]
    const text = (seg.text || '').trim()
    if (!text) continue
    const duration = Math.max(0.05, (seg.end || 0) - (seg.start || 0))
    const start = cursor
    const end = cursor + duration
    cursor = end
    blocks.push(`${blocks.length + 1}\n${toSrtTime(start)} --> ${toSrtTime(end)}\n${text}`)
  }

  return blocks.join('\n\n')
}

export async function exportVariants(options: ExportOptions): Promise<ExportResult> {
  const { videoPath, variants, outputDir, enableSubtitle, onProgress } = options
  const ffmpegPath = getFfmpegPath()
  const files: string[] = []
  const errors: string[] = []
  const usedNames = new Set<string>()

  await mkdir(outputDir, { recursive: true })

  for (let i = 0; i < variants.length; i++) {
    const variant = variants[i]
    onProgress?.(i + 1, variants.length)

    try {
      let safeName = sanitizeFileName(variant.name) || `variant_${i + 1}`
      // Prevent overwrite when names collide after sanitizing
      if (usedNames.has(safeName.toLowerCase())) {
        safeName = `${safeName}_${i + 1}`
      }
      usedNames.add(safeName.toLowerCase())

      const outputPath = join(outputDir, `${safeName}.mp4`)
      await exportSingleVariant(ffmpegPath, videoPath, variant, outputPath, enableSubtitle)
      files.push(outputPath)
    } catch (e: any) {
      errors.push(`${variant.name}: ${e.message}`)
    }
  }

  return { files, errors }
}

async function exportSingleVariant(
  ffmpegPath: string,
  videoPath: string,
  variant: VariantPlan,
  outputPath: string,
  enableSubtitle: boolean
): Promise<void> {
  const segs = variant.segments
  if (segs.length === 0) throw new Error('变体没有可用片段')

  try {
    await runExport(ffmpegPath, videoPath, segs, outputPath, enableSubtitle, true)
  } catch (err: any) {
    const msg = String(err?.message || err || '')
    // Some source videos have no usable audio stream; retry video-only.
    if (/Stream map|matches no streams|does not contain any stream|Audio/i.test(msg) || msg.includes('0:a')) {
      console.error('[export] audio map failed, retry video-only:', msg.slice(0, 300))
      await runExport(ffmpegPath, videoPath, segs, outputPath, enableSubtitle, false)
      return
    }
    if (enableSubtitle) {
      console.error('[export] subtitle failed, retry without subtitle:', err)
      await exportSingleVariant(ffmpegPath, videoPath, variant, outputPath, false)
      return
    }
    throw err
  }
}

async function runExport(
  ffmpegPath: string,
  videoPath: string,
  segs: { start: number; end: number; text?: string }[],
  outputPath: string,
  enableSubtitle: boolean,
  withAudio: boolean
): Promise<void> {
  const filterParts: string[] = []
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i]
    const start = Math.max(0, Number(seg.start) || 0)
    const end = Math.max(start + 0.05, Number(seg.end) || start + 0.05)
    if (withAudio) {
      filterParts.push(
        `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}];` +
        `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${i}];`
      )
    } else {
      filterParts.push(
        `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${i}];`
      )
    }
  }

  let videoMap = '[outv]'
  let srtPath: string | null = null

  if (withAudio) {
    const concatInputs = segs.map((_, i) => `[v${i}][a${i}]`).join('')
    filterParts.push(`${concatInputs}concat=n=${segs.length}:v=1:a=1[outv][outa]`)
  } else {
    const concatInputs = segs.map((_, i) => `[v${i}]`).join('')
    filterParts.push(`${concatInputs}concat=n=${segs.length}:v=1:a=0[outv]`)
  }

  if (enableSubtitle) {
    srtPath = join(tmpdir(), `cut-claude-sub-${randomUUID()}.srt`)
    await writeFile(srtPath, buildSrt(segs as any), 'utf8')
    const escaped = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:')
    filterParts.push(`[outv]subtitles='${escaped}:force_style=FontName=Microsoft YaHei,FontSize=18,Outline=1,Shadow=0,MarginV=40'[subv]`)
    videoMap = '[subv]'
  }

  const args = [
    '-i', videoPath,
    '-filter_complex', filterParts.join(''),
    '-map', videoMap
  ]
  if (withAudio) {
    args.push('-map', '[outa]', '-c:a', 'aac', '-b:a', '128k')
  } else {
    args.push('-an')
  }
  args.push(
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-movflags', '+faststart',
    '-y',
    outputPath
  )

  try {
    await execFileAsync(ffmpegPath, args, { timeout: 600000 })
  } finally {
    if (srtPath) {
      try { await unlink(srtPath) } catch {}
    }
  }
}
