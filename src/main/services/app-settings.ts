import { app, safeStorage } from "electron";
import { join } from "path";
import { mkdir, readFile, writeFile, rename, rm } from "fs/promises";
import { randomUUID } from "crypto";

export interface PersistedLlmProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

export interface PersistedAppSettings {
  version: number;
  updatedAt: number;
  llm: {
    providers: PersistedLlmProvider[];
    minDuration: number;
    maxDuration: number;
    variantCount: number;
    topFluencyOnly: boolean;
    enableSubtitle: boolean;
    exportResolution: "720" | "1080" | "1440" | "source";
    rpmLimit: number;
  };
  asr: {
    mode: "online" | "local";
    apiKey: string;
    baseUrl: string;
    model: string;
    remoteHost: string;
    modelCacheDir: string;
  };
  outputDir: string;
}

export type PersistedAppSettingsPatch = Omit<
  Partial<PersistedAppSettings>,
  "llm" | "asr"
> & {
  llm?: Partial<PersistedAppSettings["llm"]>;
  asr?: Partial<PersistedAppSettings["asr"]>;
};

const SETTINGS_VERSION = 1;
const FILE_NAME = "app-settings.json";
let saveChain: Promise<void> = Promise.resolve();

function clampNumber(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  integer = false,
): number {
  const number = Number(value);
  const safe = Number.isFinite(number) ? number : fallback;
  const clamped = Math.max(min, Math.min(max, safe));
  return integer ? Math.round(clamped) : clamped;
}

function settingsPath(): string {
  return join(app.getPath("userData"), "settings", FILE_NAME);
}

function canEncrypt(): boolean {
  try {
    return (
      typeof safeStorage?.isEncryptionAvailable === "function" &&
      safeStorage.isEncryptionAvailable()
    );
  } catch {
    return false;
  }
}

function sealSecret(value: string): string {
  const text = String(value || "");
  if (!text) return "";
  // 已经是密文则原样返回，避免双重加密（openSecret 解密失败时会保留 enc: 前缀）
  if (text.startsWith("enc:")) return text;
  if (!canEncrypt()) return text;
  try {
    const buf = safeStorage.encryptString(text);
    return `enc:${buf.toString("base64")}`;
  } catch {
    return text;
  }
}

function openSecret(value: string): string {
  const text = String(value || "");
  if (!text) return "";
  if (!text.startsWith("enc:")) return text;
  // 解密不可用时返回原始密文，避免 API Key 永久丢失。
  // 上层 normalizeSettings 会把 enc: 前缀的值原样保存，下次加密恢复后仍可解密。
  if (!canEncrypt()) {
    console.warn("[app-settings] safeStorage 不可用，API Key 保留为密文");
    return text;
  }
  try {
    const raw = Buffer.from(text.slice(4), "base64");
    return safeStorage.decryptString(raw);
  } catch (err) {
    // 解密失败也保留密文，避免数据丢失
    console.warn("[app-settings] API Key 解密失败，保留密文:", err);
    return text;
  }
}

function defaultSettings(): PersistedAppSettings {
  return {
    version: SETTINGS_VERSION,
    updatedAt: Date.now(),
    llm: {
      providers: [
        {
          id: "p_default",
          name: "主 API",
          baseUrl: "https://api.openai.com",
          apiKey: "",
          model: "gpt-4o-mini",
          enabled: true,
        },
      ],
      minDuration: 25,
      maxDuration: 55,
      variantCount: 5,
      topFluencyOnly: true,
      enableSubtitle: false,
      exportResolution: "1080",
      rpmLimit: 5,
    },
    asr: {
      mode: "online",
      apiKey: "",
      baseUrl: "https://api.openai.com",
      model: "whisper-1",
      remoteHost: "https://hf-mirror.com",
      modelCacheDir: "",
    },
    outputDir: "",
  };
}

