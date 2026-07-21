import { app, safeStorage } from 'electron'
import { join } from 'path'
import { mkdir, readFile, writeFile } from 'fs/promises'

export interface PersistedLlmProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  enabled: boolean
}

export interface PersistedAppSettings {
  version: number
  updatedAt: number
  llm: {
    providers: PersistedLlmProvider[]
    minDuration: number
    maxDuration: number
    variantCount: number
    topFluencyOnly: boolean
    enableSubtitle: boolean
    exportResolution: '720' | '1080' | '1440' | 'source'
    rpmLimit: number
  }
  asr: {
    mode: 'online' | 'local'
    apiKey: string
    baseUrl: string
    model: string
  }
  outputDir: string
}

const SETTINGS_VERSION = 1
const FILE_NAME = 'app-settings.json'

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings', FILE_NAME)
}

function canEncrypt(): boolean {
  try {
    return typeof safeStorage?.isEncryptionAvailable === 'function' && safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

function sealSecret(value: string): string {
  const text = String(value || '')
  if (!text) return ''
  if (!canEncrypt()) return text
  try {
    const buf = safeStorage.encryptString(text)
    return `enc:${buf.toString('base64')}`
  } catch {
    return text
  }
}

function openSecret(value: string): string {
  const text = String(value || '')
  if (!text) return ''
  if (!text.startsWith('enc:')) return text
  if (!canEncrypt()) return ''
  try {
    const raw = Buffer.from(text.slice(4), 'base64')
    return safeStorage.decryptString(raw)
  } catch {
    return ''
  }
}

function defaultSettings(): PersistedAppSettings {
  return {
    version: SETTINGS_VERSION,
    updatedAt: Date.now(),
    llm: {
      providers: [{
        id: 'p_default',
        name: '主 API',
        baseUrl: 'https://api.openai.com',
        apiKey: '',
        model: 'gpt-4o-mini',
        enabled: true
      }],
      minDuration: 25,
      maxDuration: 55,
      variantCount: 5,
      topFluencyOnly: true,
      enableSubtitle: false,
      exportResolution: '1080',
      rpmLimit: 5
    },
    asr: {
      mode: 'online',
      apiKey: '',
      baseUrl: 'https://api.openai.com',
      model: 'whisper-1'
    },
    outputDir: ''
  }
}

function normalizeSettings(input: any): PersistedAppSettings {
  const base = defaultSettings()
  const src = input && typeof input === 'object' ? input : {}

  const providersRaw = Array.isArray(src?.llm?.providers) ? src.llm.providers : base.llm.providers
  const providers = providersRaw.map((p: any, i: number) => ({
    id: String(p?.id || `p_${i + 1}`),
    name: String(p?.name || `API${i + 1}`),
    baseUrl: String(p?.baseUrl || 'https://api.openai.com'),
    apiKey: openSecret(String(p?.apiKey || '')),
    model: String(p?.model || 'gpt-4o-mini'),
    enabled: p?.enabled !== false
  }))

  return {
    version: SETTINGS_VERSION,
    updatedAt: Number(src.updatedAt) || Date.now(),
    llm: {
      providers: providers.length > 0 ? providers : base.llm.providers,
      minDuration: Number(src?.llm?.minDuration) || base.llm.minDuration,
      maxDuration: Number(src?.llm?.maxDuration) || base.llm.maxDuration,
      variantCount: Number(src?.llm?.variantCount) || base.llm.variantCount,
      topFluencyOnly: src?.llm?.topFluencyOnly !== false,
      enableSubtitle: !!src?.llm?.enableSubtitle,
      rpmLimit: Math.max(5, Math.min(10, Math.round(Number(src?.llm?.rpmLimit) || 5))),
      exportResolution: (src?.llm?.exportResolution === '720' || src?.llm?.exportResolution === '1080' || src?.llm?.exportResolution === '1440' || src?.llm?.exportResolution === 'source')
        ? src.llm.exportResolution
        : '1080'
    },
    asr: {
      mode: src?.asr?.mode === 'local' ? 'local' : 'online',
      apiKey: openSecret(String(src?.asr?.apiKey || '')),
      baseUrl: String(src?.asr?.baseUrl || base.asr.baseUrl),
      model: String(src?.asr?.model || base.asr.model)
    },
    outputDir: String(src?.outputDir || '')
  }
}

function toDiskPayload(settings: PersistedAppSettings): any {
  return {
    version: SETTINGS_VERSION,
    updatedAt: Date.now(),
    llm: {
      ...settings.llm,
      providers: (settings.llm.providers || []).map((p) => ({
        ...p,
        apiKey: sealSecret(p.apiKey || '')
      }))
    },
    asr: {
      ...settings.asr,
      apiKey: sealSecret(settings.asr.apiKey || '')
    },
    outputDir: settings.outputDir || ''
  }
}

async function ensureDir(): Promise<void> {
  await mkdir(join(app.getPath('userData'), 'settings'), { recursive: true })
}

export async function loadAppSettings(): Promise<PersistedAppSettings> {
  try {
    const raw = await readFile(settingsPath(), 'utf-8')
    return normalizeSettings(JSON.parse(raw))
  } catch {
    return defaultSettings()
  }
}

export async function saveAppSettings(
  partial: Partial<PersistedAppSettings> & {
    llm?: Partial<PersistedAppSettings['llm']>
    asr?: Partial<PersistedAppSettings['asr']>
  }
): Promise<{ ok: boolean; settings?: PersistedAppSettings; error?: string }> {
  try {
    const current = await loadAppSettings()
    const next: PersistedAppSettings = {
      version: SETTINGS_VERSION,
      updatedAt: Date.now(),
      llm: {
        ...current.llm,
        ...(partial.llm || {})
      },
      asr: {
        ...current.asr,
        ...(partial.asr || {})
      },
      outputDir: partial.outputDir !== undefined ? String(partial.outputDir || '') : current.outputDir
    }

    // If providers provided, replace whole list
    if (partial.llm?.providers) {
      next.llm.providers = partial.llm.providers.map((p, i) => ({
        id: String(p.id || `p_${i + 1}`),
        name: String(p.name || `API${i + 1}`),
        baseUrl: String(p.baseUrl || 'https://api.openai.com'),
        apiKey: String(p.apiKey || ''),
        model: String(p.model || 'gpt-4o-mini'),
        enabled: p.enabled !== false
      }))
    }

    await ensureDir()
    await writeFile(settingsPath(), JSON.stringify(toDiskPayload(next), null, 2), 'utf-8')
    return { ok: true, settings: next }
  } catch (err: any) {
    console.error('[saveAppSettings]', err)
    return { ok: false, error: err?.message || String(err) }
  }
}

export function getAppSettingsPath(): string {
  return settingsPath()
}

