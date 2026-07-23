import { useCallback } from 'react'
import { useAsrStore, buildEditableWords } from '../../stores/useAsrStore'
import { useVideoStore } from '../../stores/useVideoStore'
import { useBriefStore } from '../../stores/useBriefStore'
import { savePermanentSettingsNow } from '../../stores/permanentSettings'

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

export default function AsrPanel() {
  const videoInfo = useVideoStore((s) => s.videoInfo)
  const {
    settings, segments, loading, error,
    updateSettings, setSegments, setLoading, setError, clear,
    toggleWordExclude, excludeAllInSegment, includeAllInSegment
  } = useAsrStore()

  const handleRecognize = useCallback(async () => {
    if (!videoInfo) return
    clear()
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.asrRecognize({
        videoPath: videoInfo.filePath,
        mode: settings.mode,
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model
      })
      setSegments(result.segments.map((seg) => ({
        start: seg.start,
        end: seg.end,
        text: seg.text,
        words: buildEditableWords(seg.start, seg.end, seg.text, seg.words)
      })))
      if (settings.mode === 'online') {
        useBriefStore.getState().recordUsage({
          taskId: `single:${videoInfo.filePath}`,
          fileName: videoInfo.fileName,
          inputTokens: 0,
          outputTokens: 0,
          asrMinutes: Math.max(0, videoInfo.duration) / 60
        })
      }
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setLoading(false)
    }
  }, [videoInfo, settings, setSegments, setLoading, setError, clear])

  const totalDuration = segments.reduce((sum, s) => sum + (s.end - s.start), 0)
  const includedWordCount = segments.reduce(
    (sum, s) => sum + s.words.filter((w) => !w.excluded).length,
    0
  )

  return (
    <div style={styles.container}>
      <div style={styles.settingsCard}>
        <h3 style={styles.cardTitle}>语音识别</h3>

        <div style={styles.modeRow}>
          <button style={settings.mode === 'online' ? styles.modeActive : styles.modeBtn}
            onClick={() => updateSettings({ mode: 'online' })}>在线识别</button>
          <button style={settings.mode === 'local' ? styles.modeActive : styles.modeBtn}
            onClick={() => updateSettings({ mode: 'local' })}>本地识别</button>
        </div>

        {settings.mode === 'online' && (
          <div style={styles.formGroup}>
            <div style={styles.field}>
              <label style={styles.label}>API 地址</label>
              <input style={styles.input} value={settings.baseUrl}
                onChange={(e) => updateSettings({ baseUrl: e.target.value })}
                onBlur={() => { void savePermanentSettingsNow({}) }} placeholder="https://api.openai.com" />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>API Key</label>
              <input style={styles.input} type="password" value={settings.apiKey}
                onChange={(e) => updateSettings({ apiKey: e.target.value })}
                onBlur={() => { void savePermanentSettingsNow({}) }} placeholder="sk-..." />
            </div>
            <div style={styles.field}>
              <label style={styles.label}>模型</label>
              <input style={styles.input} value={settings.model}
                onChange={(e) => updateSettings({ model: e.target.value })}
                onBlur={() => { void savePermanentSettingsNow({}) }} placeholder="whisper-1" />
            </div>
          </div>
        )}

        {settings.mode === 'local' && (
          <p style={styles.hint}>本地 Whisper 模型，首次会下载模型，无需 API Key。</p>
        )}

        <button
          style={{ ...styles.startBtn, ...(loading || !videoInfo ? styles.btnDisabled : {}) }}
          onClick={handleRecognize}
          disabled={loading || !videoInfo}
        >{loading ? '识别中...' : '开始识别'}</button>

        {!videoInfo && <p style={styles.warn}>请先导入视频</p>}
        {error && <p style={styles.error}>{error}</p>}

        {segments.length > 0 && (
          <div style={styles.stats}>
            <span>共 {segments.length} 句 / {includedWordCount} 词 / {totalDuration.toFixed(1)}s</span>
            <button style={styles.clearBtn} onClick={clear}>清除</button>
          </div>
        )}
        {segments.length > 0 && (
          <p style={styles.hint}>点击词语可排除废话，再交给大模型重组爆款。</p>
        )}
      </div>

      {segments.length > 0 && (
        <div style={styles.resultCard}>
          <h3 style={styles.cardTitle}>识别结果（可点选排除）</h3>
          <div style={styles.segmentList}>
            {segments.map((seg, i) => (
              <div key={i} style={styles.segItem}>
                <div style={styles.segHeader}>
                  <span style={styles.segTime}>{formatTime(seg.start)}</span>
                  <span style={styles.segDur}>{(seg.end - seg.start).toFixed(1)}s</span>
                  <button style={styles.miniBtn} onClick={() => excludeAllInSegment(i)}>整句排除</button>
                  <button style={styles.miniBtn} onClick={() => includeAllInSegment(i)}>整句恢复</button>
                </div>
                <div style={styles.wordFlow}>
                  {seg.words.map((w, wi) => (
                    <span
                      key={wi}
                      style={{ ...styles.word, ...(w.excluded ? styles.wordExcluded : {}) }}
                      onClick={() => toggleWordExclude(i, wi)}
                      title={w.excluded ? '点击恢复' : '点击排除'}
                    >{w.text}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { padding: '0 40px 24px', display: 'flex', gap: 24, alignItems: 'flex-start' },
  settingsCard: {
    width: 320, background: '#fff', borderRadius: 12, padding: 24,
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)', flexShrink: 0
  },
  resultCard: {
    flex: 1, background: '#fff', borderRadius: 12, padding: 24,
    boxShadow: '0 2px 12px rgba(0,0,0,0.08)', maxHeight: 480,
    overflow: 'hidden', display: 'flex', flexDirection: 'column'
  },
  cardTitle: { fontSize: 16, fontWeight: 600, color: '#262626', marginBottom: 16, marginTop: 0 },
  modeRow: { display: 'flex', gap: 8, marginBottom: 16 },
  modeBtn: {
    flex: 1, padding: '8px 0', border: '1px solid #d9d9d9', borderRadius: 6,
    background: '#fff', color: '#595959', cursor: 'pointer', fontSize: 14
  },
  modeActive: {
    flex: 1, padding: '8px 0', border: '1px solid #1677ff', borderRadius: 6,
    background: '#e6f4ff', color: '#1677ff', cursor: 'pointer', fontSize: 14, fontWeight: 500
  },
  formGroup: { display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 },
  field: { display: 'flex', flexDirection: 'column', gap: 4 },
  label: { fontSize: 13, color: '#8c8c8c' },
  input: { padding: '8px 12px', border: '1px solid #d9d9d9', borderRadius: 6, fontSize: 14, outline: 'none' },
  hint: { fontSize: 13, color: '#8c8c8c', marginBottom: 16, lineHeight: 1.6 },
  startBtn: {
    width: '100%', padding: '10px 0', background: '#1677ff', color: '#fff',
    border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 15, fontWeight: 500
  },
  btnDisabled: { background: '#d9d9d9', cursor: 'not-allowed' },
  warn: { fontSize: 13, color: '#faad14', marginTop: 8 },
  error: { fontSize: 13, color: '#ff4d4f', marginTop: 8, wordBreak: 'break-all' as const },
  stats: {
    marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontSize: 14, color: '#595959', padding: '12px 0', borderTop: '1px solid #f0f0f0'
  },
  clearBtn: {
    padding: '4px 12px', border: '1px solid #d9d9d9', borderRadius: 4,
    background: '#fff', color: '#595959', cursor: 'pointer', fontSize: 13
  },
  segmentList: { flex: 1, overflowY: 'auto' as const },
  segItem: {
    padding: '10px 0', borderBottom: '1px solid #f5f5f5'
  },
  segHeader: { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 },
  segTime: { fontSize: 12, color: '#8c8c8c', fontFamily: 'monospace', flexShrink: 0 },
  segDur: { fontSize: 12, color: '#8c8c8c', fontFamily: 'monospace', marginRight: 'auto' },
  miniBtn: {
    fontSize: 11, color: '#595959', background: '#fff', border: '1px solid #d9d9d9',
    borderRadius: 3, padding: '1px 8px', cursor: 'pointer'
  },
  wordFlow: { display: 'flex', flexWrap: 'wrap' as const, gap: 2, lineHeight: 2 },
  word: {
    padding: '2px 4px', borderRadius: 3, fontSize: 14, color: '#262626',
    cursor: 'pointer', transition: 'all 0.15s'
  },
  wordExcluded: { textDecoration: 'line-through', color: '#bfbfbf', background: '#fff1f0' }
}
