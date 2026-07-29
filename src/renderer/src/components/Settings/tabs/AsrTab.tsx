import { styles } from '../styles'
import { useAsrStore } from '../../../stores/useAsrStore'

export default function AsrTab() {
  const { settings, updateSettings } = useAsrStore()

  return (
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
  )
}
