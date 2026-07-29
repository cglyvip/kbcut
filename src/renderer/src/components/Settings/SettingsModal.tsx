import { useCallback, useEffect, useState } from 'react'
import { useAsrStore } from '../../stores/useAsrStore'
import { savePermanentSettingsNow } from '../../stores/permanentSettings'
import { useLlmStore } from '../../stores/useLlmStore'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

interface AsrModelInfoView {
  modelId: string
  cacheDir: string
  downloaded: boolean
  fileCount: number
  sizeBytes: number
  mirrorUrl: string
  officialUrl: string
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  return `${(bytes / 1024 ** 2).toFixed(0)} MB`
}

interface LocalModelAdviceView {
  hardware: {
    cpuModel: string
    cpuCores: number
    totalMemGB: number
    freeMemGB: number
    gpuName: string
    hasNvidia: boolean
    vramGB: number | null
  }
  runtime: {
    preferredRuntime?: 'ollama' | 'lmstudio'
    apps?: Array<{
      id: 'ollama' | 'lmstudio'
      name: string
      recommended: boolean
      running: boolean
      baseUrl: string
      defaultApiKey: string
      downloadUrl: string
      docsUrl: string
      description: string
      installSteps: string[]
      envRequirements: string[]
      models: string[]
    }>
    ollama: { running: boolean; baseUrl: string; models: string[] }
    lmStudio: { running: boolean; baseUrl: string; models?: string[] }
  }
  tier: string
  tierLabel: string
  summary: string
  tips: string[]
  setupGuide?: string[]
  recommendations: Array<{
    id: string
    name: string
    model: string
    sizeHint: string
    minRamGB: number
    reason: string
    recommended: boolean
    runtime?: 'ollama' | 'lmstudio'
    downloadCommand?: string
    downloadUrl?: string
    modelPageUrl?: string
    providerPreset: {
      name: string
      baseUrl: string
      apiKey: string
      model: string
    }
  }>
}

