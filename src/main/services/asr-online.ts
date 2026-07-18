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

  const blob = new Blob([fileBuffer], { type: mimeType })
  const form = new FormData()
  form.append('file', blob, fileName.endsWith('.wav') ? fileName : `${fileName}.wav`)
  form.append('model', model)
  form.append('response_format', 'verbose_json')
  form.append('timestamp_granularities[]', 'segment')
  form.append('timestamp_granularities[]', 'word')
  form.append('language', 'zh')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`Whisper API 请求失败 (${response.status}): ${errorText}`)
  }

  const data = await response.json() as any

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

  return {
    segments,
    fullText: data.text || segments.map((s) => s.text).join(''),
    language: data.language || 'zh'
  }
}
