import { useCallback, useEffect, useState } from 'react'
import { useAsrStore } from '../../stores/useAsrStore'
import { savePermanentSettingsNow } from '../../stores/permanentSettings'
import { useLlmStore } from '../../stores/useLlmStore'
import { styles } from './styles'
import type { AsrModelInfoView, LocalModelAdviceView } from './types'
import LlmTab from './tabs/LlmTab'
import AsrTab from './tabs/AsrTab'
import AsrGuideTab from './tabs/AsrGuideTab'
import ExportTab from './tabs/ExportTab'
import LocalModelTab from './tabs/LocalModelTab'
import AboutTab from './tabs/AboutTab'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const handleClose = async () => {
    await savePermanentSettingsNow({})
    onClose()
  }

  const { updateSettings } = useAsrStore()
  const { providers, promoteProvider, applyLocalPreset } = useLlmStore()

  const [tab, setTab] = useState<'llm' | 'asr' | 'asrGuide' | 'export' | 'local' | 'about'>('llm')
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testingAll, setTestingAll] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [localAdvice, setLocalAdvice] = useState<LocalModelAdviceView | null>(null)
  const [localLoading, setLocalLoading] = useState(false)
  const [localErr, setLocalErr] = useState<string | null>(null)
  const [applyingId, setApplyingId] = useState<string | null>(null)
  const [asrModelInfo, setAsrModelInfo] = useState<AsrModelInfoView | null>(null)
  const [asrModelLoading, setAsrModelLoading] = useState(false)

  const handleTestProvider = useCallback(async (provider: typeof providers[number]) => {
    setTestingId(provider.id)
    setMsg(null)
    setErr(null)
    try {
      const res = await window.api.testLlmProvider(provider)
      if (res.ok) {
        setMsg(`✅ ${res.providerName}: ${res.message}`)
        promoteProvider(provider.id)
      } else {
        setMsg(`❌ ${res.providerName}: ${res.message}`)
        setErr(`大模型测试失败，请检查/更换 API：${res.message}`)
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setTestingId(null)
    }
  }, [promoteProvider])

  const handleTestAll = useCallback(async () => {
    if (providers.length === 0) return
    setTestingAll(true)
    setMsg(null)
    setErr(null)
    try {
      const results = await window.api.testLlmProviders(providers)
      const ok = results.filter((r) => r.ok)
      const bad = results.filter((r) => !r.ok)
      if (ok.length > 0) {
        promoteProvider(ok[0]!.providerId)
        setMsg(`✅ 可用 ${ok.length} 个，失败 ${bad.length} 个。已将成功 API 置顶。`)
      } else {
        setMsg(`❌ 全部 API 测试失败（${bad.length} 个）`)
        setErr('全部大模型 API 测试失败，请更换 API 地址/Key/模型')
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setTestingAll(false)
    }
  }, [providers, promoteProvider])

  const loadLocalAdvice = useCallback(async () => {
    setLocalLoading(true)
    setLocalErr(null)
    try {
      const advice = await window.api.getLocalModelAdvice()
      setLocalAdvice(advice as LocalModelAdviceView)
    } catch (e: unknown) {
      setLocalAdvice(null)
      setLocalErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLocalLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open || tab !== 'local') return
    void loadLocalAdvice()
  }, [open, tab, loadLocalAdvice])

  const loadAsrModelInfo = useCallback(async () => {
    setAsrModelLoading(true)
    try {
      setAsrModelInfo(await window.api.getAsrModelInfo())
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '读取本地识别模型状态失败')
    } finally {
      setAsrModelLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open || tab !== 'asrGuide') return
    void loadAsrModelInfo()
  }, [open, tab, loadAsrModelInfo])

  const handleApplyLocalPreset = useCallback((rec: LocalModelAdviceView['recommendations'][number], asPrimary: boolean) => {
    setApplyingId(rec.id)
    setMsg(null)
    setErr(null)
    try {
      const id = applyLocalPreset(rec.providerPreset)
      if (!id) {
        setErr('本地模型配置无效，无法填入')
        return
      }
      if (asPrimary) promoteProvider(id)
      const runtimeReady = rec.runtime === 'lmstudio'
        ? !!localAdvice?.runtime.lmStudio.running
        : !!localAdvice?.runtime.ollama.running
      const filled = asPrimary
        ? `✅ 已将 ${rec.name} 设为主 API，并永久保存`
        : `✅ 已填入 ${rec.name}，可在「大模型 API」页查看/测试`
      setMsg(runtimeReady
        ? filled
        : `${filled}。注意：本机尚未检测到本地服务/模型，请先安装客户端并下载模型后再测试`)
      setTab('llm')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setApplyingId(null)
    }
  }, [applyLocalPreset, promoteProvider, localAdvice])

  const openExternal = useCallback(async (url?: string) => {
    const target = String(url || '').trim()
    if (!target) return
    setMsg(null)
    setErr(null)
    try {
      if (typeof window.api.openExternal === 'function') {
        const res = await window.api.openExternal(target)
        if (!res?.ok) setErr(res?.error || '打开链接失败')
        else setMsg(`已打开：${target}`)
        return
      }
      window.open(target, '_blank')
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const copyText = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setMsg(`✅ 已复制${label}`)
      setErr(null)
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : '复制失败')
    }
  }, [])

  // Suppress unused import warning — updateSettings is used in AsrTab via store directly
  void updateSettings

  if (!open) return null

  return (
    <div style={styles.mask} onClick={() => { void handleClose() }}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>设置</h2>
            <p style={styles.sub}>配置会永久保存到本机，重启后自动恢复；导出分辨率可设置（保持比例）</p>
          </div>
          <button style={styles.closeBtn} onClick={() => { void handleClose() }}>关闭</button>
        </div>

        <div style={styles.tabs}>
          <button style={tab === 'llm' ? styles.tabActive : styles.tab} onClick={() => setTab('llm')}>大模型 API</button>
          <button style={tab === 'asr' ? styles.tabActive : styles.tab} onClick={() => setTab('asr')}>语音识别</button>
          <button style={tab === 'asrGuide' ? styles.tabActive : styles.tab} onClick={() => setTab('asrGuide')}>识别教程</button>
          <button style={tab === 'export' ? styles.tabActive : styles.tab} onClick={() => setTab('export')}>导出偏好</button>
          <button style={tab === 'local' ? styles.tabActive : styles.tab} onClick={() => setTab('local')}>本地模型推荐</button>
          <button style={tab === 'about' ? styles.tabActive : styles.tab} onClick={() => setTab('about')}>关于</button>
        </div>

        <div style={styles.body}>
          {tab === 'llm' && (
            <LlmTab
              testingId={testingId}
              testingAll={testingAll}
              onTestProvider={handleTestProvider}
              onTestAll={handleTestAll}
              setMsg={setMsg}
              setErr={setErr}
            />
          )}
          {tab === 'asr' && <AsrTab />}
          {tab === 'asrGuide' && (
            <AsrGuideTab
              asrModelInfo={asrModelInfo}
              asrModelLoading={asrModelLoading}
              onRefreshModelInfo={() => void loadAsrModelInfo()}
              onOpenExternal={(url) => void openExternal(url)}
            />
          )}
          {tab === 'export' && <ExportTab />}
          {tab === 'local' && (
            <LocalModelTab
              localAdvice={localAdvice}
              localLoading={localLoading}
              localErr={localErr}
              applyingId={applyingId}
              onReload={() => void loadLocalAdvice()}
              onOpenExternal={(url) => void openExternal(url)}
              onCopyText={(text, label) => void copyText(text, label)}
              onApplyPreset={handleApplyLocalPreset}
            />
          )}
          {tab === 'about' && (
            <AboutTab onOpenExternal={(url) => void openExternal(url)} />
          )}

          {msg && <p style={styles.msg}>{msg}</p>}
          {err && <p style={styles.err}>{err}</p>}
        </div>

        <div style={styles.footer}>
          <button style={styles.saveBtn} onClick={() => { void handleClose() }}>完成</button>
        </div>
      </div>
    </div>
  )
}
