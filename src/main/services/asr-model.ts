import { app } from "electron";
import { join, dirname } from "path";
import { mkdir, readdir, stat, access, link, copyFile } from "fs/promises";
import { loadAppSettings } from "./app-settings";

const MODEL_ID = "onnx-community/whisper-small";
const MODEL_DIR_NAME = "whisper-small";

/** Sub-path transformers.js reads model files from inside the cache directory. */
const MODEL_SUBDIR = join("onnx-community", "whisper-small");

/**
 * Files required for local Whisper inference with dtype q4.
 * Paths are relative to <cacheDir>/onnx-community/whisper-small/
 */
const REQUIRED_MODEL_FILES = [
  "config.json",
  "generation_config.json",
  "preprocessor_config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/encoder_model_q4.onnx",
  "onnx/decoder_model_merged_q4.onnx",
];

function getBundledModelDir(): string | null {
  // Full installs bundle the model as a read-only Electron resource.
  return app.isPackaged
    ? join(process.resourcesPath, "models", MODEL_DIR_NAME)
    : null;
}

function getLegacyPackagedModelDir(): string {
  // Versions before 1.0.4 placed the cache beside the executable.
  return join(dirname(app.getPath("exe")), "models", MODEL_DIR_NAME);
}

function getDevModelDir(): string {
  const devRoot = dirname(app.getAppPath());
  return join(devRoot, "models", MODEL_DIR_NAME);
}

function getDownloadModelDir(): string {
  // Lite installs have no bundled model, so downloads need a writable directory.
  return join(app.getPath("userData"), "models", MODEL_DIR_NAME);
}

async function hasRequiredModelFiles(modelDir: string): Promise<boolean> {
  return (await missingFilesUnder(join(modelDir, MODEL_SUBDIR))).length === 0;
}

/** Which of REQUIRED_MODEL_FILES are absent under the given base directory. */
async function missingFilesUnder(baseDir: string): Promise<string[]> {
  const missing: string[] = [];
  for (const file of REQUIRED_MODEL_FILES) {
    if (!(await fileExists(join(baseDir, file)))) missing.push(file);
  }
  return missing;
}

export async function getDefaultModelDir(): Promise<string> {
  if (!app.isPackaged) return getDevModelDir();

  const candidates = [getBundledModelDir(), getLegacyPackagedModelDir()];
  for (const candidate of candidates) {
    if (candidate && (await hasRequiredModelFiles(candidate))) return candidate;
  }
  return getDownloadModelDir();
}

export async function getWhisperModelCacheDir(): Promise<string> {
  const settings = await loadAppSettings();
  const custom = settings.asr.modelCacheDir?.trim();
  if (custom) return custom;
  return getDefaultModelDir();
}


export type ModelLayout = "nested" | "flat" | "incomplete";

/**
 * transformers.js only reads <cacheDir>/onnx-community/whisper-small/. A manual
 * download of the repo lands flat in <cacheDir>/ instead, so report which of the
 * two layouts is present and what is still missing from the better one.
 */
export async function inspectModelLayout(cacheDir: string): Promise<{
  layout: ModelLayout;
  missingFiles: string[];
}> {
  const nestedMissing = await missingFilesUnder(join(cacheDir, MODEL_SUBDIR));
  if (nestedMissing.length === 0) return { layout: "nested", missingFiles: [] };

  const flatMissing = await missingFilesUnder(cacheDir);
  if (flatMissing.length === 0) return { layout: "flat", missingFiles: [] };

  return {
    layout: "incomplete",
    missingFiles:
      flatMissing.length < nestedMissing.length ? flatMissing : nestedMissing,
  };
}

/**
 * Make a flat manual download loadable by materializing the nested layout that
 * transformers.js expects. Hard links keep this instant and free on the same
 * volume; a copy is the fallback across volumes. No-op for other layouts.
 */
export async function ensureModelLayout(cacheDir: string): Promise<ModelLayout> {
  const { layout } = await inspectModelLayout(cacheDir);
  if (layout !== "flat") return layout;

  for (const file of REQUIRED_MODEL_FILES) {
    const source = join(cacheDir, file);
    const target = join(cacheDir, MODEL_SUBDIR, file);
    if (await fileExists(target)) continue;
    await mkdir(dirname(target), { recursive: true });
    try {
      await link(source, target);
    } catch {
      await copyFile(source, target);
    }
  }
  return "nested";
}

async function directoryStats(
  directory: string,
): Promise<{ fileCount: number; sizeBytes: number }> {
  let fileCount = 0;
  let sizeBytes = 0;
  try {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        const nested = await directoryStats(entryPath);
        fileCount += nested.fileCount;
        sizeBytes += nested.sizeBytes;
      } else if (entry.isFile()) {
        const file = await stat(entryPath);
        fileCount++;
        sizeBytes += file.size;
      }
    }
  } catch {}
  return { fileCount, sizeBytes };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function findTempFiles(directory: string): Promise<boolean> {
  try {
    const entries = await readdir(directory, { recursive: true });
    return entries.some(
      (entry) =>
        typeof entry === "string" && entry.includes(".tmp."),
    );
  } catch {
    return false;
  }
}

export async function getWhisperModelInfo(): Promise<{
  modelId: string;
  cacheDir: string;
  downloaded: boolean;
  fileCount: number;
  sizeBytes: number;
  missingFiles: string[];
  hasTemporaryFiles: boolean;
  layout: ModelLayout;
  mirrorUrl: string;
  officialUrl: string;
}> {
  const cacheDir = await getWhisperModelCacheDir();
  await mkdir(cacheDir, { recursive: true });

  const stats = await directoryStats(cacheDir);
  const { layout, missingFiles } = await inspectModelLayout(cacheDir);
  const hasTemporaryFiles = await findTempFiles(cacheDir);

  return {
    modelId: MODEL_ID,
    cacheDir,
    downloaded: missingFiles.length === 0,
    fileCount: stats.fileCount,
    sizeBytes: stats.sizeBytes,
    missingFiles,
    hasTemporaryFiles,
    layout,
    mirrorUrl: `https://hf-mirror.com/${MODEL_ID}`,
    officialUrl: `https://huggingface.co/${MODEL_ID}`,
  };
}
