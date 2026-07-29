import { useMemo, useState } from "react";
import {
  buildFeedbackInsights,
  GROWTH_TEMPLATES,
  summarizeModelTokenUsages,
  type HookStrategy,
  useBriefStore,
} from "../../stores/useBriefStore";

interface Props {
  visible: boolean;
  onClose: () => void;
}

const HOOK_OPTIONS: Array<{
  id: HookStrategy;
  label: string;
  description: string;
}> = [
  { id: "curiosity", label: "好奇悬念", description: "为什么、真相、结果先行" },
  { id: "pain", label: "痛点直击", description: "先说用户正在遭遇的问题" },
  { id: "benefit", label: "利益结果", description: "先讲能得到什么好处" },
  { id: "anti_common", label: "反常识", description: "推翻常见错误认知" },
  { id: "identity", label: "身份筛选", description: "明确点名目标人群" },
  { id: "price", label: "价格冲击", description: "价格、到手价和价值对比" },
  { id: "urgency", label: "紧迫稀缺", description: "限时、库存和行动窗口" },
];

type Tab = "brief" | "strategy" | "feedback" | "cost";

export default function ProductBriefPanel({ visible, onClose }: Props) {
  const {
    brief,
    feedback,
    usage,
    products,
    activeProductId,
    setBrief,
    applyTemplate,
    resetBrief,
    addFeedback,
    removeFeedback,
    createProduct,
    switchProduct,
    renameProduct,
    deleteProduct,
  } = useBriefStore();
  const [tab, setTab] = useState<Tab>("brief");
  const [feedbackForm, setFeedbackForm] = useState({
    videoName: "",
    hookType: "",
    threeSecondRate: 0,
    completionRate: 0,
    clickRate: 0,
    conversionRate: 0,
    spend: 0,
  });
  const [showProductMenu, setShowProductMenu] = useState(false);
  const [newProductName, setNewProductName] = useState("");
  const [showNewProduct, setShowNewProduct] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const totals = useMemo(() => {
    const inputTokens = usage.reduce((sum, item) => sum + item.inputTokens, 0);
    const outputTokens = usage.reduce(
      (sum, item) => sum + item.outputTokens,
      0,
    );
    const asrMinutes = usage.reduce((sum, item) => sum + item.asrMinutes, 0);
    const estimatedCost =
      (inputTokens / 1_000_000) * brief.llmInputPricePerMillion +
      (outputTokens / 1_000_000) * brief.llmOutputPricePerMillion +
      asrMinutes * brief.asrPricePerMinute;
    return { inputTokens, outputTokens, asrMinutes, estimatedCost };
  }, [
    usage,
    brief.llmInputPricePerMillion,
    brief.llmOutputPricePerMillion,
    brief.asrPricePerMinute,
  ]);
  const modelTotals = useMemo(() => summarizeModelTokenUsages(usage), [usage]);
  const feedbackInsights = useMemo(
    () => buildFeedbackInsights(feedback),
    [feedback],
  );

  if (!visible) return null;

  const toggleHook = (id: HookStrategy) => {
    const current = brief.hookStrategies || [];
    const hookStrategies = current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id];
    setBrief({
      hookStrategies: hookStrategies.length > 0 ? hookStrategies : [id],
    });
  };

  const submitFeedback = () => {
    if (!feedbackForm.videoName.trim()) return;
    addFeedback(feedbackForm);
    setFeedbackForm({
      videoName: "",
      hookType: "",
      threeSecondRate: 0,
      completionRate: 0,
      clickRate: 0,
      conversionRate: 0,
      spend: 0,
    });
  };

  const handleCreateProduct = () => {
    if (!newProductName.trim()) return;
    createProduct(newProductName);
    setNewProductName("");
    setShowNewProduct(false);
    setShowProductMenu(false);
  };

  const handleStartRename = (id: string, name: string) => {
    setEditingProductId(id);
    setEditingName(name);
  };

  const handleConfirmRename = () => {
    if (editingProductId && editingName.trim()) {
      renameProduct(editingProductId, editingName);
    }
    setEditingProductId(null);
    setEditingName("");
  };

  const handleDeleteProduct = (id: string) => {
    if (products.length <= 1) return;
    deleteProduct(id);
    setShowProductMenu(false);
  };

  const activeProduct = products.find((p) => p.id === activeProductId);

  return (
    <div style={styles.mask} onClick={onClose}>
      <div style={styles.panel} onClick={(event) => event.stopPropagation()}>
        <div style={styles.header}>
          <div>
            <div style={styles.title}>爆款工作台</div>
            <div style={styles.subtitle}>
              商品 Brief、生成策略、投放数据和成本统计统一管理
            </div>
          </div>
          <div style={styles.headerRight}>
            <div style={styles.productSelector}>
              <button
                style={styles.productBtn}
                onClick={() => setShowProductMenu(!showProductMenu)}
                title="切换产品"
              >
                {activeProduct?.name || "选择产品"}
                <span style={styles.dropdownArrow}>▼</span>
              </button>
              {showProductMenu && (
                <div style={styles.productMenu}>
                  {products.map((product) => (
                    <div
                      key={product.id}
                      style={
                        product.id === activeProductId
                          ? styles.productMenuItemActive
                          : styles.productMenuItem
                      }
                      onClick={() => {
                        switchProduct(product.id);
                        setShowProductMenu(false);
                      }}
                    >
                      {editingProductId === product.id ? (
                        <input
                          style={styles.productInput}
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={handleConfirmRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleConfirmRename();
                            if (e.key === "Escape") setEditingProductId(null);
                          }}
                          autoFocus
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span style={styles.productName}>{product.name}</span>
                      )}
                      <div style={styles.productActions}>
                        <button
                          style={styles.productActionBtn}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleStartRename(product.id, product.name);
                          }}
                          title="重命名"
                        >
                          ✎
                        </button>
                        {products.length > 1 && (
                          <button
                            style={{
                              ...styles.productActionBtn,
                              color: "#dc2626",
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteProduct(product.id);
                            }}
                            title="删除"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                  {showNewProduct ? (
                    <div style={styles.productMenuNew}>
                      <input
                        style={styles.productInput}
                        value={newProductName}
                        onChange={(e) => setNewProductName(e.target.value)}
                        placeholder="输入产品名称"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleCreateProduct();
                          if (e.key === "Escape") setShowNewProduct(false);
                        }}
                        autoFocus
                      />
                      <button
                        style={styles.productActionBtn}
                        onClick={handleCreateProduct}
                      >
                        ✓
                      </button>
                      <button
                        style={{ ...styles.productActionBtn, color: "#dc2626" }}
                        onClick={() => setShowNewProduct(false)}
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <button
                      style={styles.productMenuAdd}
                      onClick={() => setShowNewProduct(true)}
                    >
                      + 新建产品
                    </button>
                  )}
                </div>
              )}
            </div>
            <button style={styles.closeBtn} onClick={onClose} title="关闭">
              ×
            </button>
          </div>
        </div>

        <div style={styles.tabs}>
          {(
            [
              ["brief", "商品 Brief"],
              ["strategy", "生成策略"],
              ["feedback", "投放数据"],
              ["cost", "成本统计"],
            ] as Array<[Tab, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              style={tab === id ? styles.tabActive : styles.tab}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </div>

        <div style={styles.body}>
          {tab === "brief" && (
            <div>
              <div style={styles.templateRow}>
                {GROWTH_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    style={
                      brief.templateId === template.id
                        ? styles.templateActive
                        : styles.templateBtn
                    }
                    onClick={() => applyTemplate(template.id)}
                    title={template.description}
                  >
                    {template.name}
                  </button>
                ))}
              </div>
              <div style={styles.grid}>
                <Field
                  label="商品名称"
                  value={brief.productName}
                  onChange={(value) => setBrief({ productName: value })}
                  placeholder="如：益生菌冻干粉"
                />
                <Field
                  label="价格"
                  value={brief.price}
                  onChange={(value) => setBrief({ price: value })}
                  placeholder="如：99 元/盒"
                />
                <Field
                  label="目标人群"
                  value={brief.targetAudience}
                  onChange={(value) => setBrief({ targetAudience: value })}
                  placeholder="多个用逗号分隔，如：宝妈、上班族"
                />
                <Field
                  label="核心痛点"
                  value={brief.painPoints}
                  onChange={(value) => setBrief({ painPoints: value })}
                  placeholder="如：睡不好、反复、花冤枉钱"
                />
                <Field
                  label="核心卖点"
                  value={brief.coreSellingPoints}
                  onChange={(value) => setBrief({ coreSellingPoints: value })}
                  placeholder="如：专利配方、使用方便、不刺激"
                />
                <Field
                  label="信任证据"
                  value={brief.evidence}
                  onChange={(value) => setBrief({ evidence: value })}
                  placeholder="如：检测报告、用户对比、销量数据"
                />
                <Field
                  label="优惠活动"
                  value={brief.offer}
                  onChange={(value) => setBrief({ offer: value })}
                  placeholder="如：买二送一、限时券"
                />
                <Field
                  label="行动句"
                  value={brief.cta}
                  onChange={(value) => setBrief({ cta: value })}
                  placeholder="如：点下方链接马上带走"
                />
                <Field
                  label="禁用词"
                  value={brief.forbiddenWords}
                  onChange={(value) => setBrief({ forbiddenWords: value })}
                  placeholder="用逗号分隔"
                />
                <Field
                  label="额外指令"
                  value={brief.extraPrompt}
                  onChange={(value) => setBrief({ extraPrompt: value })}
                  placeholder="如：优先女性视角，突出使用前后对比"
                  multiline
                />
              </div>
            </div>
          )}

          {tab === "strategy" && (
            <div>
              <div style={styles.sectionTitle}>钩子专项策略</div>
              <div style={styles.optionGrid}>
                {HOOK_OPTIONS.map((option) => (
                  <label
                    key={option.id}
                    style={
                      brief.hookStrategies.includes(option.id)
                        ? styles.optionActive
                        : styles.optionItem
                    }
                  >
                    <input
                      type="checkbox"
                      checked={brief.hookStrategies.includes(option.id)}
                      onChange={() => toggleHook(option.id)}
                    />
                    <span>
                      <strong>{option.label}</strong>
                      <small>{option.description}</small>
                    </span>
                  </label>
                ))}
              </div>
              <div style={styles.sectionTitle}>生产开关</div>
              <Toggle
                label="按目标人群生成不同版本"
                checked={brief.audienceVariants}
                onChange={(checked) => setBrief({ audienceVariants: checked })}
              />
              <Toggle
                label="导出前合规检查"
                checked={brief.enableCompliance}
                onChange={(checked) => setBrief({ enableCompliance: checked })}
              />
              <Toggle
                label="语义转场专项检查"
                checked={brief.enableSemanticCheck}
                onChange={(checked) =>
                  setBrief({ enableSemanticCheck: checked })
                }
              />
              <Toggle
                label="A/B 测试矩阵"
                checked={brief.enableAbMatrix}
                onChange={(checked) => setBrief({ enableAbMatrix: checked })}
              />
              <Toggle
                label="字幕与画面节奏提示"
                checked={brief.enablePacing}
                onChange={(checked) => setBrief({ enablePacing: checked })}
              />
              <Field
                label="字幕重点关键词"
                value={brief.subtitleKeywords}
                onChange={(value) => setBrief({ subtitleKeywords: value })}
                placeholder="价格、核心卖点、行动词，逗号分隔"
              />
            </div>
          )}

          {tab === "feedback" && (
            <div>
              <div style={styles.grid}>
                <Field
                  label="视频名称"
                  value={feedbackForm.videoName}
                  onChange={(value) =>
                    setFeedbackForm({ ...feedbackForm, videoName: value })
                  }
                  placeholder="导出文件或投放计划名称"
                />
                <Field
                  label="钩子类型"
                  value={feedbackForm.hookType}
                  onChange={(value) =>
                    setFeedbackForm({ ...feedbackForm, hookType: value })
                  }
                  placeholder="如：痛点型"
                />
                <NumberField
                  label="3 秒播放率 %"
                  value={feedbackForm.threeSecondRate}
                  onChange={(value) =>
                    setFeedbackForm({ ...feedbackForm, threeSecondRate: value })
                  }
                />
                <NumberField
                  label="完播率 %"
                  value={feedbackForm.completionRate}
                  onChange={(value) =>
                    setFeedbackForm({ ...feedbackForm, completionRate: value })
                  }
                />
                <NumberField
                  label="点击率 %"
                  value={feedbackForm.clickRate}
                  onChange={(value) =>
                    setFeedbackForm({ ...feedbackForm, clickRate: value })
                  }
                />
                <NumberField
                  label="转化率 %"
                  value={feedbackForm.conversionRate}
                  onChange={(value) =>
                    setFeedbackForm({ ...feedbackForm, conversionRate: value })
                  }
                />
                <NumberField
                  label="消耗金额"
                  value={feedbackForm.spend}
                  onChange={(value) =>
                    setFeedbackForm({ ...feedbackForm, spend: value })
                  }
                />
              </div>
              <button style={styles.primaryBtn} onClick={submitFeedback}>
                添加投放记录
              </button>
              {feedbackInsights && (
                <div style={styles.insightBox}>
                  <strong>AI 自动回流建议</strong>
                  <span>{feedbackInsights}</span>
                </div>
              )}
              <div style={styles.table}>
                {feedback.length === 0 ? (
                  <div style={styles.empty}>暂无投放数据</div>
                ) : (
                  feedback.map((item) => (
                    <div key={item.id} style={styles.tableRow}>
                      <span style={styles.tableName}>{item.videoName}</span>
                      <span>{item.hookType || "-"}</span>
                      <span>3秒 {item.threeSecondRate}%</span>
                      <span>完播 {item.completionRate}%</span>
                      <span>点击 {item.clickRate}%</span>
                      <span>转化 {item.conversionRate}%</span>
                      <span>¥{item.spend}</span>
                      <button
                        style={styles.deleteBtn}
                        onClick={() => removeFeedback(item.id)}
                      >
                        删除
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {tab === "cost" && (
            <div>
              <div style={styles.grid}>
                <NumberField
                  label="LLM 输入价格/百万 Token"
                  value={brief.llmInputPricePerMillion}
                  onChange={(value) =>
                    setBrief({ llmInputPricePerMillion: value })
                  }
                />
                <NumberField
                  label="LLM 输出价格/百万 Token"
                  value={brief.llmOutputPricePerMillion}
                  onChange={(value) =>
                    setBrief({ llmOutputPricePerMillion: value })
                  }
                />
                <NumberField
                  label="在线识别价格/分钟"
                  value={brief.asrPricePerMinute}
                  onChange={(value) => setBrief({ asrPricePerMinute: value })}
                />
              </div>
              <div style={styles.statsGrid}>
                <Stat label="处理任务" value={`${usage.length} 条`} />
                <Stat
                  label="输入 Token"
                  value={totals.inputTokens.toLocaleString()}
                />
                <Stat
                  label="输出 Token"
                  value={totals.outputTokens.toLocaleString()}
                />
                <Stat label="识别分钟" value={totals.asrMinutes.toFixed(1)} />
                <Stat
                  label="预估总成本"
                  value={`¥${totals.estimatedCost.toFixed(2)}`}
                />
              </div>
              <div style={styles.sectionTitle}>按实际模型统计</div>
              {modelTotals.length === 0 ? (
                <div style={styles.empty}>暂无大模型调用记录</div>
              ) : (
                <div style={styles.modelTable}>
                  <div style={{ ...styles.modelRow, ...styles.modelHeader }}>
                    <span>API / 模型</span>
                    <span>请求</span>
                    <span>输入 Token</span>
                    <span>输出 Token</span>
                    <span>总 Token</span>
                    <span>精度</span>
                  </div>
                  {modelTotals.map((item) => (
                    <div
                      key={`${item.providerId}:${item.model}`}
                      style={styles.modelRow}
                    >
                      <span style={styles.modelName}>
                        {item.providerName} / {item.model}
                      </span>
                      <span>{item.requestCount || "-"}</span>
                      <span>{item.inputTokens.toLocaleString()}</span>
                      <span>{item.outputTokens.toLocaleString()}</span>
                      <span>
                        {(
                          item.inputTokens + item.outputTokens
                        ).toLocaleString()}
                      </span>
                      <span>{item.estimated ? "含估算" : "API 实报"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={styles.footer}>
          <button style={styles.clearBtn} onClick={resetBrief}>
            重置策略
          </button>
          <button style={styles.primaryBtn} onClick={onClose}>
            完成
          </button>
        </div>
      </div>
    </div>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
}) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{props.label}</span>
      {props.multiline ? (
        <textarea
          style={styles.input}
          rows={3}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={props.placeholder}
        />
      ) : (
        <input
          style={styles.input}
          value={props.value}
          onChange={(event) => props.onChange(event.target.value)}
          placeholder={props.placeholder}
        />
      )}
    </label>
  );
}

function NumberField(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={styles.field}>
      <span style={styles.label}>{props.label}</span>
      <input
        style={styles.input}
        type="number"
        min={0}
        step="0.01"
        value={props.value}
        onChange={(event) =>
          props.onChange(Math.max(0, Number(event.target.value) || 0))
        }
      />
    </label>
  );
}

function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label style={styles.toggle}>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
      />
      <span>{props.label}</span>
    </label>
  );
}

function Stat(props: { label: string; value: string }) {
  return (
    <div style={styles.stat}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  mask: {
    position: "fixed",
    inset: 0,
    background: "rgba(15,23,42,0.48)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1100,
    padding: 20,
  },
  panel: {
    width: "min(900px, 100%)",
    maxHeight: "92vh",
    background: "#fff",
    borderRadius: 10,
    boxShadow: "0 18px 48px rgba(0,0,0,0.2)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    padding: "18px 22px",
    borderBottom: "1px solid #eceff3",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerRight: { display: "flex", alignItems: "center", gap: 12 },
  title: { fontSize: 18, fontWeight: 700, color: "#1f2937" },
  subtitle: { fontSize: 12, color: "#6b7280", marginTop: 4 },
  closeBtn: {
    border: "none",
    background: "transparent",
    fontSize: 24,
    color: "#6b7280",
    cursor: "pointer",
  },
  productSelector: { position: "relative" },
  productBtn: {
    border: "1px solid #d1d5db",
    background: "#fff",
    borderRadius: 6,
    padding: "6px 12px",
    fontSize: 13,
    color: "#374151",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: 6,
    maxWidth: 200,
  },
  dropdownArrow: { fontSize: 10, color: "#6b7280" },
  productMenu: {
    position: "absolute",
    top: "100%",
    right: 0,
    marginTop: 4,
    background: "#fff",
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
    minWidth: 220,
    maxHeight: 300,
    overflowY: "auto",
    zIndex: 100,
  },
  productMenuItem: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 13,
    color: "#374151",
    borderBottom: "1px solid #f3f4f6",
  },
  productMenuItemActive: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 13,
    color: "#1677ff",
    background: "#f0f7ff",
    borderBottom: "1px solid #f3f4f6",
    fontWeight: 600,
  },
  productName: {
    flex: 1,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  productActions: { display: "flex", gap: 4, marginLeft: 8 },
  productActionBtn: {
    border: "none",
    background: "transparent",
    color: "#6b7280",
    cursor: "pointer",
    fontSize: 12,
    padding: "2px 4px",
  },
  productInput: {
    flex: 1,
    border: "1px solid #d1d5db",
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 13,
    outline: "none",
  },
  productMenuNew: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    padding: "8px 12px",
    borderTop: "1px solid #f3f4f6",
  },
  productMenuAdd: {
    width: "100%",
    border: "none",
    background: "transparent",
    color: "#1677ff",
    cursor: "pointer",
    padding: "8px 12px",
    fontSize: 13,
    textAlign: "left",
    borderTop: "1px solid #f3f4f6",
  },
  tabs: {
    display: "flex",
    gap: 6,
    padding: "10px 22px 0",
    borderBottom: "1px solid #eceff3",
  },
  tab: {
    border: "none",
    background: "transparent",
    color: "#6b7280",
    padding: "9px 12px",
    cursor: "pointer",
    fontSize: 13,
  },
  tabActive: {
    border: "none",
    borderBottom: "2px solid #1677ff",
    background: "#f8fbff",
    color: "#1677ff",
    padding: "9px 12px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 600,
  },
  body: { padding: 20, overflowY: "auto", flex: 1 },
  templateRow: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  templateBtn: {
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#4b5563",
    padding: "7px 11px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12,
  },
  templateActive: {
    border: "1px solid #1677ff",
    background: "#eaf4ff",
    color: "#1677ff",
    padding: "7px 11px",
    borderRadius: 6,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
  },
  grid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 12, fontWeight: 600, color: "#374151" },
  input: {
    width: "100%",
    border: "1px solid #d1d5db",
    borderRadius: 6,
    padding: "8px 10px",
    fontSize: 13,
    color: "#111827",
    resize: "vertical",
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "#1f2937",
    margin: "4px 0 10px",
  },
  optionGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
    marginBottom: 18,
  },
  optionItem: {
    display: "flex",
    gap: 8,
    padding: 10,
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    cursor: "pointer",
    color: "#4b5563",
  },
  optionActive: {
    display: "flex",
    gap: 8,
    padding: 10,
    border: "1px solid #60a5fa",
    borderRadius: 6,
    cursor: "pointer",
    color: "#1d4ed8",
    background: "#eff6ff",
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 0",
    fontSize: 13,
    color: "#374151",
    cursor: "pointer",
  },
  table: { marginTop: 16, borderTop: "1px solid #e5e7eb" },
  tableRow: {
    display: "grid",
    gridTemplateColumns:
      "minmax(120px, 1.5fr) repeat(6, minmax(70px, auto)) auto",
    gap: 8,
    alignItems: "center",
    padding: "9px 4px",
    borderBottom: "1px solid #f0f2f5",
    fontSize: 11,
    color: "#4b5563",
  },
  tableName: {
    fontWeight: 600,
    color: "#1f2937",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  deleteBtn: {
    border: "none",
    background: "transparent",
    color: "#dc2626",
    cursor: "pointer",
    fontSize: 11,
  },
  empty: { padding: 24, textAlign: "center", color: "#9ca3af", fontSize: 12 },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(5, minmax(110px, 1fr))",
    gap: 10,
    marginTop: 18,
  },
  stat: {
    padding: 12,
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 12,
    color: "#6b7280",
    background: "#fafafa",
  },
  modelTable: {
    marginTop: 8,
    border: "1px solid #e5e7eb",
    borderRadius: 6,
    overflow: "hidden",
  },
  modelRow: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 2fr) repeat(5, minmax(80px, 1fr))",
    gap: 8,
    alignItems: "center",
    padding: "9px 10px",
    borderBottom: "1px solid #f0f2f5",
    fontSize: 11,
    color: "#4b5563",
  },
  modelHeader: { background: "#f8fafc", color: "#374151", fontWeight: 600 },
  modelName: {
    color: "#1f2937",
    fontWeight: 600,
    wordBreak: "break-all" as const,
  },
  insightBox: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginTop: 12,
    padding: 12,
    border: "1px solid #bae0ff",
    borderRadius: 6,
    background: "#f0f8ff",
    color: "#35546f",
    fontSize: 12,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
  },
  footer: {
    padding: "12px 20px",
    borderTop: "1px solid #eceff3",
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
  },
  primaryBtn: {
    border: "none",
    background: "#1677ff",
    color: "#fff",
    borderRadius: 6,
    padding: "8px 15px",
    cursor: "pointer",
    fontSize: 13,
    marginTop: 12,
  },
  clearBtn: {
    border: "1px solid #d1d5db",
    background: "#fff",
    color: "#4b5563",
    borderRadius: 6,
    padding: "8px 15px",
    cursor: "pointer",
    fontSize: 13,
  },
};
