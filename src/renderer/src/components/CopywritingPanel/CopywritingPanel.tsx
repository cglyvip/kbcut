import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useCopywritingStore,
  COPY_STATUS_OPTIONS,
  COPY_SOURCE_LABELS,
  CHARS_PER_SECOND_HINT,
  type CopyStatus,
  type CopywritingItem,
  type CopywritingBrief,
} from "../../stores/useCopywritingStore";
import { useLlmStore } from "../../stores/useLlmStore";
import { useAsrStore } from "../../stores/useAsrStore";
import { useVideoStore } from "../../stores/useVideoStore";

const STATUS_COLORS: Record<CopyStatus, string> = {
  draft: "#8c8c8c",
  ready: "#1677ff",
  filmed: "#fa8c16",
  published: "#52c41a",
};

type BriefField = keyof CopywritingBrief;

const BRIEF_FIELDS: { key: BriefField; label: string; hint: string }[] = [
  { key: "productName", label: "商品名称", hint: "例如：厨房去油喷雾" },
  { key: "price", label: "价格", hint: "例如：39.9 元 / 两瓶装" },
  { key: "targetAudience", label: "目标人群", hint: "例如：经常做饭的宝妈" },
  { key: "painPoints", label: "用户痛点", hint: "例如：灶台油污擦不掉" },
  { key: "coreSellingPoints", label: "核心卖点", hint: "例如：喷一喷 30 秒化解" },
  { key: "evidence", label: "信任证据", hint: "例如：实测对比 / 复购率" },
  { key: "offer", label: "优惠活动", hint: "例如：买二送一，限时三天" },
  { key: "cta", label: "期望喊单", hint: "例如：点左下角直接拍" },
  { key: "forbiddenWords", label: "禁用词", hint: "例如：最、第一、治疗" },
];