export default function SettingsModal({ open, onClose }: SettingsModalProps) {
  const handleClose = async () => {
    await savePermanentSettingsNow({})
    onClose()
  }

  const { settings, updateSettings } = useAsrStore()
  const {
    providers,
    updateProvider,
    addProvider,
    removeProvider,
    moveProviderTop,
    promoteProvider,
    applyLocalPreset,
    minDuration,
    maxDuration,
    variantCount,
    topFluencyOnly,
    enableSubtitle,
    exportResolution,
    rpmLimit,
    setMinDuration,
    setMaxDuration,
    setVariantCount,
    setTopFluencyOnly,
    setEnableSubtitle,
    setExportResolution,
    setRpmLimit
} = useLlmStore()

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

  const loadLocalAdvice = useCallback(async () => {
    setLocalLoading(true)
    setLocalErr(null)
    try {
      const advice = await window.api.getLocalModelAdvice()
      setLocalAdvice(advice as LocalModelAdviceView)
    } catch (e: any) {
      setLocalAdvice(null)
      setLocalErr(e?.message || String(e))
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
    } catch (e: any) {
      setErr(e?.message || '读取本地识别模型状态失败')
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
    } catch (e: any) {
      setErr(e?.message || String(e))
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
    } catch (e: any) {
      setErr(e?.message || String(e))
    }
  }, [])

  const copyText = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setMsg(`✅ 已复制${label}`)
      setErr(null)
    } catch (e: any) {
      setErr(e?.message || '复制失败')
    }
  }, [])

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
            <div>
              <p style={styles.tip}>按顺序尝试：第1个失败自动切第2个，成功则置顶。全部失败会提醒更换 API。</p>
              <div style={styles.rpmBox}>
                <div>
                  <div style={styles.switchTitle}>API 请求限速</div>
                  <div style={styles.switchDesc}>数值越低越稳定，数值越高处理越快。第三方中转 API 推荐 5 RPM。</div>
                </div>
                <select
                  style={styles.rpmSelect}
                  value={rpmLimit}
                  onChange={(e) => setRpmLimit(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rpm) => (
                    <option key={rpm} value={rpm}>
                      {rpm} RPM{rpm === 1 ? '（最低）' : rpm === 5 ? '（最稳）' : rpm === 8 ? '（均衡）' : rpm === 10 ? '（最快）' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <p style={styles.tip}>当前约每 {Math.ceil(60 / rpmLimit)} 秒最多发起 1 次请求，并保留 2 万 TPM 估算限制；遇到 429 会临时降速、冷却并自动重试。</p>
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
              <p style={styles.tip}>API 地址支持服务根地址、带版本路径的地址，也支持直接粘贴完整 <code style={styles.inlineCode}>/chat/completions</code> 接口。</p>
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
                <p style={styles.tip}>本地 Whisper 模型，首次识别会自动下载，无需 API Key。下载失败或需要查看缓存位置，请打开「识别教程」。</p>
              )}
            </div>
          )}

          {tab === 'asrGuide' && (
            <div>
              <div style={styles.guideHero}>
                <div style={styles.switchTitle}>语音识别怎么选</div>
                <div style={styles.switchDesc}>批量生产优先在线识别；重视隐私、没有 ASR API 或网络不稳定时使用本地识别。</div>
                <div style={styles.guideCompareGrid}>
                  <div style={styles.guideCompareItem}><strong>在线</strong><span>通常更快、词级时间戳更准，需要 API 和网络</span></div>
                  <div style={styles.guideCompareItem}><strong>本地</strong><span>无需 API，首次下载较慢，更依赖 CPU、内存和磁盘</span></div>
                </div>
              </div>

              <div style={styles.guideSection}>
                <div style={styles.guideTitle}>本地 Whisper 下载与使用</div>
                <ol style={styles.guideList}>
                  <li style={styles.guideItem}>进入「语音识别」，选择「本地识别」。</li>
                  <li style={styles.guideItem}>准备稳定网络，并预留至少 2GB 磁盘空间；模型为 <code style={styles.inlineCode}>onnx-community/whisper-small</code> 的量化版本。</li>
                  <li style={styles.guideItem}>导入一个较短视频并开始识别。第一次会自动从国内镜像下载，镜像失败后自动尝试 Hugging Face 官方源。</li>
                  <li style={styles.guideItem}>首次下载期间不要关闭软件。下载完成后模型永久缓存在本机，后续识别不再重复下载。</li>
                  <li style={styles.guideItem}>如果下载中断，检查代理、防火墙和剩余空间，然后直接重新识别，程序会继续使用已有缓存。</li>
                </ol>

                <div style={{ ...styles.modelStatus, ...(asrModelInfo?.downloaded ? styles.modelStatusOk : {}) }}>
                  <div>
                    <div style={styles.switchTitle}>{asrModelInfo?.downloaded ? '已检测到本地模型缓存' : '尚未检测到完整模型缓存'}</div>
                    <div style={styles.switchDesc}>
                      {asrModelLoading ? '正在检查...' : asrModelInfo ? `${asrModelInfo.fileCount} 个文件 · ${formatBytes(asrModelInfo.sizeBytes)}` : '点击刷新状态检查'}
                    </div>
                  </div>
                  <button style={styles.miniBtn} onClick={() => void loadAsrModelInfo()} disabled={asrModelLoading}>
                    {asrModelLoading ? '检查中...' : '刷新状态'}
                  </button>
                </div>
                {asrModelInfo && <div style={styles.pathBox}>{asrModelInfo.cacheDir}</div>}
                <div style={styles.actions}>
                  {asrModelInfo && <button style={styles.miniBtn} onClick={() => void window.api.openFolder(asrModelInfo.cacheDir)}>打开模型目录</button>}
                  {asrModelInfo && <button style={styles.miniBtn} onClick={() => void openExternal(asrModelInfo.mirrorUrl)}>打开国内镜像</button>}
                  {asrModelInfo && <button style={styles.miniBtn} onClick={() => void openExternal(asrModelInfo.officialUrl)}>打开官方模型页</button>}
                </div>
              </div>

              <div style={styles.guideSection}>
                <div style={styles.guideTitle}>在线 Whisper 配置与使用</div>
                <ol style={styles.guideList}>
                  <li style={styles.guideItem}>向支持 OpenAI 兼容音频转写接口的服务商申请 API Key。</li>
                  <li style={styles.guideItem}>确认服务支持 <code style={styles.inlineCode}>POST /v1/audio/transcriptions</code>，最好支持 <code style={styles.inlineCode}>verbose_json</code> 和词级时间戳。</li>
                  <li style={styles.guideItem}>API 地址可填写服务根地址、带版本路径的地址，或完整 <code style={styles.inlineCode}>/audio/transcriptions</code> 接口。</li>
                  <li style={styles.guideItem}>模型默认填写 <code style={styles.inlineCode}>whisper-1</code>；第三方服务必须填写其控制台显示的真实模型名称。</li>
                  <li style={styles.guideItem}>先用 30-60 秒短视频测试，确认中文、标点和时间戳正常，再启动批量队列。</li>
                </ol>
                <div style={styles.guideWarning}>在线识别会把提取后的音频上传到你配置的服务商。涉及隐私或未公开素材时，应先确认服务商的数据政策。</div>
                <div style={styles.errorGrid}>
                  <div><strong>401/403</strong><span>API Key 无效、权限不足或余额不可用</span></div>
                  <div><strong>404</strong><span>API 地址或模型名称错误</span></div>
                  <div><strong>413</strong><span>音频超过服务商单文件限制</span></div>
                  <div><strong>429</strong><span>请求频率或额度受限，稍后重试</span></div>
                  <div><strong>5xx/超时</strong><span>服务商异常或网络不稳定</span></div>
                </div>
              </div>
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

              <div style={{ marginTop: 14 }}>
                <div style={styles.switchTitle}>导出分辨率</div>
                <div style={styles.switchDesc}>只调整清晰度，视频比例不变，不拉伸</div>
                <div style={styles.modeRow}>
                  {([
                    { id: '720', label: '720P' },
                    { id: '1080', label: '1080P' },
                    { id: '1440', label: '2K' },
                    { id: 'source', label: '原画' }
                  ] as const).map((opt) => (
                    <button
                      key={opt.id}
                      style={exportResolution === opt.id ? styles.modeActive : styles.modeBtn}
                      onClick={() => setExportResolution(opt.id)}
                    >{opt.label}</button>
                  ))}
                </div>
                <p style={styles.tip}>
                  当前：{exportResolution === 'source' ? '保持原始分辨率' : exportResolution === '720' ? '最长边适配 720P' : exportResolution === '1440' ? '最长边适配 2K/1440P' : '最长边适配 1080P'}
                </p>
              </div>
            </div>
          )}

