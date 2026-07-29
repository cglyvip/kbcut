import { mkdtemp, readdir, rm, writeFile } from "fs/promises";
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
  deleteBatchCheckpoint,
  loadBatchCheckpoint,
  saveBatchCheckpoint,
} from "../src/main/services/batch-checkpoint";

let testDir = "";

afterEach(async () => {
  if (testDir) await rm(testDir, { recursive: true, force: true });
  testDir = "";
});

describe("batch checkpoints", () => {
  it("atomically overwrites, loads, and deletes a checkpoint", async () => {
    testDir = await mkdtemp(join(tmpdir(), "kbcut-checkpoint-test-"));
    electronState.userDataDir = testDir;

    const taskId = "task_001";
    const first = await saveBatchCheckpoint(taskId, {
      checkpoint: "asr_done",
      asrSegments: [{ start: 0, end: 1, text: "第一句" }],
      asrMs: 1200,
    });
    expect(first.ok).toBe(true);

    const second = await saveBatchCheckpoint(taskId, {
      checkpoint: "generate_done",
      variants: [{ id: 1, name: "爆款1", segments: [] }],
      usedProviderName: "主 API",
      usedModelName: "actual-model-v2",
      modelUsages: [
        {
          providerId: "p1",
          providerName: "主 API",
          model: "actual-model-v2",
          requestCount: 2,
          inputTokens: 1200,
          outputTokens: 180,
          estimated: false,
        },
      ],
      generateMs: 2300,
    });
    expect(second.ok).toBe(true);

    const loaded = await loadBatchCheckpoint(taskId);
    expect(loaded?.checkpoint).toBe("generate_done");
    expect(loaded?.variants?.[0]?.name).toBe("爆款1");
    expect(loaded?.usedModelName).toBe("actual-model-v2");
    expect(loaded?.modelUsages?.[0]?.inputTokens).toBe(1200);

    const files = await readdir(join(testDir, "batch-checkpoints"));
    expect(files).toEqual([`${taskId}.json`]);

    expect((await deleteBatchCheckpoint(taskId)).ok).toBe(true);
    expect(await loadBatchCheckpoint(taskId)).toBeNull();
  });

  it("rejects corrupted checkpoints belonging to another task", async () => {
    testDir = await mkdtemp(join(tmpdir(), "kbcut-checkpoint-test-"));
    electronState.userDataDir = testDir;
    const taskId = "task_002";
    await saveBatchCheckpoint(taskId, {
      checkpoint: "asr_done",
      asrSegments: [{ start: 0, end: 1, text: "有效识别" }],
    });

    await writeFile(
      join(testDir, "batch-checkpoints", `${taskId}.json`),
      JSON.stringify({
        taskId: "other_task",
        checkpoint: "asr_done",
        updatedAt: Date.now(),
      }),
      "utf-8",
    );

    expect(await loadBatchCheckpoint(taskId)).toBeNull();
  });

  it("rejects incomplete payloads and unsafe task ids", async () => {
    testDir = await mkdtemp(join(tmpdir(), "kbcut-checkpoint-test-"));
    electronState.userDataDir = testDir;

    expect(
      (
        await saveBatchCheckpoint("task_003", {
          checkpoint: "asr_done",
          asrSegments: [],
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await saveBatchCheckpoint("../task", {
          checkpoint: "none",
        })
      ).ok,
    ).toBe(false);
  });
});
