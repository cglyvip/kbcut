import { create } from 'zustand'
import { loadPermanentSettings, savePermanentSettings } from './permanentSettings'

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
  exportResolution: '720' | '1080' | '1440' | 'source'
  hydrated: boolean
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
  setExportResolution: (v: '720' | '1080' | '1440' | 'source') => void
  hydrateFromDisk: () => Promise<void>
}

const LLM_STORAGE_KEY = 'cut-claude-llm-settings'
const LLM_PROVIDERS_KEY = 'cut-claude-llm-providers'
const SUBTITLE_STORAGE_KEY = 'cut-claude-enable-subtitle'
const TOP_FLUENCY_STORAGE_KEY = 'cut-claude-top-fluency-only'
const EXPORT_PREFS_KEY = 'cut-claude-export-prefs'
const EXPORT_RESOLUTION_KEY = 'cut-claude-export-resolution'

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

function normalizeProviders(list: any[]): LlmProviderLocal[] {
  if (!Array.isArray(list) || list.length === 0) return [defaultProvider()]
  return list.map((p: any, i: number) => ({
    id: String(p.id || uid()),
    name: String(p.name || `API${i + 1}`),
    baseUrl: String(p.baseUrl || 'https://api.openai.com'),
    apiKey: String(p.apiKey || ''),
    model: String(p.model || 'gpt-4o-mini'),
    enabled: p.enabled !== false
  }))
}

