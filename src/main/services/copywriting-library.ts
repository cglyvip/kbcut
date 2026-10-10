// 文案库：本地持久化的「新建 / 记录 / 编辑 / 导出」。
// 复用 app-settings.ts 与 batch-checkpoint.ts 的原子写 + 串行保存链范式，不引入新依赖。
import { app } from "electron";
import { join } from "path";
import { mkdir, readFile, writeFile, rename, rm } from "fs/promises";
import { randomUUID } from "crypto";

export const COPY_STATUSES = ["draft", "ready", "filmed", "published"] as const;
export type CopyStatus = (typeof COPY_STATUSES)[number];

export const COPY_STATUS_LABELS: Record<CopyStatus, string> = {
  draft: "草稿",
  ready: "待拍",
  filmed: "已拍",
  published: "已发布",
};

export const COPY_SOURCES = ["manual", "ai", "material"] as const;
export type CopySource = (typeof COPY_SOURCES)[number];

export const COPY_SOURCE_LABELS: Record<CopySource, string> = {
  manual: "手写",
  ai: "AI 生成",
  material: "素材改写",
};

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

/** 保存入参：整条 upsert（前端始终提交完整对象）。 */
export interface CopywritingItemInput {
  id?: unknown;
  title?: unknown;
  content?: unknown;
  status?: unknown;
  tags?: unknown;
  brief?: unknown;
  source?: unknown;
  usedProviderName?: unknown;
  usedModel?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface CopywritingLibrary {
  version: number;
  updatedAt: number;
  items: CopywritingItem[];
}

export type SaveCopywritingResult = {
  ok: boolean;
  item?: CopywritingItem;
  error?: string;
};

const LIBRARY_VERSION = 1;
const FILE_NAME = "library.json";

export const COPY_LIMITS = {
  items: 2000,
  title: 120,
  content: 20000,
  tag: 24,
  tags: 20,
  briefField: 2000,
  providerName: 80,
} as const;

// 串行化保存链：避免并发保存互相覆盖（与 app-settings.ts 同思路）
let saveChain: Promise<void> = Promise.resolve();

function libraryDir(): string {
  return join(app.getPath("userData"), "copywriting");
}

function libraryPath(): string {
  return join(libraryDir(), FILE_NAME);
}

export function getCopywritingLibraryPath(): string {
  return libraryPath();
}

function clipText(value: unknown, max: number): string {
  return String(value ?? "").slice(0, max);
}

export function isValidCopywritingId(id: unknown): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(String(id ?? ""));
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

export function normalizeBrief(input: unknown): CopywritingBrief {
  const src =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const brief = emptyBrief();
  for (const key of Object.keys(brief) as (keyof CopywritingBrief)[]) {
    brief[key] = clipText(src[key], COPY_LIMITS.briefField).trim();
  }
  return brief;
}

function isValidStatus(value: unknown): boolean {
  return (COPY_STATUSES as readonly string[]).includes(String(value));
}

export function normalizeCopyStatus(value: unknown): CopyStatus {
  return isValidStatus(value) ? (String(value) as CopyStatus) : "draft";
}

function isValidSource(value: unknown): boolean {
  return (COPY_SOURCES as readonly string[]).includes(String(value));
}

export function normalizeCopySource(value: unknown): CopySource {
  return isValidSource(value) ? (String(value) as CopySource) : "manual";
}

export function normalizeCopywritingTags(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const tags: string[] = [];
  for (const raw of input) {
    const tag = clipText(raw, COPY_LIMITS.tag).trim();
    if (!tag || tags.includes(tag)) continue;
    tags.push(tag);
    if (tags.length >= COPY_LIMITS.tags) break;
  }
  return tags;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

/**
 * 归一化一条文案。标题与正文同时为空时返回 null（拒绝把空记录写进库）。
 * 保留传入的 createdAt / updatedAt，便于读盘时维持原时间。
 */
export function normalizeCopywritingItem(
  input: CopywritingItemInput | null | undefined,
): CopywritingItem | null {
  if (!input || typeof input !== "object") return null;
  const now = Date.now();
  const title = clipText(input.title, COPY_LIMITS.title).trim();
  const content = clipText(input.content, COPY_LIMITS.content).trim();
  if (!title && !content) return null;

  return {
    id: isValidCopywritingId(input.id) ? String(input.id) : randomUUID(),
    title: title || content.slice(0, 24),
    content,
    status: normalizeCopyStatus(input.status),
    tags: normalizeCopywritingTags(input.tags),
    brief: normalizeBrief(input.brief),
    source: normalizeCopySource(input.source),
    usedProviderName: clipText(
      input.usedProviderName,
      COPY_LIMITS.providerName,
    ).trim(),
    usedModel: clipText(input.usedModel, COPY_LIMITS.providerName).trim(),
    createdAt: normalizeTimestamp(input.createdAt, now),
    updatedAt: normalizeTimestamp(input.updatedAt, now),
  };
}

export function emptyCopywritingLibrary(): CopywritingLibrary {
  return { version: LIBRARY_VERSION, updatedAt: Date.now(), items: [] };
}

export function normalizeCopywritingLibrary(input: unknown): CopywritingLibrary {
  const src =
    input && typeof input === "object"
      ? (input as Record<string, unknown>)
      : {};
  const items: CopywritingItem[] = [];
  if (Array.isArray(src.items)) {
    for (const raw of src.items) {
      const item = normalizeCopywritingItem(raw as CopywritingItemInput);
      if (!item) continue;
      items.push(item);
      if (items.length >= COPY_LIMITS.items) break;
    }
  }
  return {
    version: LIBRARY_VERSION,
    updatedAt: normalizeTimestamp(src.updatedAt, Date.now()),
    items,
  };
}

export async function loadCopywritingLibrary(): Promise<CopywritingLibrary> {
  try {
    const raw = await readFile(libraryPath(), "utf-8");
    return normalizeCopywritingLibrary(JSON.parse(raw));
  } catch {
    // 文件不存在或损坏：返回空库（不静默伪造数据，仅视为"还没有文案"）
    return emptyCopywritingLibrary();
  }
}

async function writeLibrary(items: CopywritingItem[]): Promise<void> {
  const dir = libraryDir();
  await mkdir(dir, { recursive: true });
  const filePath = libraryPath();
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  const payload: CopywritingLibrary = {
    version: LIBRARY_VERSION,
    updatedAt: Date.now(),
    items: items.slice(0, COPY_LIMITS.items),
  };
  try {
    await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf-8");
    try {
      await rename(tempPath, filePath);
    } catch {
      // Windows 下目标文件被占用时 rename 会失败，先删除再改名
      await rm(filePath, { force: true });
      await rename(tempPath, filePath);
    }
  } catch (err) {
    try {
      await rm(tempPath, { force: true });
    } catch {}
    throw err;
  }
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const result = saveChain.then(task, task);
  saveChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** 新建或更新一条文案（按 id upsert），返回落库后的完整记录。 */
export function saveCopywritingItem(
  input: CopywritingItemInput,
): Promise<SaveCopywritingResult> {
  return enqueue(async () => {
    try {
      const normalized = normalizeCopywritingItem(input);
      if (!normalized) throw new Error("文案标题或正文不能为空");

      const library = await loadCopywritingLibrary();
      const existing =
        library.items.find((item) => item.id === normalized.id) ?? null;
      const item: CopywritingItem = {
        ...normalized,
        // 更新时不改变创建时间与来源（来源由首次生成/录入决定）
        createdAt: existing ? existing.createdAt : normalized.createdAt,
        source:
          existing && !isValidSource(input.source)
            ? existing.source
            : normalized.source,
        updatedAt: Date.now(),
      };

      const items = existing
        ? library.items.map((current) =>
            current.id === item.id ? item : current,
          )
        : [item, ...library.items];

      await writeLibrary(items);
      return { ok: true, item };
    } catch (err: unknown) {
      console.error("[saveCopywritingItem]", err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

export function deleteCopywritingItems(
  ids: string[],
): Promise<{ ok: boolean; removed: number; error?: string }> {
  // 注意：复用同一条串行链，避免与保存并发时产生丢更新
  return enqueue(async () => {
    try {
      const targets = new Set(
        (Array.isArray(ids) ? ids : []).filter(isValidCopywritingId),
      );
      if (targets.size === 0) return { ok: true, removed: 0 };

      const library = await loadCopywritingLibrary();
      const items = library.items.filter((item) => !targets.has(item.id));
      const removed = library.items.length - items.length;
      if (removed === 0) return { ok: true, removed: 0 };

      await writeLibrary(items);
      return { ok: true, removed };
    } catch (err: unknown) {
      console.error("[deleteCopywritingItems]", err);
      return {
        ok: false,
        removed: 0,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

export function deleteCopywritingItem(
  id: string,
): Promise<{ ok: boolean; removed: number; error?: string }> {
  return deleteCopywritingItems([String(id ?? "")]);
}