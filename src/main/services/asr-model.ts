import { app } from "electron";
import { join, dirname } from "path";
import { mkdir, readdir, stat, access } from "fs/promises";
import { loadAppSettings } from "./app-settings";

const MODEL_ID = "onnx-community/whisper-small";
const MODEL_DIR_NAME = "whisper-small";

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

function getDefaultModelDir(): string {
  // Packaged installs use the read-only resources bundled by electron-builder.
  // Dev mode keeps using <project-parent>/models so the local cache can be shared.
  if (app.isPackaged) {
    return join(process.resourcesPath, "models", MODEL_DIR_NAME);
  }
  const devRoot = dirname(app.getAppPath());
  return join(devRoot, "models", MODEL_DIR_NAME);
}

export async function getWhisperModelCacheDir(): Promise<string> {
  const settings = await loadAppSettings();
  const custom = settings.asr.modelCacheDir?.trim();
  if (custom) return custom;
  return getDefaultModelDir();
}

export function getWhisperModelCacheDirSync(): string {
  // Synchronous fallback for cases where settings are already loaded.
  // Returns the default path; callers that need custom path should use async version.
  return getDefaultModelDir();
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
  mirrorUrl: string;
  officialUrl: string;
}> {
  const cacheDir = await getWhisperModelCacheDir();
  await mkdir(cacheDir, { recursive: true });

  const stats = await directoryStats(cacheDir);

  // Check each required file
  const modelSubDir = join(cacheDir, "onnx-community", "whisper-small");
  const missingFiles: string[] = [];
  for (const file of REQUIRED_MODEL_FILES) {
    const filePath = join(modelSubDir, file);
    if (!(await fileExists(filePath))) {
      missingFiles.push(file);
    }
  }

  // Check for interrupted downloads (.tmp files)
  const hasTemporaryFiles = await findTempFiles(cacheDir);

  return {
    modelId: MODEL_ID,
    cacheDir,
    downloaded: missingFiles.length === 0,
    fileCount: stats.fileCount,
    sizeBytes: stats.sizeBytes,
    missingFiles,
    hasTemporaryFiles,
    mirrorUrl: `https://hf-mirror.com/${MODEL_ID}`,
    officialUrl: `https://huggingface.co/${MODEL_ID}`,
  };
}
