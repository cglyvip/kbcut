import { create } from "zustand";
import {
  loadPermanentSettings,
  savePermanentSettings,
} from "./permanentSettings";

export interface StoreWord {
  start: number;
  end: number;
  text: string;
  excluded: boolean;
}

export interface StoreSegment {
  start: number;
  end: number;
  text: string;
  words: StoreWord[];
}

export interface AsrSettings {
  mode: "online" | "local";
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface AsrState {
  settings: AsrSettings;
  segments: StoreSegment[];
  loading: boolean;
  error: string | null;
  hydrated: boolean;
  updateSettings: (partial: Partial<AsrSettings>) => void;
  setSegments: (segments: StoreSegment[]) => void;
  toggleWordExclude: (segIndex: number, wordIndex: number) => void;
  setWordRangeExcluded: (
    segIndex: number,
    fromWord: number,
    toWord: number,
    excluded: boolean,
  ) => void;
  excludeAllInSegment: (segIndex: number) => void;
  includeAllInSegment: (segIndex: number) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clear: () => void;
  hydrateFromDisk: () => Promise<void>;
}

const STORAGE_KEY = "cut-claude-asr-settings";

function defaultSettings(): AsrSettings {
  return {
    mode: "online",
    apiKey: "",
    baseUrl: "https://api.openai.com",
    model: "whisper-1",
  };
}

function loadSettingsFromLocalStorage(): AsrSettings {
  const defaults = defaultSettings();
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...defaults, ...JSON.parse(saved) };
  } catch {}
  return defaults;
}

function saveSettingsLocal(settings: AsrSettings): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...settings, apiKey: "" }),
    );
  } catch {}
}

function persistSettings(settings: AsrSettings): void {
  saveSettingsLocal(settings);
  savePermanentSettings({
    asr: {
      mode: settings.mode,
      apiKey: settings.apiKey,
      baseUrl: settings.baseUrl,
      model: settings.model,
    },
  });
}

