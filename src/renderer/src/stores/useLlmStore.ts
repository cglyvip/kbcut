import { create } from 'zustand'

export interface LlmProviderLocal {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  enabled: boolean
}

interface LlmState {
  providers: LlmProviderLocal[]
  minDuration: number
  maxDuration: number
  variantCount: number
  topFluencyOnly: boolean
  enableSubtitle: boolean
  setProviders: (list: LlmProviderLocal[]) => void
  updateProvider: (id: string, partial: Partial<LlmProviderLocal>) => void
  addProvider: () => void
  removeProvider: (id: string) => void
  moveProviderTop: (id: string) => void
  promoteProvider: (id: string) => void
  setMinDuration: (v: number) => void
  setMaxDuration: (v: number) => void
  setVariantCount: (v: number) => void
  setTopFluencyOnly: (v: boolean) => void
  setEnableSubtitle: (v: boolean) => void
}

const LLM_STORAGE_KEY = 'cut-claude-llm-settings'
const LLM_PROVIDERS_KEY = 'cut-claude-llm-providers'
const SUBTITLE_STORAGE_KEY = 'cut-claude-enable-subtitle'
const TOP_FLUENCY_STORAGE_KEY = 'cut-claude-top-fluency-only'
const EXPORT_PREFS_KEY = 'cut-claude-export-prefs'

function uid() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

export function defaultProvider(partial?: Partial<LlmProviderLocal>): LlmProviderLocal {
  return {
    id: partial?.id || uid(),
    name: partial?.name || '主 API',
    baseUrl: partial?.baseUrl || 'https://api.openai.com',
    apiKey: partial?.apiKey || '',
    model: partial?.model || 'gpt-4o-mini',
    enabled: partial?.enabled ?? true
  }
}

function promoteList(list: LlmProviderLocal[], id: string): LlmProviderLocal[] {
  const idx = list.findIndex((p) => p.id === id)
  if (idx <= 0) return list
  const next = [...list]
  const [item] = next.splice(idx, 1)
  next.unshift(item)
  return next
}

function loadProviders(): LlmProviderLocal[] {
  try {
    const raw = localStorage.getItem(LLM_PROVIDERS_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr.length > 0) {
        return arr.map((p: any, i: number) => ({
          id: String(p.id || uid()),
          name: String(p.name || `API${i + 1}`),
          baseUrl: String(p.baseUrl || 'https://api.openai.com'),
          apiKey: String(p.apiKey || ''),
          model: String(p.model || 'gpt-4o-mini'),
          enabled: p.enabled !== false
        }))
      }
    }
  } catch {}

  try {
    const s = localStorage.getItem(LLM_STORAGE_KEY)
    if (s) {
      const old = JSON.parse(s)
      return [defaultProvider({
        name: '主 API',
        baseUrl: old.baseUrl,
        apiKey: old.apiKey,
        model: old.model,
        enabled: true
      })]
    }
  } catch {}

  return [defaultProvider()]
}

function saveProviders(list: LlmProviderLocal[]) {
  try {
    localStorage.setItem(LLM_PROVIDERS_KEY, JSON.stringify(list))
    const first = list.find((p) => p.enabled) || list[0]
    if (first) {
      localStorage.setItem(LLM_STORAGE_KEY, JSON.stringify({
        apiKey: first.apiKey,
        baseUrl: first.baseUrl,
        model: first.model
      }))
    }
  } catch {}
}

function loadBool(key: string, defaultValue: boolean): boolean {
  try {
    const s = localStorage.getItem(key)
    if (s === null) return defaultValue
    return s === '1' || s === 'true'
  } catch {
    return defaultValue
  }
}

function saveBool(key: string, value: boolean) {
  try { localStorage.setItem(key, value ? '1' : '0') } catch {}
}

function loadExportPrefs() {
  const defaults = { minDuration: 25, maxDuration: 55, variantCount: 5 }
  try {
    const s = localStorage.getItem(EXPORT_PREFS_KEY)
    if (!s) return defaults
    const parsed = JSON.parse(s)
    return {
      minDuration: Number(parsed.minDuration) || 25,
      maxDuration: Number(parsed.maxDuration) || 55,
      variantCount: Number(parsed.variantCount) || 5
    }
  } catch {
    return defaults
  }
}

function saveExportPrefs(prefs: { minDuration: number; maxDuration: number; variantCount: number }) {
  try { localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify(prefs)) } catch {}
}

const initialPrefs = loadExportPrefs()

export const useLlmStore = create<LlmState>((set, get) => ({
  providers: loadProviders(),
  minDuration: initialPrefs.minDuration,
  maxDuration: initialPrefs.maxDuration,
  variantCount: initialPrefs.variantCount,
  topFluencyOnly: loadBool(TOP_FLUENCY_STORAGE_KEY, true),
  enableSubtitle: loadBool(SUBTITLE_STORAGE_KEY, false),

  setProviders: (list) => {
    saveProviders(list)
    set({ providers: list })
  },
  updateProvider: (id, partial) => {
    const list = get().providers.map((p) => p.id === id ? { ...p, ...partial } : p)
    saveProviders(list)
    set({ providers: list })
  },
  addProvider: () => {
    const providers = get().providers
    const list = [
      ...providers,
      defaultProvider({
        name: `候补 API${providers.length}`,
        baseUrl: providers[0]?.baseUrl,
        model: providers[0]?.model
      })
    ]
    saveProviders(list)
    set({ providers: list })
  },
  removeProvider: (id) => {
    const providers = get().providers
    if (providers.length <= 1) return
    const list = providers.filter((p) => p.id !== id)
    saveProviders(list)
    set({ providers: list })
  },
  moveProviderTop: (id) => {
    const list = promoteList(get().providers, id)
    saveProviders(list)
    set({ providers: list })
  },
  promoteProvider: (id) => {
    const list = promoteList(get().providers, id)
    saveProviders(list)
    set({ providers: list })
  },
  setMinDuration: (v) => {
    const minDuration = Math.max(1, v || 1)
    const prefs = { minDuration, maxDuration: get().maxDuration, variantCount: get().variantCount }
    saveExportPrefs(prefs)
    set({ minDuration })
  },
  setMaxDuration: (v) => {
    const maxDuration = Math.max(1, v || 1)
    const prefs = { minDuration: get().minDuration, maxDuration, variantCount: get().variantCount }
    saveExportPrefs(prefs)
    set({ maxDuration })
  },
  setVariantCount: (v) => {
    const variantCount = Math.max(1, Math.min(20, v || 1))
    const prefs = { minDuration: get().minDuration, maxDuration: get().maxDuration, variantCount }
    saveExportPrefs(prefs)
    set({ variantCount })
  },
  setTopFluencyOnly: (v) => {
    saveBool(TOP_FLUENCY_STORAGE_KEY, v)
    set({ topFluencyOnly: v })
  },
  setEnableSubtitle: (v) => {
    saveBool(SUBTITLE_STORAGE_KEY, v)
    set({ enableSubtitle: v })
  }
}))