{tab === 'local' && (
            <div>
              <p style={styles.tip}>
                大多数用户本机没有本地模型。请先安装客户端并下载模型，再使用「一键填入」。仅填入 API 地址无法直接运行。
              </p>
              <div style={styles.actions}>
                <button style={styles.miniBtn} onClick={() => void loadLocalAdvice()} disabled={localLoading}>
                  {localLoading ? '检测中...' : '重新检测本机配置'}
                </button>
              </div>

              {localLoading && <p style={styles.tip}>正在检测硬件与本地推理服务（Ollama / LM Studio）...</p>}
              {localErr && <p style={styles.err}>{localErr}</p>}

              {localAdvice && (
                <div>
                  <div style={styles.localSummaryBox}>
                    <div style={styles.switchTitle}>{localAdvice.tierLabel}</div>
                    <div style={styles.switchDesc}>{localAdvice.summary}</div>
                    <div style={styles.localHwGrid}>
                      <div style={styles.localHwItem}>
                        <div style={styles.label}>CPU</div>
                        <div style={styles.localHwValue}>{localAdvice.hardware.cpuModel}（{localAdvice.hardware.cpuCores} 核）</div>
                      </div>
                      <div style={styles.localHwItem}>
                        <div style={styles.label}>内存</div>
                        <div style={styles.localHwValue}>{localAdvice.hardware.totalMemGB}GB 总 / {localAdvice.hardware.freeMemGB}GB 空闲</div>
                      </div>
                      <div style={styles.localHwItem}>
                        <div style={styles.label}>显卡</div>
                        <div style={styles.localHwValue}>
                          {localAdvice.hardware.gpuName}
                          {localAdvice.hardware.vramGB != null ? `（约 ${localAdvice.hardware.vramGB}GB）` : ''}
                          {localAdvice.hardware.hasNvidia ? ' · NVIDIA' : ''}
                        </div>
                      </div>
                      <div style={styles.localHwItem}>
                        <div style={styles.label}>本地服务</div>
                        <div style={styles.localHwValue}>
                          Ollama: {localAdvice.runtime.ollama.running ? `运行中（${localAdvice.runtime.ollama.models.length} 个模型）` : '未检测到'}
                          {' · '}
                          LM Studio: {localAdvice.runtime.lmStudio.running ? '运行中' : '未检测到'}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div style={styles.providerList}>
                    {(localAdvice.runtime.apps || []).map((app) => (
                      <div key={app.id} style={{
                        ...styles.providerCard,
                        ...(app.recommended ? styles.localRecCard : {})
                      }}>
                        <div style={styles.providerHeader}>
                          <span style={styles.providerBadge}>{app.recommended ? '优先' : '备选'}</span>
                          <div style={{ flex: 1 }}>
                            <div style={styles.switchTitle}>{app.name}</div>
                            <div style={styles.switchDesc}>
                              {app.running ? '已检测到运行中' : '未安装/未启动'} · 默认地址 {app.baseUrl}
                            </div>
                          </div>
                        </div>
                        <p style={styles.tip}>{app.description}</p>
                        <div style={styles.localPresetMeta}>
                          <div style={styles.switchTitle}>运行环境</div>
                          {app.envRequirements.map((item) => (
                            <div key={`${app.id}_env_${item}`}>{item}</div>
                          ))}
                        </div>
                        <div style={{ ...styles.localPresetMeta, marginTop: 8 }}>
                          <div style={styles.switchTitle}>安装步骤</div>
                          {app.installSteps.map((step, idx) => (
                            <div key={`${app.id}_step_${idx}`}>{idx + 1}. {step}</div>
                          ))}
                        </div>
                        <div style={styles.actions}>
                          <button style={styles.miniPrimaryBtn} onClick={() => void openExternal(app.downloadUrl)}>
                            下载客户端
                          </button>
                          <button style={styles.miniBtn} onClick={() => void openExternal(app.docsUrl)}>
                            打开官网
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div style={styles.providerList}>
                    {localAdvice.recommendations.map((rec) => (
                      <div key={rec.id} style={{
                        ...styles.providerCard,
                        ...(rec.recommended ? styles.localRecCard : {})
                      }}>
                        <div style={styles.providerHeader}>
                          <span style={styles.providerBadge}>{rec.recommended ? '推荐' : '可选'}</span>
                          <div style={{ flex: 1 }}>
                            <div style={styles.switchTitle}>{rec.name}</div>
                            <div style={styles.switchDesc}>
                              {rec.model} · {rec.sizeHint} · 建议内存 ≥ {rec.minRamGB}GB
                              {rec.runtime ? ` · ${rec.runtime === 'ollama' ? 'Ollama' : 'LM Studio'}` : ''}
                            </div>
                          </div>
                        </div>
                        <p style={styles.tip}>{rec.reason}</p>
                        <div style={styles.localPresetMeta}>
                          <div>地址：{rec.providerPreset.baseUrl}</div>
                          <div>Key：{rec.providerPreset.apiKey}</div>
                          {rec.downloadCommand && <div>下载命令：{rec.downloadCommand}</div>}
                          {rec.modelPageUrl && <div>模型页：{rec.modelPageUrl}</div>}
                        </div>
                        <div style={styles.actions}>
                          {rec.modelPageUrl && (
                            <button style={styles.miniBtn} onClick={() => void openExternal(rec.modelPageUrl)}>
                              打开模型下载页
                            </button>
                          )}
                          {rec.downloadCommand && (
                            <button style={styles.miniBtn} onClick={() => void copyText(rec.downloadCommand || '', '下载命令')}>
                              复制下载命令
                            </button>
                          )}
                          <button
                            style={styles.miniBtn}
                            disabled={!!applyingId || !rec.providerPreset.model}
                            onClick={() => handleApplyLocalPreset(rec, false)}
                          >
                            {applyingId === rec.id ? '填入中...' : rec.providerPreset.model ? '一键填入' : '下载并加载后填入'}
                          </button>
                          <button
                            style={styles.miniPrimaryBtn}
                            disabled={!!applyingId || !rec.providerPreset.model}
                            onClick={() => handleApplyLocalPreset(rec, true)}
                          >
                            设为主 API
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {(localAdvice.setupGuide?.length || 0) > 0 && (
                    <div style={styles.localTipsBox}>
                      <div style={styles.switchTitle}>首次安装流程</div>
                      <ul style={styles.localTipsList}>
                        {localAdvice.setupGuide?.map((tip, idx) => (
                          <li key={`setup_${idx}_${tip.slice(0, 12)}`} style={styles.localTipItem}>{tip}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {localAdvice.tips?.length > 0 && (
                    <div style={styles.localTipsBox}>
                      <div style={styles.switchTitle}>使用建议</div>
                      <ul style={styles.localTipsList}>
                        {localAdvice.tips.map((tip, idx) => (
                          <li key={`${idx}_${tip.slice(0, 12)}`} style={styles.localTipItem}>{tip}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

{tab === 'about' && (
            <div>
              <div style={styles.aboutCard}>
                <div style={styles.aboutTitleRow}>
                  <div>
                    <div style={styles.aboutAppName}>口播智剪</div>
                    <div style={styles.aboutSub}>KBCut · 千川投流口播重组工具</div>
                  </div>
                  <span style={styles.aboutVersion}>v{__APP_VERSION__}</span>
                </div>
                <div style={styles.aboutMeta}>
                  <div>平台：Windows 10/11 x64</div>
                  <div>协议：MIT</div>
                  <div>作者：CGLY</div>
                </div>
              </div>

              <div style={styles.aboutLinks}>
                <button style={styles.miniPrimaryBtn} onClick={() => void openExternal('https://github.com/cglyvip/kbcut')}>GitHub 仓库</button>
                <button style={styles.miniPrimaryBtn} onClick={() => void openExternal('https://github.com/cglyvip/kbcut/blob/main/docs/GETTING-STARTED.md')}>从零开始指南</button>
                <button style={styles.miniBtn} onClick={() => void openExternal('https://github.com/cglyvip/kbcut/blob/main/docs/ASR-GUIDE.md')}>语音识别教程</button>
                <button style={styles.miniBtn} onClick={() => void openExternal('https://github.com/cglyvip/kbcut/releases')}>Release 下载</button>
              </div>

              <div style={styles.aboutThanks}>
                <div style={styles.switchTitle}>致谢</div>
                <div style={styles.aboutThanksText}>
                  感谢 <a style={styles.aboutLink} onClick={() => void openExternal('https://xiaoxiaobai.me/')}>GGgrok</a>（L站大佬）提供的免费大模型 API，本软件由 AI 辅助编程完成。
                </div>

              </div>

            </div>
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
  tabs: { display: 'flex', gap: 8, padding: '12px 20px 0', flexWrap: 'wrap' as const },
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
  rpmBox: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: 12, marginBottom: 10, background: '#f7fbff', border: '1px solid #d6e4ff', borderRadius: 8
  },
  rpmSelect: {
    minWidth: 130, padding: '7px 9px', border: '1px solid #91caff', borderRadius: 6,
    background: '#fff', color: '#262626', fontSize: 13, outline: 'none'
  },
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
  miniPrimaryBtn: {
    fontSize: 12, color: '#fff', background: '#1677ff', border: '1px solid #1677ff',
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
  localSummaryBox: {
    marginTop: 8, padding: 12, background: '#f7fbff', border: '1px solid #d6e4ff',
    borderRadius: 8
  },
  localHwGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10
  },
  localHwItem: {
    background: '#fff', border: '1px solid #eef2f7', borderRadius: 6, padding: 8
  },
  localHwValue: { fontSize: 12, color: '#262626', marginTop: 4, lineHeight: 1.5 },
  localRecCard: { border: '1px solid #91caff', background: '#f0f7ff' },
  localPresetMeta: { fontSize: 12, color: '#595959', lineHeight: 1.6, marginBottom: 4 },
  localTipsBox: {
    marginTop: 12, padding: 12, background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 8
  },
  localTipsList: { margin: '8px 0 0', paddingLeft: 18 },
  localTipItem: { fontSize: 12, color: '#595959', marginBottom: 6, lineHeight: 1.5 },
  guideHero: {
    padding: 14, background: 'linear-gradient(135deg, #f0f7ff 0%, #f6ffed 100%)',
    border: '1px solid #b7d8ff', borderRadius: 10
  },
  guideCompareGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 },
  guideCompareItem: {
    display: 'flex', flexDirection: 'column', gap: 4, padding: 10,
    background: '#fff', border: '1px solid #e8edf3', borderRadius: 8,
    fontSize: 12, color: '#595959', lineHeight: 1.5
  },
  guideSection: { marginTop: 12, padding: 14, border: '1px solid #f0f0f0', borderRadius: 10, background: '#fcfcfc' },
  guideTitle: { fontSize: 15, fontWeight: 600, color: '#1f1f1f' },
  guideList: { margin: '10px 0 0', paddingLeft: 22 },
  guideItem: { fontSize: 12, color: '#595959', marginBottom: 8, lineHeight: 1.7 },
  inlineCode: { padding: '1px 5px', borderRadius: 4, background: '#f0f0f0', color: '#262626', wordBreak: 'break-all' as const },
  modelStatus: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
    marginTop: 12, padding: 10, border: '1px solid #ffd591', background: '#fff7e6', borderRadius: 8
  },
  modelStatusOk: { border: '1px solid #b7eb8f', background: '#f6ffed' },
  pathBox: {
    marginTop: 8, padding: 9, background: '#1f2937', color: '#e5e7eb', borderRadius: 6,
    fontSize: 11, fontFamily: 'Consolas, monospace', wordBreak: 'break-all' as const
  },
  guideWarning: {
    marginTop: 10, padding: 10, background: '#fffbe6', border: '1px solid #ffe58f',
    borderRadius: 8, color: '#7c5b00', fontSize: 12, lineHeight: 1.6
  },
  errorGrid: {
    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 10
  },
  aboutCard: {
    padding: 14, background: 'linear-gradient(135deg, #f7fbff 0%, #eef5ff 100%)',
    border: '1px solid #d6e4ff', borderRadius: 10
  },
  aboutTitleRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12
  },
  aboutAppName: { fontSize: 18, fontWeight: 700, color: '#1a1a2e' },
  aboutSub: { fontSize: 12, color: '#8c8c8c', marginTop: 4 },
  aboutVersion: {
    fontSize: 12, color: '#1677ff', background: '#e6f4ff', border: '1px solid #91caff',
    borderRadius: 999, padding: '4px 10px', whiteSpace: 'nowrap' as const
  },
  aboutMeta: { marginTop: 12, fontSize: 12, color: '#595959', lineHeight: 1.8 },
  aboutPlaceholder: {
    marginTop: 12, padding: 14, background: '#fafafa', border: '1px dashed #d9d9d9', borderRadius: 10
  },
  aboutLinks: {
    display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', justifyContent: 'flex-start'
  },
  aboutThanks: {
    marginTop: 14, padding: 14, background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 10
  },
  aboutThanksText: { fontSize: 12, color: '#7c5b00', lineHeight: 1.7, marginTop: 6 },
  aboutLink: { color: '#1677ff', textDecoration: 'underline', cursor: 'pointer' },
  aboutList: { margin: '8px 0 0', paddingLeft: 18 },
  aboutListItem: { fontSize: 12, color: '#8c8c8c', marginBottom: 6, lineHeight: 1.5 },
  sectionDivider: { marginTop: 16, padding: 16, background: '#fafafa', border: '1px solid #f0f0f0', borderRadius: 10 },
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
