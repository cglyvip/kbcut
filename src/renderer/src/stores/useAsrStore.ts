import { create } from 'zustand'

export interface StoreWord {
  start: number
  end: number
  text: string
  excluded: boolean
}

export interface StoreSegment {
  start: number
  end: number
  text: string
  words: StoreWord[]
}

export interface AsrSettings {
  mode: 'online' | 'local'
  apiKey: string
  baseUrl: string
  model: string
}

interface AsrState {
  settings: AsrSettings
  segments: StoreSegment[]
  loading: boolean
  error: string | null
  updateSettings: (partial: Partial<AsrSettings>) => void
  setSegments: (segments: StoreSegment[]) => void
  toggleWordExclude: (segIndex: number, wordIndex: number) => void
  setWordRangeExcluded: (segIndex: number, fromWord: number, toWord: number, excluded: boolean) => void
  excludeAllInSegment: (segIndex: number) => void
  includeAllInSegment: (segIndex: number) => void
  setLoading: (loading: boolean) => void
  setError: (error: string | null) => void
  clear: () => void
}

const STORAGE_KEY = 'cut-claude-asr-settings'

function loadSettings(): AsrSettings {
  const defaults: AsrSettings = {
    mode: 'online',
    apiKey: '',
    baseUrl: 'https://api.openai.com',
    model: 'whisper-1'
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return { ...defaults, ...JSON.parse(saved) }
  } catch {}
  return defaults
}

function saveSettings(settings: AsrSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {}
}

export const useAsrStore = create<AsrState>((set) => ({
  settings: loadSettings(),
  segments: [],
  loading: false,
  error: null,
  updateSettings: (partial) => set((state) => {
    const newSettings = { ...state.settings, ...partial }
    saveSettings(newSettings)
    return { settings: newSettings }
  }),
  setSegments: (segments) => set({ segments }),
  toggleWordExclude: (segIndex, wordIndex) => set((state) => ({
    segments: state.segments.map((seg, si) =>
      si === segIndex
        ? { ...seg, words: seg.words.map((w, wi) => wi === wordIndex ? { ...w, excluded: !w.excluded } : w) }
        : seg
    )
  })),
  setWordRangeExcluded: (segIndex, fromWord, toWord, excluded) => set((state) => {
    const min = Math.min(fromWord, toWord)
    const max = Math.max(fromWord, toWord)
    return {
      segments: state.segments.map((seg, si) =>
        si === segIndex
          ? { ...seg, words: seg.words.map((w, wi) => (wi >= min && wi <= max) ? { ...w, excluded } : w) }
          : seg
      )
    }
  }),
  excludeAllInSegment: (segIndex) => set((state) => ({
    segments: state.segments.map((seg, si) =>
      si === segIndex ? { ...seg, words: seg.words.map(w => ({ ...w, excluded: true })) } : seg
    )
  })),
  includeAllInSegment: (segIndex) => set((state) => ({
    segments: state.segments.map((seg, si) =>
      si === segIndex ? { ...seg, words: seg.words.map(w => ({ ...w, excluded: false })) } : seg
    )
  })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  clear: () => set({ segments: [], loading: false, error: null })
}))

export interface SimpleSegment {
  start: number
  end: number
  text: string
  duration: number
  words?: { start: number; end: number; text: string }[]
}

function splitWordsByExclude(words: StoreWord[]): SimpleSegment[] {
  const result: SimpleSegment[] = []
  let currentStart: number | null = null
  let currentEnd = 0
  let currentText = ''
  let currentWords: { start: number; end: number; text: string }[] = []

  const flush = () => {
    if (currentStart === null) return
    const duration = currentEnd - currentStart
    if (duration >= 0.05) {
      result.push({
        start: currentStart,
        end: currentEnd,
        text: currentText,
        duration,
        words: currentWords
      })
    }
    currentStart = null
    currentText = ''
    currentWords = []
  }

  for (const word of words) {
    if (!word.excluded) {
      if (currentStart === null) currentStart = word.start
      currentEnd = word.end
      currentText += word.text
      currentWords.push({ start: word.start, end: word.end, text: word.text })
    } else {
      flush()
    }
  }
  flush()
  return result
}

export function resolveIncludedSegments(segments: StoreSegment[]): SimpleSegment[] {
  const result: SimpleSegment[] = []
  for (const seg of segments) {
    if (!seg.words || seg.words.length === 0) {
      const duration = Math.max(0, seg.end - seg.start)
      if (duration >= 0.05 && seg.text.trim()) {
        result.push({
          start: seg.start,
          end: seg.end,
          text: seg.text,
          duration,
          words: [{ start: seg.start, end: seg.end, text: seg.text }]
        })
      }
      continue
    }
    result.push(...splitWordsByExclude(seg.words))
  }
  return result
}

/** Prefer real ASR word timings; fall back to char-average only when missing. */
export function buildEditableWords(
  start: number,
  end: number,
  text: string,
  words?: { start: number; end: number; text: string }[]
): StoreWord[] {
  const cleanedWords = (words || [])
    .map((w) => ({
      start: Number(w.start) || start,
      end: Number(w.end) || end,
      text: String(w.text || '').trim(),
      excluded: false
    }))
    .filter((w) => w.text.length > 0)

  if (cleanedWords.length > 0) return cleanedWords

  const chars = [...(text || '')].filter((c) => c.trim().length > 0)
  if (chars.length === 0) {
    return [{ start, end, text: text || ' ', excluded: false }]
  }

  const dur = Math.max(0.05, (end || 0) - (start || 0))
  const charDur = dur / chars.length
  return chars.map((c, i) => ({
    start: start + i * charDur,
    end: start + (i + 1) * charDur,
    text: c,
    excluded: false
  }))
}
