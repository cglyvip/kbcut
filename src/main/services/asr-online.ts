import { readFile, stat } from 'fs/promises'
import { basename, extname } from 'path'
import { normalizeOpenAiCompatibleUrl } from '../utils/openai-api-url'

export interface AsrWord {
  start: number
  end: number
  text: string
}

export interface AsrSegment {
  start: number
  end: number
  text: string
  words: AsrWord[]
}

export interface AsrResult {
  segments: AsrSegment[]
  fullText: string
  language: string
}

interface WhisperConfig {
  apiKey: string
  baseUrl: string
  model?: string
}

const MAX_COMPATIBLE_UPLOAD_BYTES = 24 * 1024 * 1024

export function normalizeAsrApiUrl(baseUrl: string): string {
  return normalizeOpenAiCompatibleUrl(baseUrl, 'audio/transcriptions', 'Whisper API')
}

function mimeTypeFor(path: string): string {
  const ext = extname(path).toLowerCase()
  if (ext === '.wav') return 'audio/wav'
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.m4a') return 'audio/mp4'
  return 'application/octet-stream'
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(120_000, Math.max(1_000, seconds * 1000))
  const at = Date.parse(value)
  if (!Number.isFinite(at)) return null
  return Math.min(120_000, Math.max(1_000, at - Date.now()))
}

function finiteTime(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : fallback
}

export async function onlineAsr(audioPath: string, config: WhisperConfig): Promise<AsrResult> {
  const apiKey = String(config?.apiKey || '').trim()
  const baseUrl = String(config?.baseUrl || '').trim()
  const model = String(config?.model || 'whisper-1').trim() || 'whisper-1'
  if (!apiKey) throw new Error('Whisper API Key 不能为空')

  const url = normalizeAsrApiUrl(baseUrl)
  const fileInfo = await stat(audioPath)
  if (fileInfo.size <= 0) throw new Error('待识别音频为空')
  if (fileInfo.size > MAX_COMPATIBLE_UPLOAD_BYTES) {
    throw new Error(`在线识别音频约 ${(fileInfo.size / 1024 / 1024).toFixed(1)}MB，超过兼容上传上限 24MB。请缩短视频或切换本地识别。`)
  }

  const fileName = basename(audioPath)
  const fileBuffer = await readFile(audioPath)
  const mimeType = mimeTypeFor(audioPath)

  let data: any = null
  let lastError = ''
  let includeWordTimestamps = true
  for (let attempt = 0; attempt < 3; attempt++) {
    const blob = new Blob([fileBuffer], { type: mimeType })
    const form = new FormData()
    form.append('file', blob, fileName)
    form.append('model', model)
    form.append('response_format', 'verbose_json')
    if (includeWordTimestamps) {
      form.append('timestamp_granularities[]', 'segment')
      form.append('timestamp_granularities[]', 'word')
    }
    form.append('language', 'zh')

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10 * 60 * 1000)
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal
      })

      if (response.ok) {
        data = await response.json()
        break
      }

      const errorText = await response.text()
      if (response.status === 413) {
        throw new Error('Whisper API 拒绝上传：音频文件过大（HTTP 413）。请缩短视频或切换本地识别。')
      }
      if (
        includeWordTimestamps &&
        (response.status === 400 || response.status === 422) &&
        /timestamp[_-]?granular|unknown\s+(field|parameter)|unsupported\s+(field|parameter)/i.test(errorText)
      ) {
        includeWordTimestamps = false
        lastError = '当前服务不支持词级时间戳，已切换兼容模式重试'
        continue
      }
      lastError = `Whisper API 请求失败 (${response.status}): ${errorText.slice(0, 500)}`
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      if (!retryable || attempt >= 2) throw new Error(lastError)
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'))
      const delay = retryAfter ?? (response.status === 429 ? 30_000 + attempt * 15_000 : 8_000 + attempt * 4_000)
      await new Promise((resolve) => setTimeout(resolve, delay))
    } catch (err: any) {
      lastError = err?.name === 'AbortError'
        ? 'Whisper API 请求超时（>10分钟）'
        : (err?.message || String(err))
      const retryable = err?.name === 'AbortError' || /fetch failed|network|econnreset|socket|timeout|超时/i.test(lastError)
      if (!retryable || attempt >= 2) throw new Error(lastError)
      await new Promise((resolve) => setTimeout(resolve, 8_000))
    } finally {
      clearTimeout(timer)
    }
  }

  if (!data) throw new Error(lastError || 'Whisper API 未返回识别结果')

  const rawSegments = Array.isArray(data.segments) ? data.segments : []
  const wordItems = Array.isArray(data.words)
    ? data.words
    : rawSegments.flatMap((segment: any) => Array.isArray(segment?.words) ? segment.words : [])
  const rawWords: AsrWord[] = wordItems.map((word: any) => {
    const start = finiteTime(word?.start, 0)
    const end = finiteTime(word?.end, start)
    return {
      start,
      end: end > start ? end : start + 0.05,
      text: String(word?.word ?? word?.text ?? '').trim()
    }
  }).filter((word: AsrWord) => word.text.length > 0)

  const durationHint = finiteTime(data.duration, rawWords.reduce((max, word) => Math.max(max, word.end), 0))
  const segments: AsrSegment[] = rawSegments.map((seg: any, index: number) => {
    const start = finiteTime(seg?.start, index > 0 ? finiteTime(rawSegments[index - 1]?.end, 0) : 0)
    const nextStart = finiteTime(rawSegments[index + 1]?.start, 0)
    const rawEnd = finiteTime(seg?.end, 0)
    const fallbackEnd = nextStart > start
      ? nextStart
      : durationHint > start
        ? durationHint
        : start + 0.2
    const end = rawEnd > start ? rawEnd : fallbackEnd
    const text = String(seg.text || '').trim()
    const segWords = rawWords.filter((w) => w.start >= start - 0.05 && w.end <= end + 0.05)
    return {
      start,
      end: Math.max(start + 0.05, end),
      text,
      words: segWords.length > 0
        ? segWords
        : text
          ? [{ start, end: Math.max(start + 0.05, end), text }]
          : []
    }
  }).filter((s: AsrSegment) => s.text.length > 0)

  const fullText = String(data.text || segments.map((segment) => segment.text).join('')).trim()
  if (segments.length === 0 && fullText) {
    const duration = Math.max(0.1, durationHint || rawWords.reduce((max, word) => Math.max(max, word.end), 0))
    segments.push({
      start: 0,
      end: duration,
      text: fullText,
      words: rawWords.length > 0 ? rawWords : [{ start: 0, end: duration, text: fullText }]
    })
  }

  return {
    segments,
    fullText,
    language: String(data.language || 'zh')
  }
}
