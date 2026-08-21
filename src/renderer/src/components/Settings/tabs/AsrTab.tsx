import { useCallback } from "react";
import { styles } from "../styles";
import { useAsrStore } from "../../../stores/useAsrStore";
import { savePermanentSettingsNow } from "../../../stores/permanentSettings";

export default function AsrTab() {
  const { settings, updateSettings } = useAsrStore();

  const handleSelectModelDir = useCallback(async () => {
    const dir = await window.api.selectModelDir();
    if (dir) {
      updateSettings({ modelCacheDir: dir });
      await savePermanentSettingsNow({});
    }
  }, [updateSettings]);

  const handleResetModelDir = useCallback(async () => {
    updateSettings({ modelCacheDir: "" });
    await savePermanentSettingsNow({});
  }, [updateSettings]);

  return (
    <div>
      <p style={styles.tip}>
        在线 Whisper 与本地识别的默认配置，导入视频后可直接使用。
      </p>
      <div style={styles.modeRow}>
        <button
          style={
            settings.mode === "online" ? styles.modeActive : styles.modeBtn
          }
          onClick={() => updateSettings({ mode: "online" })}
        >
          在线识别
        </button>
        <button
          style={settings.mode === "local" ? styles.modeActive : styles.modeBtn}
          onClick={() => updateSettings({ mode: "local" })}
        >
          本地识别
        </button>
      </div>
      {settings.mode === "online" ? (
        <div style={styles.formGroup}>
          <div style={styles.field}>
            <label style={styles.label}>API 地址</label>
            <input
              style={styles.input}
              value={settings.baseUrl}
              onChange={(e) => updateSettings({ baseUrl: e.target.value })}
              placeholder="https://api.openai.com"
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>API Key</label>
            <input
              style={styles.input}
              type="password"
              value={settings.apiKey}
              onChange={(e) => updateSettings({ apiKey: e.target.value })}
              placeholder="sk-..."
            />
          </div>
          <div style={styles.field}>
            <label style={styles.label}>模型</label>
            <input
              style={styles.input}
              value={settings.model}
              onChange={(e) => updateSettings({ model: e.target.value })}
              placeholder="whisper-1"
            />
          </div>
        </div>
      ) : (
        <div style={styles.formGroup}>
          <p style={styles.tip}>
            本地 Whisper 模型，首次识别会自动下载，无需 API Key。
          </p>
          <div style={styles.field}>
            <label style={styles.label}>下载源</label>
            <div style={styles.modeRow}>
              <button
                style={
                  settings.remoteHost === "https://hf-mirror.com"
                    ? styles.modeActive
                    : styles.modeBtn
                }
                onClick={() =>
                  updateSettings({ remoteHost: "https://hf-mirror.com" })
                }
              >
                国内镜像 (hf-mirror.com)
              </button>
              <button
                style={
                  settings.remoteHost === "https://huggingface.co"
                    ? styles.modeActive
                    : styles.modeBtn
                }
                onClick={() =>
                  updateSettings({ remoteHost: "https://huggingface.co" })
                }
              >
                官方源 (huggingface.co)
              </button>
            </div>
            <p style={styles.tip}>
              优先从选定源下载模型，失败后自动尝试另一个源。
            </p>
          </div>
          <div style={styles.field}>
            <label style={styles.label}>模型目录</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                style={{ ...styles.input, flex: 1 }}
                value={settings.modelCacheDir}
                readOnly
                placeholder="默认：安装目录/models/whisper-small"
              />
              <button style={styles.miniBtn} onClick={handleSelectModelDir}>
                选择
              </button>
              {settings.modelCacheDir && (
                <button style={styles.miniBtn} onClick={handleResetModelDir}>
                  重置
                </button>
              )}
            </div>
            <p style={styles.tip}>
              留空使用默认路径（安装目录下）。自定义后模型将存放在指定目录。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
