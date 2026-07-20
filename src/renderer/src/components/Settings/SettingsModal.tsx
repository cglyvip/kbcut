import { useCallback, useState } from 'react'
import { useAsrStore } from '../../stores/useAsrStore'
import { useLlmStore } from '../../stores/useLlmStore'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { settings, updateSettings } = useAsrStore()
  const {
    providers,
    updateProvider,
    addProvider,
    removeProvider,
    moveProviderTop,
    promoteProvider,
    minDuration,
    maxDuration,
    variantCount,
    topFluencyOnly,
    enableSubtitle,
    setMinDuration,
    setMaxDuration,
    setVariantCount,
    setTopFluencyOnly,
    setEnableSubtitle
  } = useLlmStore()

  const [tab, setTab] = useState<'llm' | 'asr' | 'export'>('llm')
  const [testingId, setTestingId] = useState<string | null>(null)
  const [testingAll, setTestingAll] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

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
    } catch (e: any) {
      setErr(e?.message || String(e))
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
        promoteProvider(ok[0].providerId)
        setMsg(`✅ 可用 ${ok.length} 个，失败 ${bad.length} 个。已将成功 API 置顶。`)
      } else {
        setMsg(`❌ 全部 API 测试失败（${bad.length} 个）`)
        setErr('全部大模型 API 测试失败，请更换 API 地址/Key/模型')
      }
    } catch (e: any) {
      setErr(e?.message || String(e))
    } finally {
      setTestingAll(false)
    }
  }, [providers, promoteProvider])

  if (!open) return null

  return (
    <div style={styles.mask} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>设置</h2>
            <p style={styles.sub}>配置会永久保存到本机，重启软件后自动恢复</p>
          </div>
          <button style={styles.closeBtn} onClick={onClose}>关闭</button>
        </div>

        <div style={styles.tabs}>
          <button style={tab === 'llm' ? styles.tabActive : styles.tab} onClick={() => setTab('llm')}>大模型 API</button>
          <button style={tab === 'asr' ? styles.tabActive : styles.tab} onClick={() => setTab('asr')}>语音识别</button>
          <button style={tab === 'export' ? styles.tabActive : styles.tab} onClick={() => setTab('export')}>导出偏好</button>
        </div>

        <div style={styles.body}>
          {tab === 'llm' && (
            <div>
              <p style={styles.tip}>按顺序尝试：第1个失败自动切第2个，成功则置顶。全部失败会提醒更换 API。</p>
              <div style={styles.providerList}>
                {providers.map((p, idx) => (
                  <div key={p.id} style={styles.providerCard}>
                    <div style={styles.providerHeader}>
                      <span style={styles.providerBadge}>{idx === 0 ? '主' : `备${idx}`}</span>
                      <input
                        style={{ ...styles.input, flex: 1 }}
                        value={p.name}
                        onChange={(e) => updateProvider(p.id, { name: e.target.value })}
                        placeholder="名称"
                      />
                      <label style={styles.enableLabel}>
                        <input
                          type="checkbox"
                          checked={p.enabled}
                          onChange={(e) => updateProvider(p.id, { enabled: e.target.checked })}
                        /> 启用
                      </label>
                    </div>
                    <div style={styles.formGroup}>
                      <div style={styles.field}>
                        <label style={styles.label}>API 地址</label>
                        <input style={styles.input} value={p.baseUrl} onChange={(e) => updateProvider(p.id, { baseUrl: e.target.value })} placeholder="https://api.openai.com" />
                      </div>
                      <div style={styles.field}>
                        <label style={styles.label}>API Key</label>
                        <input style={styles.input} type="password" value={p.apiKey} onChange={(e) => updateProvider(p.id, { apiKey: e.target.value })} placeholder="sk-..." />
                      </div>
                      <div style={styles.field}>
                        <label style={styles.label}>模型</label>
                        <input style={styles.input} value={p.model} onChange={(e) => updateProvider(p.id, { model: e.target.value })} placeholder="gpt-4o-mini" />
                      </div>
                    </div>
                    <div style={styles.actions}>
                      <button style={styles.miniBtn} onClick={() => handleTestProvider(p)} disabled={!!testingId || testingAll}>
                        {testingId === p.id ? '测试中...' : '测试'}
                      </button>
                      {idx > 0 && <button style={styles.miniBtn} onClick={() => moveProviderTop(p.id)}>置顶</button>}
                      {providers.length > 1 && <button style={styles.miniDangerBtn} onClick={() => removeProvider(p.id)}>删除</button>}
                    </div>
                  </div>
                ))}
              </div>
              <div style={styles.actions}>
                <button style={styles.miniBtn} onClick={addProvider}>+ 添加候补 API</button>
                <button style={styles.miniBtn} onClick={handleTestAll} disabled={testingAll || !!testingId}>
                  {testingAll ? '批量测试中...' : '测试全部'}
                </button>
              </div>
            </div>
          )}

          {tab === 'asr' && (
            <div>
              <p style={styles.tip}>在线 Whisper 与本地识别的默认配置，导入视频后可直接使用。</p>
              <div style={styles.modeRow}>
                <button style={settings.mode === 'online' ? styles.modeActive : styles.modeBtn}
                  onClick={() => updateSettings({ mode: 'online' })}>在线识别</button>
                <button style={settings.mode === 'local' ? styles.modeActive : styles.modeBtn}
                  onClick={() => updateSettings({ mode: 'local' })}>本地识别</button>
              </div>
              {settings.mode === 'online' ? (
                <div style={styles.formGroup}>
                  <div style={styles.field}>
                    <label style={styles.label}>API 地址</label>
                    <input style={styles.input} value={settings.baseUrl} onChange={(e) => updateSettings({ baseUrl: e.target.value })} placeholder="https://api.openai.com" />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>API Key</label>
                    <input style={styles.input} type="password" value={settings.apiKey} onChange={(e) => updateSettings({ apiKey: e.target.value })} placeholder="sk-..." />
                  </div>
                  <div style={styles.field}>
                    <label style={styles.label}>模型</label>
                    <input style={styles.input} value={settings.model} onChange={(e) => updateSettings({ model: e.target.value })} placeholder="whisper-1" />
                  </div>
                </div>
              ) : (
                <p style={styles.tip}>本地 Whisper 模型，首次会下载，无需 API Key。</p>
              )}
            </div>
          )}

          {tab === 'export' && (
            <div>
              <p style={styles.tip}>默认生成与导出偏好，进入后续步骤会自动带上。</p>
              <div style={styles.row}>
                <div style={styles.field}>
                  <label style={styles.label}>最小秒</label>
                  <input style={styles.input} type="number" min={1} value={minDuration}
                    onChange={(e) => setMinDuration(Number(e.target.value) || 1)} />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>最大秒</label>
                  <input style={styles.input} type="number" min={1} value={maxDuration}
                    onChange={(e) => setMaxDuration(Number(e.target.value) || 1)} />
                </div>
                <div style={styles.field}>
                  <label style={styles.label}>变体数</label>
                  <input style={styles.input} type="number" min={1} max={20} value={variantCount}
                    onChange={(e) => setVariantCount(Number(e.target.value) || 1)} />
                </div>
              </div>

              <div style={styles.optionBox} onClick={() => setTopFluencyOnly(!topFluencyOnly)}>
                <div style={styles.switchRow}>
                  <div style={{ ...styles.switchTrack, ...(topFluencyOnly ? styles.switchTrackOn : {}) }}>
                    <div style={{ ...styles.switchThumb, ...(topFluencyOnly ? styles.switchThumbOn : {}) }} />
                  </div>
                  <div>
                    <div style={styles.switchTitle}>仅保留通顺度最高 3 条</div>
                    <div style={styles.switchDesc}>{topFluencyOnly ? '生成后只保留最通顺的 Top3' : '按设定变体数生成'}</div>
                  </div>
                </div>
              </div>

              <div style={{ ...styles.optionBox, marginTop: 10 }} onClick={() => setEnableSubtitle(!enableSubtitle)}>
                <div style={styles.switchRow}>
                  <div style={{ ...styles.switchTrack, ...(enableSubtitle ? styles.switchTrackOn : {}) }}>
                    <div style={{ ...styles.switchThumb, ...(enableSubtitle ? styles.switchThumbOn : {}) }} />
                  </div>
                  <div>
                    <div style={styles.switchTitle}>默认烧录字幕</div>
                    <div style={styles.switchDesc}>{enableSubtitle ? '导出时默认嵌入字幕' : '导出时默认不带字幕'}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {msg && <p style={styles.msg}>{msg}</p>}
          {err && <p style={styles.err}>{err}</p>}
        </div>

        <div style={styles.footer}>
          <button style={styles.saveBtn} onClick={onClose}>完成</button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  mask: {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.45)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 1000, padding: 20
  },
  modal: {
    width: 'min(720px, 100%)', maxHeight: '90vh', background: '#fff',
    borderRadius: 14, boxShadow: '0 16px 48px rgba(0,0,0,0.18)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden'
  },
  header: {
    padding: '18px 20px', borderBottom: '1px solid #f0f0f0',
    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
  },
  title: { margin: 0, fontSize: 18, color: '#1a1a2e' },
  sub: { margin: '4px 0 0', fontSize: 12, color: '#8c8c8c' },
  closeBtn: {
    border: '1px solid #d9d9d9', background: '#fff', borderRadius: 6,
    padding: '6px 12px', cursor: 'pointer', fontSize: 13
  },
  tabs: { display: 'flex', gap: 8, padding: '12px 20px 0' },
  tab: {
    border: '1px solid #d9d9d9', background: '#fff', color: '#595959',
    borderRadius: 16, padding: '6px 14px', cursor: 'pointer', fontSize: 13
  },
  tabActive: {
    border: '1px solid #1677ff', background: '#e6f4ff', color: '#1677ff',
    borderRadius: 16, padding: '6px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600
  },
  body: { padding: 20, overflowY: 'auto' as const, flex: 1 },
  tip: { fontSize: 12, color: '#8c8c8c', margin: '0 0 12px', lineHeight: 1.6 },
  providerList: { display: 'flex', flexDirection: 'column' as const, gap: 10 },
  providerCard: { border: '1px solid #f0f0f0', borderRadius: 8, padding: 12, background: '#fcfcfc' },
  providerHeader: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 },
  providerBadge: { fontSize: 11, color: '#fff', background: '#1677ff', borderRadius: 4, padding: '2px 6px' },
  enableLabel: { fontSize: 12, color: '#595959', display: 'flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap' as const },
  formGroup: { display: 'flex', flexDirection: 'column' as const, gap: 10 },
  field: { display: 'flex', flexDirection: 'column' as const, gap: 4, flex: 1 },
  label: { fontSize: 12, color: '#8c8c8c' },
  input: {
    padding: '8px 10px', border: '1px solid #d9d9d9', borderRadius: 6,
    fontSize: 13, outline: 'none', width: '100%', boxSizing: 'border-box' as const
  },
  actions: { display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' as const },
  miniBtn: {
    fontSize: 12, color: '#1677ff', background: '#e6f4ff', border: '1px solid #91caff',
    borderRadius: 4, padding: '4px 10px', cursor: 'pointer'
  },
  miniDangerBtn: {
    fontSize: 12, color: '#ff4d4f', background: '#fff1f0', border: '1px solid #ffa39e',
    borderRadius: 4, padding: '4px 10px', cursor: 'pointer'
  },
  modeRow: { display: 'flex', gap: 8, marginBottom: 12 },
  modeBtn: {
    flex: 1, padding: '8px 0', border: '1px solid #d9d9d9', borderRadius: 6,
    background: '#fff', color: '#595959', cursor: 'pointer', fontSize: 14
  },
  modeActive: {
    flex: 1, padding: '8px 0', border: '1px solid #1677ff', borderRadius: 6,
    background: '#e6f4ff', color: '#1677ff', cursor: 'pointer', fontSize: 14, fontWeight: 500
  },
  row: { display: 'flex', gap: 12 },
  optionBox: {
    marginTop: 12, padding: 12, background: '#f7fbff', border: '1px solid #d6e4ff',
    borderRadius: 8, cursor: 'pointer'
  },
  switchRow: { display: 'flex', alignItems: 'center', gap: 12 },
  switchTrack: {
    width: 42, height: 24, borderRadius: 12, background: '#d9d9d9',
    position: 'relative' as const, transition: 'all 0.2s', flexShrink: 0
  },
  switchTrackOn: { background: '#1677ff' },
  switchThumb: {
    width: 18, height: 18, borderRadius: 9, background: '#fff',
    position: 'absolute' as const, top: 3, left: 3, transition: 'all 0.2s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.2)'
  },
  switchThumbOn: { left: 21 },
  switchTitle: { fontSize: 14, color: '#262626', fontWeight: 500 },
  switchDesc: { fontSize: 12, color: '#8c8c8c', marginTop: 2 },
  msg: { fontSize: 12, color: '#595959', marginTop: 12, whiteSpace: 'pre-wrap' as const },
  err: { fontSize: 12, color: '#ff4d4f', marginTop: 8, whiteSpace: 'pre-wrap' as const },
  footer: {
    padding: '12px 20px', borderTop: '1px solid #f0f0f0',
    display: 'flex', justifyContent: 'flex-end'
  },
  saveBtn: {
    background: '#1677ff', color: '#fff', border: 'none', borderRadius: 6,
    padding: '8px 18px', cursor: 'pointer', fontSize: 14, fontWeight: 500
  }
}

