import { styles } from '../styles'
import type { LocalModelAdviceView } from '../types'

interface LocalModelTabProps {
  localAdvice: LocalModelAdviceView | null
  localLoading: boolean
  localErr: string | null
  applyingId: string | null
  onReload: () => void
  onOpenExternal: (url?: string) => void
  onCopyText: (text: string, label: string) => void
  onApplyPreset: (rec: LocalModelAdviceView['recommendations'][number], asPrimary: boolean) => void
}

export default function LocalModelTab({
  localAdvice, localLoading, localErr, applyingId,
  onReload, onOpenExternal, onCopyText, onApplyPreset
}: LocalModelTabProps) {
  return (
    <div>
      <p style={styles.tip}>
        大多数用户本机没有本地模型。请先安装客户端并下载模型，再使用「一键填入」。仅填入 API 地址无法直接运行。
      </p>
      <div style={styles.actions}>
        <button style={styles.miniBtn} onClick={onReload} disabled={localLoading}>
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
                  <button style={styles.miniPrimaryBtn} onClick={() => onOpenExternal(app.downloadUrl)}>
                    下载客户端
                  </button>
                  <button style={styles.miniBtn} onClick={() => onOpenExternal(app.docsUrl)}>
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
                    <button style={styles.miniBtn} onClick={() => onOpenExternal(rec.modelPageUrl)}>
                      打开模型下载页
                    </button>
                  )}
                  {rec.downloadCommand && (
                    <button style={styles.miniBtn} onClick={() => onCopyText(rec.downloadCommand || '', '下载命令')}>
                      复制下载命令
                    </button>
                  )}
                  <button
                    style={styles.miniBtn}
                    disabled={!!applyingId || !rec.providerPreset.model}
                    onClick={() => onApplyPreset(rec, false)}
                  >
                    {applyingId === rec.id ? '填入中...' : rec.providerPreset.model ? '一键填入' : '下载并加载后填入'}
                  </button>
                  <button
                    style={styles.miniPrimaryBtn}
                    disabled={!!applyingId || !rec.providerPreset.model}
                    onClick={() => onApplyPreset(rec, true)}
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
  )
}
