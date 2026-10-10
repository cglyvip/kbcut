import { create } from "zustand";

export type CopyStatus = "draft" | "ready" | "filmed" | "published";
export type CopySource = "manual" | "ai" | "material";

export const COPY_STATUS_OPTIONS: { value: CopyStatus; label: string }[] = [
  { value: "draft", label: "草稿" },
  { value: "ready", label: "待拍" },
  { value: "filmed", label: "已拍" },
  { value: "published", label: "已发布" },
];

export const COPY_SOURCE_LABELS: Record<CopySource, string> = {
  manual: "手写",
  ai: "AI 生成",
  material: "素材改写",
};

export const COPY_REQUEST_TEXT_LIMIT = 12000;
/** 中文口播平均语速（字/秒），与主进程 copywriting-generator 保持一致 */
export const CHARS_PER_SECOND_HINT = 4.5;

export interface CopywritingBrief {
  productName: string;
  price: string;
  targetAudience: string;
  painPoints: string;
  coreSellingPoints: string;
  evidence: string;
  offer: string;
  cta: string;
  forbiddenWords: string;
}

export interface CopywritingItem {
  id: string;
  title: string;
  content: string;
  status: CopyStatus;
  tags: string[];
  brief: CopywritingBrief;
  source: CopySource;
  usedProviderName: string;
  usedModel: string;
  createdAt: number;
  updatedAt: number;
}

/** 编辑器缓冲：id 为 null 表示"还没落库的新文案"。 */
export interface CopywritingForm {
  id: string | null;
  title: string;
  content: string;
  status: CopyStatus;
  tags: string[];
  brief: CopywritingBrief;
  source: CopySource;
  usedProviderName: string;
  usedModel: string;
  createdAt: number | null;
}

export interface GenerateDraftOptions {
  providers: {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    enabled: boolean;
  }[];
  materialText?: string;
  requirements?: string;
  targetDurationSec?: number;
  style?: string;
}

export function emptyBrief(): CopywritingBrief {
  return {
    productName: "",
    price: "",
    targetAudience: "",
    painPoints: "",
    coreSellingPoints: "",
    evidence: "",
    offer: "",
    cta: "",
    forbiddenWords: "",
  };
}

export function emptyForm(): CopywritingForm {
  return {
    id: null,
    title: "",
    content: "",
    status: "draft",
    tags: [],
    brief: emptyBrief(),
    source: "manual",
    usedProviderName: "",
    usedModel: "",
    createdAt: null,
  };
}

export function formFromItem(item: CopywritingItem): CopywritingForm {
  return {
    id: item.id,
    title: item.title,
    content: item.content,
    status: item.status,
    tags: [...item.tags],
    brief: { ...emptyBrief(), ...item.brief },
    source: item.source,
    usedProviderName: item.usedProviderName,
    usedModel: item.usedModel,
    createdAt: item.createdAt,
  };
}

function sortItems(items: CopywritingItem[]): CopywritingItem[] {
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt);
}

function upsertItem(
  items: CopywritingItem[],
  item: CopywritingItem,
): CopywritingItem[] {
  const exists = items.some((current) => current.id === item.id);
  const next = exists
    ? items.map((current) => (current.id === item.id ? item : current))
    : [item, ...items];
  return sortItems(next);
}

interface CopywritingState {
  items: CopywritingItem[];
  form: CopywritingForm;
  /** 编辑器内容与已保存版本是否不一致 */
  dirty: boolean;
  loading: boolean;
  saving: boolean;
  generating: boolean;
  error: string | null;
  notice: string | null;
  hydrated: boolean;

  hydrate: () => Promise<void>;
  selectItem: (id: string) => void;
  startNew: () => void;
  updateForm: (patch: Partial<Omit<CopywritingForm, "brief">>) => void;
  updateBrief: (patch: Partial<CopywritingBrief>) => void;
  setTags: (tags: string[]) => void;
  saveForm: () => Promise<boolean>;
  remove: (ids: string[]) => Promise<void>;
  duplicate: (id: string) => void;
  generate: (options: GenerateDraftOptions) => Promise<boolean>;
  clearNotice: () => void;
  dismissError: () => void;
}