function formatDate(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function countChars(text: string): number {
  return String(text ?? "").replace(/\s+/g, "").length;
}

export default function CopywritingPanel() {
  const items = useCopywritingStore((s) => s.items);
  const form = useCopywritingStore((s) => s.form);
  const dirty = useCopywritingStore((s) => s.dirty);
  const loading = useCopywritingStore((s) => s.loading);
  const saving = useCopywritingStore((s) => s.saving);
  const generating = useCopywritingStore((s) => s.generating);
  const error = useCopywritingStore((s) => s.error);
  const notice = useCopywritingStore((s) => s.notice);
  const selectItem = useCopywritingStore((s) => s.selectItem);
  const startNew = useCopywritingStore((s) => s.startNew);
  const updateForm = useCopywritingStore((s) => s.updateForm);
  const updateBrief = useCopywritingStore((s) => s.updateBrief);
  const setTags = useCopywritingStore((s) => s.setTags);
  const saveForm = useCopywritingStore((s) => s.saveForm);
  const remove = useCopywritingStore((s) => s.remove);
  const duplicate = useCopywritingStore((s) => s.duplicate);
  const generate = useCopywritingStore((s) => s.generate);
  const clearNotice = useCopywritingStore((s) => s.clearNotice);
  const dismissError = useCopywritingStore((s) => s.dismissError);

  const providers = useLlmStore((s) => s.providers);
  const asrSegments = useAsrStore((s) => s.segments);
  const videoInfo = useVideoStore((s) => s.videoInfo);

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | CopyStatus>("all");
  const [tagsInput, setTagsInput] = useState("");
  const [materialText, setMaterialText] = useState("");
  const [useMaterial, setUseMaterial] = useState(false);
  const [targetDuration, setTargetDuration] = useState(45);
  const [style, setStyle] = useState("");
  const [requirements, setRequirements] = useState("");
  const [copied, setCopied] = useState(false);
  const [libraryPath, setLibraryPath] = useState("");

  const asrText = useMemo(
    () =>
      asrSegments
        .map((segment) => String(segment.text ?? "").trim())
        .filter(Boolean)
        .join("\n"),
    [asrSegments],
  );

  // 已识别过视频时，自动把识别结果填成素材参考
  useEffect(() => {
    if (asrText && !materialText.trim()) {
      setMaterialText(asrText);
      setUseMaterial(true);
    }
  }, [asrText, materialText]);

  useEffect(() => {
    setTagsInput(form.tags.join(" "));
  }, [form.id, form.tags]);

  // 文案库落盘位置：只作提示，读取失败不影响使用
  useEffect(() => {
    void window.api
      .getCopywritingLibraryPath()
      .then((path) => setLibraryPath(String(path ?? "")))
      .catch((err: unknown) =>
        console.error("[copywriting-library-path]", err),
      );
  }, []);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (!keyword) return true;
      return (
        item.title.toLowerCase().includes(keyword) ||
        item.content.toLowerCase().includes(keyword) ||
        item.tags.some((tag) => tag.toLowerCase().includes(keyword))
      );
    });
  }, [items, search, statusFilter]);

  const contentChars = countChars(form.content);
  const estimatedSeconds = contentChars / CHARS_PER_SECOND_HINT;

  const handleCopy = useCallback(async () => {
    if (!form.content.trim()) return;
    await window.api.writeClipboard(form.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }, [form.content]);

  const handleExport = useCallback(async () => {
    if (!form.content.trim()) return;
    try {
      const result = await window.api.exportCopywriting({
        title: form.title || "口播文案",
        content: form.content,
      });
      if (result?.ok && result.path) {
        useCopywritingStore.setState({ notice: `已导出到 ${result.path}` });
      } else if (result?.error) {
        useCopywritingStore.setState({ error: result.error });
      }
    } catch (err: unknown) {
      useCopywritingStore.setState({
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, [form.title, form.content]);

  const handleGenerate = useCallback(async () => {
    await generate({
      providers,
      materialText: useMaterial ? materialText : undefined,
      requirements,
      targetDurationSec: targetDuration,
      style,
    });
  }, [
    generate,
    providers,
    useMaterial,
    materialText,
    requirements,
    targetDuration,
    style,
  ]);

  const handleTagsCommit = useCallback(() => {
    const tags = tagsInput
      .split(/[\s,，、]+/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    setTags([...new Set(tags)].slice(0, 20));
  }, [tagsInput, setTags]);

  const handleDelete = useCallback(async () => {
    if (!form.id) {
      startNew();
      return;
    }
    const item = items.find((current) => current.id === form.id);
    const label = item?.title || "这条文案";
    if (!window.confirm(`确定删除「${label}」？删除后不可恢复。`)) return;
    await remove([form.id]);
  }, [form.id, items, remove, startNew]);

  return (
    <div style={styles.wrap}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarHead}>
          <span style={styles.sidebarTitle}>文案库 · {items.length}</span>
          <button style={styles.primaryBtnSmall} onClick={startNew}>
            + 新建
          </button>
        </div>
        <input
          style={styles.input}
          placeholder="搜索标题 / 正文 / 标签"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <select
          style={styles.input}
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as "all" | CopyStatus)
          }
        >
          <option value="all">全部状态</option>
          {COPY_STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <div style={styles.list}>
          {loading && <div style={styles.emptyText}>正在读取文案库…</div>}
          {!loading && filtered.length === 0 && (
            <div style={styles.emptyText}>
              还没有文案。点右上角「+ 新建」写一条，或用右侧 AI 生成。
            </div>
          )}
          {filtered.map((item: CopywritingItem) => {
            const active = item.id === form.id;
            return (
              <button
                key={item.id}
                style={active ? styles.listItemActive : styles.listItem}
                onClick={() => selectItem(item.id)}
              >
                <div style={styles.listItemTitle}>
                  <span style={styles.statusDot(STATUS_COLORS[item.status])} />
                  {item.title || "未命名文案"}
                </div>
                <div style={styles.listItemMeta}>
                  {COPY_SOURCE_LABELS[item.source] || item.source} ·{" "}
                  {countChars(item.content)} 字 · {formatDate(item.updatedAt)}
                </div>
                {item.tags.length > 0 && (
                  <div style={styles.listItemTags}>
                    {item.tags.map((tag) => (
                      <span key={tag} style={styles.tag}>
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {libraryPath && (
          <div style={styles.libraryPath} title={libraryPath}>
            文案库文件：{libraryPath}
          </div>
        )}
      </aside>

      <section style={styles.editor}>
        <div style={styles.editorHead}>
          <input
            style={styles.titleInput}
            placeholder="文案标题，例如：厨房油污一喷就化"
            value={form.title}
            onChange={(event) => updateForm({ title: event.target.value })}
          />
          <select
            style={styles.statusSelect}
            value={form.status}
            onChange={(event) =>
              updateForm({ status: event.target.value as CopyStatus })
            }
          >
            {COPY_STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            style={saving ? styles.primaryBtnDisabled : styles.primaryBtn}
            onClick={() => void saveForm()}
            disabled={saving}
          >
            {saving ? "保存中…" : "保存到文案库"}
          </button>
          <button style={styles.ghostBtn} onClick={() => void handleCopy()}>
            {copied ? "已复制" : "复制正文"}
          </button>
          <button style={styles.ghostBtn} onClick={() => void handleExport()}>
            导出 txt
          </button>
          {form.id && (
            <button
              style={styles.ghostBtn}
              onClick={() => duplicate(form.id as string)}
            >
              存为副本
            </button>
          )}
          <button style={styles.dangerBtn} onClick={() => void handleDelete()}>
            删除
          </button>
        </div>

        {(error || notice) && (
          <div style={styles.bannerRow}>
            {error && (
              <div style={styles.errorBanner}>
                <span style={styles.bannerText}>{error}</span>
                <button style={styles.bannerClose} onClick={dismissError}>
                  ×
                </button>
              </div>
            )}
            {notice && (
              <div style={styles.noticeBanner}>
                <span style={styles.bannerText}>{notice}</span>
                <button style={styles.bannerClose} onClick={clearNotice}>
                  ×
                </button>
              </div>
            )}
          </div>
        )}

        <div style={styles.columns}>
          <div style={styles.colMain}>
            <div style={styles.fieldHead}>
              <span style={styles.fieldLabel}>
                口播文案正文{dirty ? " · 未保存" : ""}
              </span>
              <span style={styles.statText}>
                {contentChars} 字 · 约 {estimatedSeconds.toFixed(1)} 秒口播
              </span>
            </div>
            <textarea
              style={styles.textarea}
              placeholder={"一行一句，照着念就能拍。\n例如：\n灶台油污擦了半天还粘手？\n这瓶去油喷雾喷上去等 30 秒，一擦就干净。"}
              value={form.content}
              onChange={(event) => updateForm({ content: event.target.value })}
            />
            <div style={styles.field}>
              <span style={styles.fieldLabel}>标签（空格分隔，便于筛选）</span>
              <input
                style={styles.input}
                placeholder="例如：厨房 去油 宝妈"
                value={tagsInput}
                onChange={(event) => setTagsInput(event.target.value)}
                onBlur={handleTagsCommit}
              />
            </div>
          </div>

          <div style={styles.colSide}>
            <div style={styles.card}>
              <div style={styles.cardTitle}>AI 生成新文案</div>
              <div style={styles.cardHint}>
                生成的是全新完整文案，可先手改再保存。失败会直接报错，不会用假文案兜底。
              </div>
              <label style={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={useMaterial}
                  onChange={(event) => setUseMaterial(event.target.checked)}
                />
                <span style={styles.checkboxText}>
                  带入口播素材参考
                  {videoInfo ? `（${videoInfo.fileName}）` : "（暂无识别结果）"}
                </span>
              </label>
              <textarea
                style={styles.materialArea}
                placeholder="素材参考：把旧口播原句或想用的说法贴在这里，AI 会重新组织成一条完整文案"
                value={materialText}
                onChange={(event) => setMaterialText(event.target.value)}
                disabled={!useMaterial}
              />
              <div style={styles.inlineFields}>
                <label style={styles.inlineField}>
                  <span style={styles.fieldLabel}>目标时长（秒）</span>
                  <input
                    style={styles.input}
                    type="number"
                    min={5}
                    max={600}
                    value={targetDuration}
                    onChange={(event) =>
                      setTargetDuration(Number(event.target.value) || 45)
                    }
                  />
                </label>
                <label style={styles.inlineField}>
                  <span style={styles.fieldLabel}>风格（可空）</span>
                  <input
                    style={styles.input}
                    placeholder="例如：接地气唠嗑"
                    value={style}
                    onChange={(event) => setStyle(event.target.value)}
                  />
                </label>
              </div>
              <div style={styles.field}>
                <span style={styles.fieldLabel}>额外要求（可空）</span>
                <textarea
                  style={styles.requirementsArea}
                  placeholder="例如：突出性价比，面向宝妈，开头用疑问句"
                  value={requirements}
                  onChange={(event) => setRequirements(event.target.value)}
                />
              </div>
              <button
                style={
                  generating ? styles.primaryBtnDisabled : styles.primaryBtn
                }
                onClick={() => void handleGenerate()}
                disabled={generating}
              >
                {generating ? "正在生成…" : "生成新文案"}
              </button>
              {form.usedProviderName && (
                <div style={styles.cardHint}>
                  上次生成：{form.usedProviderName}
                  {form.usedModel ? ` · ${form.usedModel}` : ""}
                </div>
              )}
            </div>

            <div style={styles.card}>
              <div style={styles.cardTitle}>商品信息（生成依据，可选填）</div>
              <div style={styles.cardHint}>
                填得越全，生成的文案越贴近你的商品；留空则只按素材写。
              </div>
              {BRIEF_FIELDS.map((field) => (
                <label key={field.key} style={styles.field}>
                  <span style={styles.fieldLabel}>{field.label}</span>
                  <input
                    style={styles.input}
                    placeholder={field.hint}
                    value={form.brief[field.key]}
                    onChange={(event) =>
                      updateBrief({ [field.key]: event.target.value })
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

const styles: Record<string, any> = {
  wrap: {
    display: "flex",
    gap: 16,
    padding: "0 40px",
    alignItems: "flex-start",
  },
  sidebar: {
    width: 320,
    flexShrink: 0,
    background: "#fff",
    border: "1px solid #e8e8e8",
    borderRadius: 12,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
    maxHeight: "calc(100vh - 180px)",
  },
  sidebarHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sidebarTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "#1a1a2e",
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    overflowY: "auto",
    flex: 1,
  },
  listItem: {
    textAlign: "left",
    border: "1px solid #f0f0f0",
    background: "#fafafa",
    borderRadius: 8,
    padding: "8px 10px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  listItemActive: {
    textAlign: "left",
    border: "1px solid #1677ff",
    background: "#e6f4ff",
    borderRadius: 8,
    padding: "8px 10px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  listItemTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "#262626",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  listItemMeta: {
    fontSize: 11,
    color: "#8c8c8c",
  },
  listItemTags: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
  },
  tag: {
    fontSize: 10,
    color: "#1677ff",
    background: "#f0f5ff",
    borderRadius: 6,
    padding: "1px 6px",
  },
  statusDot: (color: string): React.CSSProperties => ({
    width: 8,
    height: 8,
    borderRadius: 4,
    background: color,
    flexShrink: 0,
  }),
  libraryPath: {
    fontSize: 10,
    color: "#bfbfbf",
    lineHeight: 1.5,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  emptyText: {
    fontSize: 12,
    color: "#8c8c8c",
    lineHeight: 1.8,
    padding: "8px 4px",
  },
  editor: {
    flex: 1,
    minWidth: 0,
    background: "#fff",
    border: "1px solid #e8e8e8",
    borderRadius: 12,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    boxShadow: "0 2px 10px rgba(0,0,0,0.04)",
  },
  editorHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  titleInput: {
    flex: 1,
    minWidth: 200,
    fontSize: 15,
    fontWeight: 600,
    border: "1px solid #e8e8e8",
    borderRadius: 8,
    padding: "8px 10px",
    outline: "none",
    color: "#1a1a2e",
  },
  statusSelect: {
    border: "1px solid #e8e8e8",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 13,
    color: "#262626",
    background: "#fff",
  },
  primaryBtn: {
    background: "#1677ff",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  },
  primaryBtnSmall: {
    background: "#1677ff",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "4px 10px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  },
  primaryBtnDisabled: {
    background: "#bfbfbf",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "not-allowed",
  },
  ghostBtn: {
    background: "#fff",
    color: "#262626",
    border: "1px solid #d9d9d9",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    cursor: "pointer",
  },
  dangerBtn: {
    background: "#fff",
    color: "#ff4d4f",
    border: "1px solid #ffccc7",
    borderRadius: 8,
    padding: "8px 12px",
    fontSize: 13,
    cursor: "pointer",
  },
  bannerRow: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  errorBanner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    background: "#fff2f0",
    border: "1px solid #ffccc7",
    borderRadius: 8,
    padding: "8px 10px",
  },
  noticeBanner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    background: "#f6ffed",
    border: "1px solid #b7eb8f",
    borderRadius: 8,
    padding: "8px 10px",
  },
  bannerText: {
    fontSize: 12,
    color: "#262626",
    whiteSpace: "pre-wrap",
    flex: 1,
  },
  bannerClose: {
    border: "none",
    background: "transparent",
    color: "#8c8c8c",
    fontSize: 14,
    cursor: "pointer",
    lineHeight: 1,
    padding: 0,
  },
  columns: {
    display: "flex",
    gap: 16,
    alignItems: "flex-start",
  },
  colMain: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  colSide: {
    width: 360,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  fieldHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  fieldLabel: {
    fontSize: 12,
    color: "#595959",
    fontWeight: 500,
  },
  statText: {
    fontSize: 12,
    color: "#8c8c8c",
  },
  textarea: {
    width: "100%",
    minHeight: 420,
    resize: "vertical",
    border: "1px solid #e8e8e8",
    borderRadius: 10,
    padding: "12px 14px",
    fontSize: 15,
    lineHeight: 1.9,
    color: "#1a1a2e",
    outline: "none",
    fontFamily: "inherit",
  },
  input: {
    width: "100%",
    border: "1px solid #e8e8e8",
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 13,
    color: "#262626",
    outline: "none",
  },
  materialArea: {
    width: "100%",
    minHeight: 96,
    resize: "vertical",
    border: "1px solid #e8e8e8",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 12,
    lineHeight: 1.7,
    color: "#595959",
    outline: "none",
    fontFamily: "inherit",
  },
  requirementsArea: {
    width: "100%",
    minHeight: 60,
    resize: "vertical",
    border: "1px solid #e8e8e8",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 12,
    lineHeight: 1.7,
    color: "#595959",
    outline: "none",
    fontFamily: "inherit",
  },
  card: {
    border: "1px solid #e8e8e8",
    borderRadius: 10,
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    background: "#fcfcfd",
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: "#1a1a2e",
  },
  cardHint: {
    fontSize: 11,
    color: "#8c8c8c",
    lineHeight: 1.7,
  },
  checkboxRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
  },
  checkboxText: {
    fontSize: 12,
    color: "#595959",
  },
  inlineFields: {
    display: "flex",
    gap: 8,
  },
  inlineField: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    flex: 1,
  },
};