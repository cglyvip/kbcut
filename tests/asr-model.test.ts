import { mkdir, mkdtemp, rm, writeFile, stat } from "fs/promises";
import { tmpdir } from "os";
import { dirname, join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({ userDataDir: "" }));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getPath: () => electronState.userDataDir,
    getAppPath: () => electronState.userDataDir,
  },
  safeStorage: { isEncryptionAvailable: () => false },
}));

import {
  ensureModelLayout,
  inspectModelLayout,
} from "../src/main/services/asr-model";

const REQUIRED = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_q4.onnx",
  "onnx/decoder_model_merged_q4.onnx",
];

const NESTED = join("onnx-community", "whisper-small");

let testDir = "";

async function writeFiles(baseDir: string, files: string[]): Promise<void> {
  for (const file of files) {
    const target = join(baseDir, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `stub:${file}`, "utf-8");
  }
}

afterEach(async () => {
  if (testDir) await rm(testDir, { recursive: true, force: true });
  testDir = "";
});

describe("whisper model layout detection", () => {
  it("reports the transformers cache layout as ready", async () => {
    testDir = await mkdtemp(join(tmpdir(), "kbcut-model-nested-"));
    await writeFiles(join(testDir, NESTED), REQUIRED);

    const result = await inspectModelLayout(testDir);

    expect(result.layout).toBe("nested");
    expect(result.missingFiles).toEqual([]);
  });

  it("recognizes a flat manual download of the repo", async () => {
    testDir = await mkdtemp(join(tmpdir(), "kbcut-model-flat-"));
    await writeFiles(testDir, REQUIRED);

    const result = await inspectModelLayout(testDir);

    expect(result.layout).toBe("flat");
    expect(result.missingFiles).toEqual([]);
  });

  it("names the missing weights instead of only reporting a total size", async () => {
    testDir = await mkdtemp(join(tmpdir(), "kbcut-model-partial-"));
    await writeFiles(
      join(testDir, NESTED),
      REQUIRED.filter((file) => !file.startsWith("onnx/")),
    );

    const result = await inspectModelLayout(testDir);

    expect(result.layout).toBe("incomplete");
    expect(result.missingFiles).toEqual([
      "onnx/encoder_model_q4.onnx",
      "onnx/decoder_model_merged_q4.onnx",
    ]);
  });

  it("treats a large but incomplete cache as not ready", async () => {
    testDir = await mkdtemp(join(tmpdir(), "kbcut-model-decoy-"));
    // Plenty of bytes, but none of them are the files inference needs.
    await writeFiles(join(testDir, NESTED, "onnx"), [
      "encoder_model_fp16.onnx",
      "decoder_model_int8.onnx",
    ]);

    const result = await inspectModelLayout(testDir);

    expect(result.layout).toBe("incomplete");
    expect(result.missingFiles).toEqual(REQUIRED);
  });
});

describe("whisper model layout migration", () => {
  it("materializes the nested layout a flat download is missing", async () => {
    testDir = await mkdtemp(join(tmpdir(), "kbcut-model-migrate-"));
    await writeFiles(testDir, REQUIRED);

    expect(await ensureModelLayout(testDir)).toBe("nested");

    const migrated = await inspectModelLayout(testDir);
    expect(migrated.layout).toBe("nested");
    for (const file of REQUIRED) {
      expect((await stat(join(testDir, NESTED, file))).size).toBeGreaterThan(0);
    }
  });

  it("leaves an already-nested cache untouched", async () => {
    testDir = await mkdtemp(join(tmpdir(), "kbcut-model-noop-"));
    await writeFiles(join(testDir, NESTED), REQUIRED);

    expect(await ensureModelLayout(testDir)).toBe("nested");
    // Nothing was copied up to the cache root.
    await expect(stat(join(testDir, "config.json"))).rejects.toThrow();
  });

  it("does not invent files when the download is incomplete", async () => {
    testDir = await mkdtemp(join(tmpdir(), "kbcut-model-incomplete-"));
    await writeFiles(testDir, ["config.json"]);

    expect(await ensureModelLayout(testDir)).toBe("incomplete");
    await expect(stat(join(testDir, NESTED, "config.json"))).rejects.toThrow();
  });
});