function normalizeSettings(input: any): PersistedAppSettings {
  const base = defaultSettings();
  const src = input && typeof input === "object" ? input : {};

  const providersRaw = Array.isArray(src?.llm?.providers)
    ? src.llm.providers.slice(0, 20)
    : base.llm.providers;
  const providers = providersRaw.map((p: any, i: number) => ({
    id: String(p?.id || `p_${i + 1}`),
    name: String(p?.name || `API${i + 1}`),
    baseUrl: String(p?.baseUrl || "https://api.openai.com"),
    apiKey: openSecret(String(p?.apiKey || "")),
    model: String(p?.model || "gpt-4o-mini"),
    enabled: p?.enabled !== false,
  }));

  const minDuration = clampNumber(
    src?.llm?.minDuration,
    base.llm.minDuration,
    1,
    600,
  );
  const maxDuration = Math.max(
    minDuration,
    clampNumber(src?.llm?.maxDuration, base.llm.maxDuration, 1, 600),
  );

  return {
    version: SETTINGS_VERSION,
    updatedAt: Number(src.updatedAt) || Date.now(),
    llm: {
      providers: providers.length > 0 ? providers : base.llm.providers,
      minDuration,
      maxDuration,
      variantCount: clampNumber(
        src?.llm?.variantCount,
        base.llm.variantCount,
        1,
        20,
        true,
      ),
      topFluencyOnly: src?.llm?.topFluencyOnly !== false,
      enableSubtitle: !!src?.llm?.enableSubtitle,
      rpmLimit: clampNumber(src?.llm?.rpmLimit, 5, 5, 10, true),
      exportResolution:
        src?.llm?.exportResolution === "720" ||
        src?.llm?.exportResolution === "1080" ||
        src?.llm?.exportResolution === "1440" ||
        src?.llm?.exportResolution === "source"
          ? src.llm.exportResolution
          : "1080",
    },
    asr: {
      mode: src?.asr?.mode === "local" ? "local" : "online",
      apiKey: openSecret(String(src?.asr?.apiKey || "")),
      baseUrl: String(src?.asr?.baseUrl || base.asr.baseUrl),
      model: String(src?.asr?.model || base.asr.model),
      remoteHost:
        src?.asr?.remoteHost === "https://hf-mirror.com" ||
        src?.asr?.remoteHost === "https://huggingface.co"
          ? src.asr.remoteHost
          : "https://hf-mirror.com",
      modelCacheDir: String(src?.asr?.modelCacheDir || "").slice(0, 32768),
    },
    outputDir: String(src?.outputDir || "").slice(0, 32768),
  };
}

function toDiskPayload(settings: PersistedAppSettings): any {
  return {
    version: SETTINGS_VERSION,
    updatedAt: Date.now(),
    llm: {
      ...settings.llm,
      providers: (settings.llm.providers || []).map((p) => ({
        ...p,
        apiKey: sealSecret(p.apiKey || ""),
      })),
    },
    asr: {
      ...settings.asr,
      apiKey: sealSecret(settings.asr.apiKey || ""),
    },
    outputDir: settings.outputDir || "",
  };
}

async function ensureDir(): Promise<void> {
  await mkdir(join(app.getPath("userData"), "settings"), { recursive: true });
}

export async function loadAppSettings(): Promise<PersistedAppSettings> {
  try {
    const raw = await readFile(settingsPath(), "utf-8");
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

async function saveAppSettingsInternal(
  partial: PersistedAppSettingsPatch,
): Promise<{ ok: boolean; settings?: PersistedAppSettings; error?: string }> {
  let tempPath = "";
  try {
    const current = await loadAppSettings();
    const next: PersistedAppSettings = {
      version: SETTINGS_VERSION,
      updatedAt: Date.now(),
      llm: {
        ...current.llm,
        ...(partial.llm || {}),
      },
      asr: {
        ...current.asr,
        ...(partial.asr || {}),
      },
      outputDir:
        partial.outputDir !== undefined
          ? String(partial.outputDir || "")
          : current.outputDir,
    };

    // If providers provided, replace whole list
    if (partial.llm?.providers) {
      next.llm.providers = partial.llm.providers.map((p, i) => ({
        id: String(p.id || `p_${i + 1}`),
        name: String(p.name || `API${i + 1}`),
        baseUrl: String(p.baseUrl || "https://api.openai.com"),
        apiKey: String(p.apiKey || ""),
        model: String(p.model || "gpt-4o-mini"),
        enabled: p.enabled !== false,
      }));
    }

    const normalized = normalizeSettings(next);
    normalized.updatedAt = Date.now();

    await ensureDir();
    const filePath = settingsPath();
    tempPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(
      tempPath,
      JSON.stringify(toDiskPayload(normalized), null, 2),
      "utf-8",
    );
    try {
      await rename(tempPath, filePath);
    } catch {
      await rm(filePath, { force: true });
      await rename(tempPath, filePath);
    }
    return { ok: true, settings: normalized };
  } catch (err: unknown) {
    if (tempPath) {
      try {
        await rm(tempPath, { force: true });
      } catch {}
    }
    console.error("[saveAppSettings]", err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function saveAppSettings(
  partial: PersistedAppSettingsPatch,
): Promise<{ ok: boolean; settings?: PersistedAppSettings; error?: string }> {
  const run = () => saveAppSettingsInternal(partial);
  const result = saveChain.then(run, run);
  saveChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function getAppSettingsPath(): string {
  return settingsPath();
}