function loadProvidersFromLocalStorage(): LlmProviderLocal[] {
  try {
    const raw = localStorage.getItem(LLM_PROVIDERS_KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr) && arr.length > 0) return normalizeProviders(arr)
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

function saveProvidersLocal(list: LlmProviderLocal[]) {
  // keep localStorage as cache/fallback; permanent source of truth is disk
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

function loadExportResolution(): '720' | '1080' | '1440' | 'source' {
  try {
    const s = localStorage.getItem(EXPORT_RESOLUTION_KEY)
    if (s === '720' || s === '1080' || s === '1440' || s === 'source') return s
  } catch {}
  return '1080'
}

function saveExportResolution(v: '720' | '1080' | '1440' | 'source') {
  try { localStorage.setItem(EXPORT_RESOLUTION_KEY, v) } catch {}
}

function saveExportPrefs(prefs: { minDuration: number; maxDuration: number; variantCount: number }) {
  try { localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify(prefs)) } catch {}
}

function persistAll(state: {
  providers: LlmProviderLocal[]
  minDuration: number
  maxDuration: number
  variantCount: number
  topFluencyOnly: boolean
  enableSubtitle: boolean
  exportResolution: '720' | '1080' | '1440' | 'source'
}) {
  saveProvidersLocal(state.providers)
  saveExportPrefs({
    minDuration: state.minDuration,
    maxDuration: state.maxDuration,
    variantCount: state.variantCount
  })
  saveBool(TOP_FLUENCY_STORAGE_KEY, state.topFluencyOnly)
  saveBool(SUBTITLE_STORAGE_KEY, state.enableSubtitle)
  saveExportResolution(state.exportResolution)

  savePermanentSettings({
    llm: {
      providers: state.providers,
      minDuration: state.minDuration,
      maxDuration: state.maxDuration,
      variantCount: state.variantCount,
      topFluencyOnly: state.topFluencyOnly,
      enableSubtitle: state.enableSubtitle,
      exportResolution: state.exportResolution
    }
  })
}

const initialPrefs = loadExportPrefs()

export const useLlmStore = create<LlmState>((set, get) => ({
  providers: loadProvidersFromLocalStorage(),
  minDuration: initialPrefs.minDuration,
  maxDuration: initialPrefs.maxDuration,
  variantCount: initialPrefs.variantCount,
  topFluencyOnly: loadBool(TOP_FLUENCY_STORAGE_KEY, true),
  enableSubtitle: loadBool(SUBTITLE_STORAGE_KEY, false),
  exportResolution: loadExportResolution(),
  hydrated: false,

  hydrateFromDisk: async () => {
    if (get().hydrated) return
    const disk = await loadPermanentSettings()
    const localProviders = loadProvidersFromLocalStorage()
    const localHasKey = localProviders.some((p) => !!p.apiKey?.trim())

    if (disk?.llm) {
      const diskProviders = normalizeProviders(disk.llm.providers || [])
      const diskHasKey = diskProviders.some((p) => !!p.apiKey?.trim())

      // Prefer disk if it already has keys; otherwise migrate localStorage keys onto disk
      const providers = diskHasKey || !localHasKey ? diskProviders : localProviders
      const next = {
        providers,
        minDuration: Number(disk.llm.minDuration) || get().minDuration,
        maxDuration: Number(disk.llm.maxDuration) || get().maxDuration,
        variantCount: Number(disk.llm.variantCount) || get().variantCount,
        topFluencyOnly: disk.llm.topFluencyOnly !== false,
        enableSubtitle: !!disk.llm.enableSubtitle,
        exportResolution: (disk.llm.exportResolution === '720' || disk.llm.exportResolution === '1080' || disk.llm.exportResolution === '1440' || disk.llm.exportResolution === 'source')
          ? disk.llm.exportResolution
          : get().exportResolution
      }
      set({ ...next, hydrated: true })
      // always rewrite permanent settings so future launches keep them
      persistAll(next)
      return
    }

    // no disk settings yet: migrate current local values to disk
    const next = {
      providers: localProviders,
      minDuration: get().minDuration,
      maxDuration: get().maxDuration,
      variantCount: get().variantCount,
      topFluencyOnly: get().topFluencyOnly,
      enableSubtitle: get().enableSubtitle,
      exportResolution: get().exportResolution
    }
    set({ hydrated: true })
    persistAll(next)
  },

  setProviders: (list) => {
    const providers = normalizeProviders(list)
    const next = { ...pickPersist(get()), providers }
    set({ providers })
    persistAll(next)
  },
  updateProvider: (id, partial) => {
    const providers = get().providers.map((p) => p.id === id ? { ...p, ...partial } : p)
    const next = { ...pickPersist(get()), providers }
    set({ providers })
    persistAll(next)
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
    const next = { ...pickPersist(get()), providers: list }
    set({ providers: list })
    persistAll(next)
  },
  removeProvider: (id) => {
    const providers = get().providers
    if (providers.length <= 1) return
    const list = providers.filter((p) => p.id !== id)
    const next = { ...pickPersist(get()), providers: list }
    set({ providers: list })
    persistAll(next)
  },
  moveProviderTop: (id) => {
    const list = promoteList(get().providers, id)
    const next = { ...pickPersist(get()), providers: list }
    set({ providers: list })
    persistAll(next)
  },
  promoteProvider: (id) => {
    const list = promoteList(get().providers, id)
    const next = { ...pickPersist(get()), providers: list }
    set({ providers: list })
    persistAll(next)
  },
  setMinDuration: (v) => {
    const minDuration = Math.max(1, v || 1)
    const next = { ...pickPersist(get()), minDuration }
    set({ minDuration })
    persistAll(next)
  },
  setMaxDuration: (v) => {
    const maxDuration = Math.max(1, v || 1)
    const next = { ...pickPersist(get()), maxDuration }
    set({ maxDuration })
    persistAll(next)
  },
  setVariantCount: (v) => {
    const variantCount = Math.max(1, Math.min(20, v || 1))
    const next = { ...pickPersist(get()), variantCount }
    set({ variantCount })
    persistAll(next)
  },
  setTopFluencyOnly: (v) => {
    const next = { ...pickPersist(get()), topFluencyOnly: v }
    set({ topFluencyOnly: v })
    persistAll(next)
  },
  setEnableSubtitle: (v) => {
    const next = { ...pickPersist(get()), enableSubtitle: v }
    set({ enableSubtitle: v })
    persistAll(next)
  },
  setExportResolution: (v) => {
    const exportResolution = (v === '720' || v === '1080' || v === '1440' || v === 'source') ? v : '1080'
    const next = { ...pickPersist(get()), exportResolution }
    set({ exportResolution })
    persistAll(next)
  }
}))

function pickPersist(state: LlmState) {
  return {
    providers: state.providers,
    minDuration: state.minDuration,
    maxDuration: state.maxDuration,
    variantCount: state.variantCount,
    topFluencyOnly: state.topFluencyOnly,
    enableSubtitle: state.enableSubtitle,
    exportResolution: state.exportResolution
  }
}



