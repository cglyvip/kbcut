import { styles } from "../styles";
import { useLlmStore } from "../../../stores/useLlmStore";

export default function ExportTab() {
  const {
    minDuration,
    maxDuration,
    variantCount,
    topFluencyOnly,
    enableSubtitle,
    exportResolution,
    setMinDuration,
    setMaxDuration,
    setVariantCount,
    setTopFluencyOnly,
    setEnableSubtitle,
    setExportResolution,
  } = useLlmStore();

  return (
    <div>
      <p style={styles.tip}>默认生成与导出偏好，进入后续步骤会自动带上。</p>
      <div style={styles.row}>
        <div style={styles.field}>
          <label style={styles.label}>最小秒</label>
          <input
            style={styles.input}
            type="number"
            min={1}
            value={minDuration}
            onChange={(e) => setMinDuration(Number(e.target.value) || 1)}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>最大秒</label>
          <input
            style={styles.input}
            type="number"
            min={1}
            value={maxDuration}
            onChange={(e) => setMaxDuration(Number(e.target.value) || 1)}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>变体数</label>
          <input
            style={styles.input}
            type="number"
            min={1}
            max={20}
            value={variantCount}
            onChange={(e) => setVariantCount(Number(e.target.value) || 1)}
          />
        </div>
      </div>

      <div
        style={styles.optionBox}
        onClick={() => setTopFluencyOnly(!topFluencyOnly)}
      >
        <div style={styles.switchRow}>
          <div
            style={{
              ...styles.switchTrack,
              ...(topFluencyOnly ? styles.switchTrackOn : {}),
            }}
          >
            <div
              style={{
                ...styles.switchThumb,
                ...(topFluencyOnly ? styles.switchThumbOn : {}),
              }}
            />
          </div>
          <div>
            <div style={styles.switchTitle}>仅保留通顺度最高 3 条</div>
            <div style={styles.switchDesc}>
              {topFluencyOnly
                ? "生成后只保留最通顺的 Top3"
                : "按设定变体数生成"}
            </div>
          </div>
        </div>
      </div>

      <div
        style={{ ...styles.optionBox, marginTop: 10 }}
        onClick={() => setEnableSubtitle(!enableSubtitle)}
      >
        <div style={styles.switchRow}>
          <div
            style={{
              ...styles.switchTrack,
              ...(enableSubtitle ? styles.switchTrackOn : {}),
            }}
          >
            <div
              style={{
                ...styles.switchThumb,
                ...(enableSubtitle ? styles.switchThumbOn : {}),
              }}
            />
          </div>
          <div>
            <div style={styles.switchTitle}>默认烧录字幕</div>
            <div style={styles.switchDesc}>
              {enableSubtitle ? "导出时默认嵌入字幕" : "导出时默认不带字幕"}
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14 }}>
        <div style={styles.switchTitle}>导出分辨率</div>
        <div style={styles.switchDesc}>只调整清晰度，视频比例不变，不拉伸</div>
        <div style={styles.modeRow}>
          {(
            [
              { id: "720", label: "720P" },
              { id: "1080", label: "1080P" },
              { id: "1440", label: "2K" },
              { id: "source", label: "原画" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.id}
              style={
                exportResolution === opt.id ? styles.modeActive : styles.modeBtn
              }
              onClick={() => setExportResolution(opt.id)}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p style={styles.tip}>
          当前：
          {exportResolution === "source"
            ? "保持原始分辨率"
            : exportResolution === "720"
              ? "最长边适配 720P"
              : exportResolution === "1440"
                ? "最长边适配 2K/1440P"
                : "最长边适配 1080P"}
        </p>
      </div>
    </div>
  );
}