export const useAsrStore = create<AsrState>((set, get) => ({
  settings: loadSettingsFromLocalStorage(),
  segments: [],
  loading: false,
  error: null,
  hydrated: false,

  hydrateFromDisk: async () => {
    if (get().hydrated) return;
    const disk = await loadPermanentSettings();
    const local = loadSettingsFromLocalStorage();
    const localHasKey = !!local.apiKey?.trim();

    if (disk?.asr) {
      const diskSettings: AsrSettings = {
        mode: disk.asr.mode === "local" ? "local" : "online",
        apiKey: String(disk.asr.apiKey || ""),
        baseUrl: String(disk.asr.baseUrl || defaultSettings().baseUrl),
        model: String(disk.asr.model || defaultSettings().model),
      };
      const diskHasKey = !!diskSettings.apiKey.trim();
      const settings = diskHasKey || !localHasKey ? diskSettings : local;
      set({ settings, hydrated: true });
      persistSettings(settings);
      return;
    }

    set({ hydrated: true });
    persistSettings(local);
  },

  updateSettings: (partial) =>
    set((state) => {
      const newSettings = { ...state.settings, ...partial };
      persistSettings(newSettings);
      return { settings: newSettings };
    }),
  setSegments: (segments) => set({ segments }),
  toggleWordExclude: (segIndex, wordIndex) =>
    set((state) => ({
      segments: state.segments.map((seg, si) =>
        si === segIndex
          ? {
              ...seg,
              words: seg.words.map((w, wi) =>
                wi === wordIndex ? { ...w, excluded: !w.excluded } : w,
              ),
            }
          : seg,
      ),
    })),
  setWordRangeExcluded: (segIndex, fromWord, toWord, excluded) =>
    set((state) => {
      const min = Math.min(fromWord, toWord);
      const max = Math.max(fromWord, toWord);
      return {
        segments: state.segments.map((seg, si) =>
          si === segIndex
            ? {
                ...seg,
                words: seg.words.map((w, wi) =>
                  wi >= min && wi <= max ? { ...w, excluded } : w,
                ),
              }
            : seg,
        ),
      };
    }),
  excludeAllInSegment: (segIndex) =>
    set((state) => ({
      segments: state.segments.map((seg, si) =>
        si === segIndex
          ? { ...seg, words: seg.words.map((w) => ({ ...w, excluded: true })) }
          : seg,
      ),
    })),
  includeAllInSegment: (segIndex) =>
    set((state) => ({
      segments: state.segments.map((seg, si) =>
        si === segIndex
          ? { ...seg, words: seg.words.map((w) => ({ ...w, excluded: false })) }
          : seg,
      ),
    })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  clear: () => set({ segments: [], loading: false, error: null }),
}));

export interface SimpleSegment {
  start: number;
  end: number;
  text: string;
  duration: number;
  words?: { start: number; end: number; text: string }[];
}

function splitWordsByExclude(words: StoreWord[]): SimpleSegment[] {
  const result: SimpleSegment[] = [];
  let currentStart: number | null = null;
  let currentEnd = 0;
  let currentText = "";
  let currentWords: { start: number; end: number; text: string }[] = [];

  const flush = () => {
    if (currentStart === null) return;
    const duration = currentEnd - currentStart;
    if (duration >= 0.05) {
      result.push({
        start: currentStart,
        end: currentEnd,
        text: currentText,
        duration,
        words: currentWords,
      });
    }
    currentStart = null;
    currentText = "";
    currentWords = [];
  };

  for (const word of words) {
    if (!word.excluded) {
      if (currentStart === null) currentStart = word.start;
      currentEnd = word.end;
      currentText += word.text;
      currentWords.push({ start: word.start, end: word.end, text: word.text });
    } else {
      flush();
    }
  }
  flush();
  return result;
}

export function resolveIncludedSegments(
  segments: StoreSegment[],
): SimpleSegment[] {
  const result: SimpleSegment[] = [];
  for (const seg of segments) {
    if (!seg.words || seg.words.length === 0) {
      const duration = Math.max(0, seg.end - seg.start);
      if (duration >= 0.05 && seg.text.trim()) {
        result.push({
          start: seg.start,
          end: seg.end,
          text: seg.text,
          duration,
          words: [{ start: seg.start, end: seg.end, text: seg.text }],
        });
      }
      continue;
    }
    result.push(...splitWordsByExclude(seg.words));
  }
  return result;
}

/** Prefer real ASR word timings; fall back to char-average only when missing. */
export function buildEditableWords(
  start: number,
  end: number,
  text: string,
  words?: { start: number; end: number; text: string }[],
): StoreWord[] {
  const safeStart =
    Number.isFinite(Number(start)) && Number(start) >= 0 ? Number(start) : 0;
  const safeEnd =
    Number.isFinite(Number(end)) && Number(end) > safeStart
      ? Number(end)
      : safeStart + 0.05;
  const cleanedWords = (words || [])
    .map((word) => {
      const wordStartValue = Number(word?.start);
      const wordEndValue = Number(word?.end);
      const wordStart =
        Number.isFinite(wordStartValue) && wordStartValue >= 0
          ? wordStartValue
          : safeStart;
      const wordEnd =
        Number.isFinite(wordEndValue) && wordEndValue > wordStart
          ? wordEndValue
          : Math.max(wordStart + 0.05, safeEnd);
      return {
        start: wordStart,
        end: wordEnd,
        text: String(word?.text || "").trim(),
        excluded: false,
      };
    })
    .filter((word) => word.text.length > 0 && word.end > word.start);

  if (cleanedWords.length > 0) return cleanedWords;

  const chars = [...(text || "")].filter((c) => c.trim().length > 0);
  if (chars.length === 0) {
    return [
      { start: safeStart, end: safeEnd, text: text || " ", excluded: false },
    ];
  }

  const dur = Math.max(0.05, safeEnd - safeStart);
  const charDur = dur / chars.length;
  return chars.map((c, i) => ({
    start: safeStart + i * charDur,
    end: safeStart + (i + 1) * charDur,
    text: c,
    excluded: false,
  }));
}
