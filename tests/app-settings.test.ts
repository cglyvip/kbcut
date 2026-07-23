import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({ userDataDir: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => electronState.userDataDir
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`sealed:${value}`, 'utf-8'),
    decryptString: (value: Buffer) => value.toString('utf-8').replace(/^sealed:/, '')
  }
}))

import { loadAppSettings, saveAppSettings } from '../src/main/services/app-settings'

let testDir = ''

afterEach(async () => {
  if (testDir) await rm(testDir, { recursive: true, force: true })
  testDir = ''
})

describe('permanent app settings', () => {
  it('encrypts API keys on disk and restores them for runtime use', async () => {
    testDir = await mkdtemp(join(tmpdir(), 'kbcut-settings-test-'))
    electronState.userDataDir = testDir

    const saved = await saveAppSettings({
      llm: {
        providers: [{
          id: 'p1',
          name: '主 API',
          baseUrl: 'https://example.com',
          apiKey: 'sk-secret-key',
          model: 'model-a',
          enabled: true
        }]
      },
      asr: {
        mode: 'online',
        apiKey: 'whisper-secret-key',
        baseUrl: 'https://asr.example.com',
        model: 'whisper-1'
      }
    })
    expect(saved.ok).toBe(true)

    const raw = await readFile(join(testDir, 'settings', 'app-settings.json'), 'utf-8')
    expect(raw).not.toContain('sk-secret-key')
    expect(raw).not.toContain('whisper-secret-key')
    expect(raw).toContain('enc:')

    const loaded = await loadAppSettings()
    expect(loaded.llm.providers[0].apiKey).toBe('sk-secret-key')
    expect(loaded.asr.apiKey).toBe('whisper-secret-key')
  })

  it('normalizes corrupted numeric settings before persisting', async () => {
    testDir = await mkdtemp(join(tmpdir(), 'kbcut-settings-test-'))
    electronState.userDataDir = testDir

    const saved = await saveAppSettings({
      llm: {
        minDuration: -50,
        maxDuration: 9999,
        variantCount: 999,
        rpmLimit: 999
      }
    })

    expect(saved.ok).toBe(true)
    expect(saved.settings?.llm.minDuration).toBe(1)
    expect(saved.settings?.llm.maxDuration).toBe(600)
    expect(saved.settings?.llm.variantCount).toBe(20)
    expect(saved.settings?.llm.rpmLimit).toBe(10)
  })

  it('serializes concurrent patches without losing unrelated settings', async () => {
    testDir = await mkdtemp(join(tmpdir(), 'kbcut-settings-test-'))
    electronState.userDataDir = testDir

    await Promise.all([
      saveAppSettings({ llm: { minDuration: 35, maxDuration: 70 } }),
      saveAppSettings({ asr: { apiKey: 'asr-concurrent-key', baseUrl: 'https://asr.example.com' } })
    ])

    const loaded = await loadAppSettings()
    expect(loaded.llm.minDuration).toBe(35)
    expect(loaded.llm.maxDuration).toBe(70)
    expect(loaded.asr.apiKey).toBe('asr-concurrent-key')
    expect(loaded.asr.baseUrl).toBe('https://asr.example.com')
  })
})
