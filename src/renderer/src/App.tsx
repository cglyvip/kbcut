import { useEffect, useState } from 'react'
import ProductBriefPanel from './components/ProductBrief/ProductBriefPanel'
import { useBriefStore } from './stores/useBriefStore'
import ImportArea from './components/VideoImport/ImportArea'
import AsrPanel from './components/AsrPanel/AsrPanel'
import ExportPanel from './components/ExportPanel/ExportPanel'
import BatchPanel from './components/BatchPanel/BatchPanel'
import SettingsModal from './components/Settings/SettingsModal'
import { useLlmStore } from './stores/useLlmStore'
import { useAsrStore } from './stores/useAsrStore'
import { useBatchStore } from './stores/useBatchStore'
import { useVideoStore } from './stores/useVideoStore'
import { savePermanentSettingsNow } from './stores/permanentSettings'

const STEPS = [
  { num: 1, label: '导入视频' },
  { num: 2, label: '语音识别' },
  { num: 3, label: 'AI重组爆款' },
  { num: 4, label: '微调导出' }
]

export default function App() {
  const videoInfo = useVideoStore((s) => s.videoInfo)
  const asrSegments = useAsrStore((s) => s.segments)
  const batchCount = useBatchStore((s) => s.tasks.length)
  const batchRunning = useBatchStore((s) => s.running)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [briefOpen, setBriefOpen] = useState(false)
  const [mode, setMode] = useState<'batch' | 'single'>('batch')
  const hydrateLlm = useLlmStore((s) => s.hydrateFromDisk)
  const hydrateAsr = useAsrStore((s) => s.hydrateFromDisk)
  const hydrateBatch = useBatchStore((s) => s.hydrateFromDisk)
  const hydrateBrief = useBriefStore((s) => s.hydrateBrief)

  useEffect(() => {
    void Promise.all([
      hydrateLlm(),
      hydrateAsr(),
      hydrateBatch(),
      hydrateBrief()
    ])
  }, [hydrateLlm, hydrateAsr, hydrateBatch, hydrateBrief])

  useEffect(() => {
    const flush = () => { void savePermanentSettingsNow({}) }
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') flush()
    }
    window.addEventListener('beforeunload', flush)
    window.addEventListener('blur', flush)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('blur', flush)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  const currentStep = !videoInfo ? 1 : asrSegments.length === 0 ? 2 : 3

  return (
    <div style={styles.app}>
      <style>{globalCss}</style>
      <header style={styles.header}>
        <div style={styles.headerLeft}>
          <h1 style={styles.title}>口播智剪</h1>
          <span style={styles.badge}>千川爆款</span>
          <div style={styles.modeSwitch}>
            <button
              style={mode === 'batch' ? styles.modeActive : styles.modeBtn}
              onClick={() => { if (!batchRunning) setMode('batch') }}
              disabled={batchRunning}
              title={batchRunning ? '批量队列运行中，暂不能切换模式' : ''}
            >全自动批量</button>
            <button
              style={mode === 'single' ? styles.modeActive : styles.modeBtn}
              onClick={() => { if (!batchRunning) setMode('single') }}
              disabled={batchRunning}
              title={batchRunning ? '批量队列运行中，暂不能切换模式' : ''}
            >单条精修</button>
          </div>
        </div>
        <div style={styles.headerRight}>
          {mode === 'single' && (
            <div style={styles.steps}>
              {STEPS.map((step) => (
                <div key={step.num} style={styles.stepItem}>
                  <div style={{
                    ...styles.stepCircle,
                    ...(step.num <= currentStep ? styles.stepCircleActive : {}),
                    ...(step.num < currentStep ? styles.stepCircleDone : {})
                  }}>
                    {step.num < currentStep ? '✓' : step.num}
                  </div>
                  <span style={{
                    ...styles.stepLabel,
                    ...(step.num <= currentStep ? styles.stepLabelActive : {})
                  }}>{step.label}</span>
                  {step.num < STEPS.length && <div style={{
                    ...styles.stepLine,
                    ...(step.num < currentStep ? styles.stepLineDone : {})
                  }} />}
                </div>
              ))}
            </div>
          )}
          {mode === 'batch' && (
            <span style={styles.batchHint}>队列任务 {batchCount} · 串行处理 · 模型失败暂停</span>
          )}
          <button style={styles.settingsBtn} onClick={() => setSettingsOpen(true)} title="设置">
            设置
          </button>
        </div>
      </header>
      <main style={styles.main}>
        <div style={styles.welcome}>
          <div style={styles.welcomeCard}>
            <div>
              <h2 style={styles.welcomeTitle}>
                {mode === 'batch' ? '全自动批量模式' : '单条精修模式'}
              </h2>
              <p style={styles.welcomeText}>
                {mode === 'batch'
                  ? '先在设置里配好 ASR / 大模型 API，再批量导入。系统会一条条自动：识别→AI重组→导出。'
                  : '适合单条精细调整：可手动删词、改顺序后再导出。'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexShrink: 0 }}>
              <button style={styles.welcomeBtn} onClick={() => setBriefOpen(true)}>爆款工作台</button>
              <button style={styles.welcomeBtn} onClick={() => setSettingsOpen(true)}>打开设置</button>
            </div>
          </div>
        </div>

        {mode === 'batch' ? (
          <BatchPanel />
        ) : (
          <>
            <ImportArea />
            {videoInfo && <AsrPanel />}
            {asrSegments.length > 0 && <ExportPanel />}
          </>
        )}
      </main>
      <ProductBriefPanel visible={briefOpen} onClose={() => setBriefOpen(false)} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  )
}

