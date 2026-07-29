import { styles } from "../styles";
import { useLlmStore } from "../../../stores/useLlmStore";

interface LlmTabProps {
  testingId: string | null;
  testingAll: boolean;
  onTestProvider: (
    provider: ReturnType<typeof useLlmStore.getState>["providers"][number],
  ) => void;
  onTestAll: () => void;
  setMsg: (msg: string | null) => void;
  setErr: (err: string | null) => void;
}

export default function LlmTab({
  testingId,
  testingAll,
  onTestProvider,
  onTestAll,
}: LlmTabProps) {
  const {
    providers,
    updateProvider,
    addProvider,
    removeProvider,
    moveProviderTop,
    rpmLimit,
    setRpmLimit,
  } = useLlmStore();

  return (
    <div>
      <p style={styles.tip}>
        按顺序尝试：第1个失败自动切第2个，成功则置顶。全部失败会提醒更换 API。
      </p>
      <div style={styles.rpmBox}>
        <div>
          <div style={styles.switchTitle}>API 请求限速</div>
          <div style={styles.switchDesc}>
            数值越低越稳定，数值越高处理越快。第三方中转 API 推荐 5 RPM。
          </div>
        </div>
        <select
          style={styles.rpmSelect}
          value={rpmLimit}
          onChange={(e) => setRpmLimit(Number(e.target.value))}
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((rpm) => (
            <option key={rpm} value={rpm}>
              {rpm} RPM
              {rpm === 1
                ? "（最低）"
                : rpm === 5
                  ? "（最稳）"
                  : rpm === 8
                    ? "（均衡）"
                    : rpm === 10
                      ? "（最快）"
                      : ""}
            </option>
          ))}
        </select>
      </div>
      <p style={styles.tip}>
        当前约每 {Math.ceil(60 / rpmLimit)} 秒最多发起 1 次请求，并保留 2 万 TPM
        估算限制；遇到 429 会临时降速、冷却并自动重试。
      </p>
      <div style={styles.providerList}>
        {providers.map((p, idx) => (
          <div key={p.id} style={styles.providerCard}>
            <div style={styles.providerHeader}>
              <span style={styles.providerBadge}>
                {idx === 0 ? "主" : `备${idx}`}
              </span>
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
                  onChange={(e) =>
                    updateProvider(p.id, { enabled: e.target.checked })
                  }
                />{" "}
                启用
              </label>
            </div>
            <div style={styles.formGroup}>
              <div style={styles.field}>
                <label style={styles.label}>API 地址</label>
                <input
                  style={styles.input}
                  value={p.baseUrl}
                  onChange={(e) =>
                    updateProvider(p.id, { baseUrl: e.target.value })
                  }
                  placeholder="https://api.openai.com"
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>API Key</label>
                <input
                  style={styles.input}
                  type="password"
                  value={p.apiKey}
                  onChange={(e) =>
                    updateProvider(p.id, { apiKey: e.target.value })
                  }
                  placeholder="sk-..."
                />
              </div>
              <div style={styles.field}>
                <label style={styles.label}>模型</label>
                <input
                  style={styles.input}
                  value={p.model}
                  onChange={(e) =>
                    updateProvider(p.id, { model: e.target.value })
                  }
                  placeholder="gpt-4o-mini"
                />
              </div>
            </div>
            <div style={styles.actions}>
              <button
                style={styles.miniBtn}
                onClick={() => onTestProvider(p)}
                disabled={!!testingId || testingAll}
              >
                {testingId === p.id ? "测试中..." : "测试"}
              </button>
              {idx > 0 && (
                <button
                  style={styles.miniBtn}
                  onClick={() => moveProviderTop(p.id)}
                >
                  置顶
                </button>
              )}
              {providers.length > 1 && (
                <button
                  style={styles.miniDangerBtn}
                  onClick={() => removeProvider(p.id)}
                >
                  删除
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <p style={styles.tip}>
        API 地址支持服务根地址、带版本路径的地址，也支持直接粘贴完整{" "}
        <code style={styles.inlineCode}>/chat/completions</code> 接口。
      </p>
      <div style={styles.actions}>
        <button style={styles.miniBtn} onClick={addProvider}>
          + 添加候补 API
        </button>
        <button
          style={styles.miniBtn}
          onClick={onTestAll}
          disabled={testingAll || !!testingId}
        >
          {testingAll ? "批量测试中..." : "测试全部"}
        </button>
      </div>
    </div>
  );
}
