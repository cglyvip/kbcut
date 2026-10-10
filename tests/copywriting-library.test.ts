import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({ userDataDir: "" }));

vi.mock("electron", () => ({
  app: {
    getPath: () => electronState.userDataDir,
  },
}));

import {
  COPY_LIMITS,
  deleteCopywritingItem,
  deleteCopywritingItems,
  emptyCopywritingLibrary,
  loadCopywritingLibrary,
  normalizeCopywritingItem,
  saveCopywritingItem,
} from "../src/main/services/copywriting-library";

let testDir = "";

async function freshDir(): Promise<string> {
  testDir = await mkdtemp(join(tmpdir(), "kbcut-copywriting-test-"));
  electronState.userDataDir = testDir;
  return testDir;
}

function libraryFile(dir: string): string {
  return join(dir, "copywriting", "library.json");
}

afterEach(async () => {
  if (testDir) await rm(testDir, { recursive: true, force: true });
  testDir = "";
});

describe("copywriting library", () => {
  it("creates a record on disk and reads it back", async () => {
    const dir = await freshDir();
    await mkdir(join(dir, "copywriting"), { recursive: true });

    const saved = await saveCopywritingItem({
      title: "厨房油污一喷就化",
      content: "灶台油污擦不掉？\n喷一喷等 30 秒，一擦就干净。\n点左下角直接拍。",
      status: "ready",
      tags: ["厨房", "去油", "厨房"],
      brief: { productName: "去油喷雾", price: "39.9", cta: "点左下角" },
      source: "manual",
    });

    expect(saved.ok).toBe(true);
    expect(saved.item?.id).toBeTruthy();
    expect(saved.item?.tags).toEqual(["厨房", "去油"]);

    const raw = JSON.parse(await readFile(libraryFile(dir), "utf-8"));
    expect(raw.items).toHaveLength(1);
    expect(raw.items[0].title).toBe("厨房油污一喷就化");

    const loaded = await loadCopywritingLibrary();
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0]!.content).toContain("30 秒");
    expect(loaded.items[0]!.brief.productName).toBe("去油喷雾");
    expect(loaded.items[0]!.createdAt).toBeGreaterThan(0);
  });

  it("updates by id without duplicating and keeps createdAt", async () => {
    await freshDir();
    const first = await saveCopywritingItem({
      title: "第一版",
      content: "第一版正文",
    });
    const id = first.item!.id;

    const second = await saveCopywritingItem({
      id,
      title: "第二版",
      content: "第二版正文",
    });

    expect(second.ok).toBe(true);
    expect(second.item?.id).toBe(id);
    expect(second.item?.createdAt).toBe(first.item!.createdAt);
    expect(second.item!.updatedAt).toBeGreaterThanOrEqual(
      first.item!.updatedAt,
    );

    const loaded = await loadCopywritingLibrary();
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0]!.title).toBe("第二版");
  });

  it("serializes concurrent saves so nothing is lost", async () => {
    await freshDir();
    await Promise.all([
      saveCopywritingItem({ title: "A", content: "A 正文" }),
      saveCopywritingItem({ title: "B", content: "B 正文" }),
      saveCopywritingItem({ title: "C", content: "C 正文" }),
    ]);

    const loaded = await loadCopywritingLibrary();
    expect(loaded.items).toHaveLength(3);
    expect(loaded.items.map((item) => item.title).sort()).toEqual([
      "A",
      "B",
      "C",
    ]);
  });

  it("rejects a record whose title and content are both empty", async () => {
    await freshDir();
    const result = await saveCopywritingItem({ title: "   ", content: "" });
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    const loaded = await loadCopywritingLibrary();
    expect(loaded.items).toHaveLength(0);
  });

  it("deletes single and multiple records", async () => {
    await freshDir();
    const a = await saveCopywritingItem({ title: "A", content: "A" });
    const b = await saveCopywritingItem({ title: "B", content: "B" });
    const c = await saveCopywritingItem({ title: "C", content: "C" });

    expect((await deleteCopywritingItem(a.item!.id)).removed).toBe(1);
    expect((await deleteCopywritingItems([b.item!.id, c.item!.id])).removed).toBe(
      2,
    );

    const loaded = await loadCopywritingLibrary();
    expect(loaded.items).toHaveLength(0);
  });

  it("returns an empty library when the file is missing or corrupted", async () => {
    const dir = await freshDir();
    expect((await loadCopywritingLibrary()).items).toEqual([]);

    await mkdir(join(dir, "copywriting"), { recursive: true });
    await writeFile(libraryFile(dir), "{ not json", "utf-8");
    expect((await loadCopywritingLibrary()).items).toEqual([]);

    expect(emptyCopywritingLibrary().items).toEqual([]);
  });

  it("normalizes oversized and invalid fields", () => {
    const item = normalizeCopywritingItem({
      title: "标".repeat(COPY_LIMITS.title + 50),
      content: "文".repeat(COPY_LIMITS.content + 50),
      status: "乱七八糟",
      tags: ["a".repeat(COPY_LIMITS.tag + 10), "", "  b  "],
      source: "unknown",
      brief: { productName: "商".repeat(COPY_LIMITS.briefField + 10) },
    });

    expect(item).not.toBeNull();
    expect(item!.title.length).toBe(COPY_LIMITS.title);
    expect(item!.content.length).toBe(COPY_LIMITS.content);
    expect(item!.status).toBe("draft");
    expect(item!.source).toBe("manual");
    expect(item!.tags).toEqual(["a".repeat(COPY_LIMITS.tag), "b"]);
    expect(item!.brief.productName.length).toBe(COPY_LIMITS.briefField);
    expect(item!.brief.price).toBe("");
  });

  it("drops empty records when loading an existing file", async () => {
    const dir = await freshDir();
    await mkdir(join(dir, "copywriting"), { recursive: true });
    await writeFile(
      libraryFile(dir),
      JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        items: [{ title: "", content: "" }, { title: "保留", content: "x" }],
      }),
      "utf-8",
    );

    const loaded = await loadCopywritingLibrary();
    expect(loaded.items).toHaveLength(1);
    expect(loaded.items[0]!.title).toBe("保留");
  });
});