const globalCss = `
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; }
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #d9d9d9; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #bfbfbf; }
  @keyframes spin { to { transform: rotate(360deg); } }
`

const styles: Record<string, React.CSSProperties> = {
  app: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #f5f7fa 0%, #eff2f7 100%)',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Microsoft YaHei", sans-serif'
  },
  header: {
    background: '#fff',
    padding: '16px 32px',
    borderBottom: '1px solid #e8e8e8',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
    gap: 16
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10
  },
  headerRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 16
  },
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: '#1a1a2e',
    margin: 0,
    letterSpacing: -0.5
  },
  badge: {
    fontSize: 10,
    color: '#fff',
    background: 'linear-gradient(135deg, #667eea, #764ba2)',
    padding: '2px 8px',
    borderRadius: 10,
    fontWeight: 600,
    letterSpacing: 0.5
  },
  modeSwitch: {
    display: 'flex',
    gap: 6,
    marginLeft: 8
  },
  modeBtn: {
    border: '1px solid #d9d9d9',
    background: '#fff',
    color: '#595959',
    borderRadius: 16,
    padding: '4px 12px',
    cursor: 'pointer',
    fontSize: 12
  },
  modeActive: {
    border: '1px solid #1677ff',
    background: '#e6f4ff',
    color: '#1677ff',
    borderRadius: 16,
    padding: '4px 12px',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600
  },
  batchHint: {
    fontSize: 12,
    color: '#8c8c8c'
  },
  settingsBtn: {
    border: '1px solid #d9d9d9',
    background: '#fff',
    color: '#262626',
    borderRadius: 8,
    padding: '7px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500
  },
  steps: {
    display: 'flex',
    alignItems: 'center',
    gap: 0
  },
  stepItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 6
  },
  stepCircle: {
    width: 26,
    height: 26,
    borderRadius: 13,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 600,
    background: '#f0f0f0',
    color: '#bfbfbf',
    transition: 'all 0.3s'
  },
  stepCircleActive: {
    background: '#e6f4ff',
    color: '#1677ff',
    border: '2px solid #1677ff'
  },
  stepCircleDone: {
    background: '#52c41a',
    color: '#fff',
    border: '2px solid #52c41a'
  },
  stepLabel: {
    fontSize: 13,
    color: '#bfbfbf',
    transition: 'all 0.3s'
  },
  stepLabelActive: {
    color: '#262626',
    fontWeight: 500
  },
  stepLine: {
    width: 32,
    height: 2,
    background: '#f0f0f0',
    margin: '0 4px',
    borderRadius: 1,
    transition: 'all 0.3s'
  },
  stepLineDone: {
    background: '#52c41a'
  },
  main: {
    padding: '24px 0',
    maxWidth: 1400,
    margin: '0 auto'
  },
  welcome: {
    padding: '0 40px 16px'
  },
  welcomeCard: {
    background: '#fff',
    border: '1px solid #e8e8e8',
    borderRadius: 12,
    padding: '16px 20px',
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    boxShadow: '0 2px 10px rgba(0,0,0,0.04)'
  },
  welcomeTitle: {
    margin: 0,
    fontSize: 15,
    color: '#1a1a2e'
  },
  welcomeText: {
    margin: '4px 0 0',
    fontSize: 12,
    color: '#8c8c8c'
  },
  welcomeBtn: {
    marginLeft: 'auto',
    background: '#1677ff',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    padding: '8px 14px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 500,
    flexShrink: 0
  }
}