export const useCopywritingStore = create<CopywritingState>((set, get) => ({
  items: [],
  form: emptyForm(),
  dirty: false,
  loading: false,
  saving: false,
  generating: false,
  error: null,
  notice: null,
  hydrated: false,

  hydrate: async () => {
    set({ loading: true, error: null });
    try {
      if (typeof window.api?.listCopywriting !== "function") {
        throw new Error("文案库接口不可用，请重启应用");
      }
      const library = await window.api.listCopywriting();
      const items = sortItems(Array.isArray(library?.items) ? library.items : []);
      set((state) => ({
        items,
        hydrated: true,
        // 已经打开过编辑器就不要被刷新覆盖
        form: state.dirty ? state.form : state.form.id ? state.form : emptyForm(),
      }));
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      set({ loading: false });
    }
  },

  selectItem: (id) => {
    const item = get().items.find((current) => current.id === id);
    if (!item) return;
    set({ form: formFromItem(item), dirty: false, error: null, notice: null });
  },

  startNew: () => {
    set({ form: emptyForm(), dirty: false, error: null, notice: null });
  },

  updateForm: (patch) => {
    set((state) => ({ form: { ...state.form, ...patch }, dirty: true }));
  },

  updateBrief: (patch) => {
    set((state) => ({
      form: { ...state.form, brief: { ...state.form.brief, ...patch } },
      dirty: true,
    }));
  },

  setTags: (tags) => {
    set((state) => ({ form: { ...state.form, tags }, dirty: true }));
  },

  saveForm: async () => {
    const { form } = get();
    if (!form.title.trim() && !form.content.trim()) {
      set({ error: "标题和正文不能同时为空" });
      return false;
    }
    set({ saving: true, error: null, notice: null });
    try {
      const result = await window.api.saveCopywriting({
        id: form.id ?? undefined,
        title: form.title,
        content: form.content,
        status: form.status,
        tags: form.tags,
        brief: form.brief,
        source: form.source,
        usedProviderName: form.usedProviderName,
        usedModel: form.usedModel,
        createdAt: form.createdAt ?? undefined,
      });
      if (!result?.ok || !result.item) {
        throw new Error(result?.error || "保存失败");
      }
      const item = result.item;
      set((state) => ({
        items: upsertItem(state.items, item),
        form: formFromItem(item),
        dirty: false,
        notice: "已保存到文案库",
      }));
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ saving: false });
    }
  },

  remove: async (ids) => {
    const targets = (Array.isArray(ids) ? ids : []).filter(Boolean);
    if (targets.length === 0) return;
    set({ error: null, notice: null });
    try {
      const result = await window.api.deleteCopywritingMany(targets);
      if (!result?.ok) throw new Error(result?.error || "删除失败");
      const removed = new Set(targets);
      set((state) => {
        const items = state.items.filter((item) => !removed.has(item.id));
        const form =
          state.form.id && removed.has(state.form.id)
            ? emptyForm()
            : state.form;
        return {
          items,
          form,
          dirty: state.form.id && removed.has(state.form.id) ? false : state.dirty,
          notice: `已删除 ${removed.size} 条文案`,
        };
      });
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
    }
  },

  duplicate: (id) => {
    const item = get().items.find((current) => current.id === id);
    if (!item) return;
    set({
      form: {
        ...formFromItem(item),
        id: null,
        title: `${item.title}（副本）`.slice(0, 120),
        createdAt: null,
      },
      dirty: true,
      error: null,
      notice: "已复制为新文案，保存后进入文案库",
    });
  },

  generate: async (options) => {
    const { form } = get();
    set({ generating: true, error: null, notice: null });
    try {
      const materialText = String(options.materialText ?? "").slice(
        0,
        COPY_REQUEST_TEXT_LIMIT,
      );
      const draft = await window.api.generateCopywriting({
        brief: form.brief,
        materialText,
        requirements: options.requirements,
        targetDurationSec: options.targetDurationSec,
        style: options.style,
        providers: options.providers,
      });
      set((state) => ({
        form: {
          ...state.form,
          title: draft.title || state.form.title,
          content: draft.content,
          source: materialText.trim() ? "material" : "ai",
          usedProviderName: draft.usedProviderName,
          usedModel: draft.usedModel,
        },
        dirty: true,
        notice: `已生成草稿（${draft.usedProviderName || draft.usedModel}），确认后点「保存到文案库」`,
      }));
      return true;
    } catch (err: unknown) {
      set({ error: err instanceof Error ? err.message : String(err) });
      return false;
    } finally {
      set({ generating: false });
    }
  },

  clearNotice: () => set({ notice: null }),
  dismissError: () => set({ error: null }),
}));