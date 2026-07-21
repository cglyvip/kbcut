import { readFile } from 'fs/promises'
import { basename } from 'path'

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

export async function onlineAsr(audioPath: string, config: WhisperConfig): Promise<AsrResult> {
  const { apiKey, baseUrl, model = 'whisper-1' } = config

  const url = `${baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/audio/transcriptions`
  const fileName = basename(audioPath).replace(/\.pcm$/i, '.wav')
  const fileBuffer = await readFile(audioPath)
  const mimeType = audioPath.toLowerCase().endsWith('.wav') ? 'audio/wav' : 'application/octet-stream'

  let data: any = null
  let lastError = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const blob = new Blob([fileBuffer], { type: mimeType })
    const form = new FormData()
    form.append('file', blob, fileName.endsWith('.wav') ? fileName : `${fileName}.wav`)
    form.append('model', model)
    form.append('response_format', 'verbose_json')
    form.append('timestamp_granularities[]', 'segment')
    form.append('timestamp_granularities[]', 'word')
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
      lastError = `Whisper API 请求失败 (${response.status}): ${errorText.slice(0, 500)}`
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500
      if (!retryable || attempt >= 2) throw new Error(lastError)
      await new Promise((resolve) => setTimeout(resolve, response.status === 429 ? 30_000 : 8_000))
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

  const rawWords: AsrWord[] = (data.words || []).map((w: any) => ({
    start: Number(w.start) || 0,
    end: Number(w.end) || 0,
    text: String(w.word || '').trim()
  })).filter((w: AsrWord) => w.text.length > 0)

  const segments: AsrSegment[] = (data.segments || []).map((seg: any) => {
    const start = Number(seg.start) || 0
    const end = Number(seg.end) || 0
    const text = String(seg.text || '').trim()
    const segWords = rawWords.filter((w) => w.start >= start - 0.05 && w.end <= end + 0.05)
    return {
      start,
      end,
      text,
      words: segWords.length > 0
        ? segWords
        : text
          ? [{ start, end, text }]
          : []
    }
  }).filter((s: AsrSegment) => s.text.length > 0)

  if (segments.length === 0 && String(data.text || '').trim()) {
    const text = String(data.text).trim()
    const wavDuration = Math.max(0.1, (fileBuffer.length - 44) / (16_000 * 2))
    const duration = Number(data.duration) > 0 ? Number(data.duration) : wavDuration
    segments.push({
      start: 0,
      end: duration,
      text,
      words: [{ start: 0, end: duration, text }]
    })
  }

  return {
    segments,
    fullText: data.text || segments.map((s) => s.text).join(''),
    language: data.language || 'zh'
  }
}
