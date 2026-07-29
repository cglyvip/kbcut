import { create } from "zustand";
import {
  loadPermanentSettings,
  savePermanentSettings,
} from "./permanentSettings";

export interface LlmProviderLocal {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  enabled: boolean;
}

interface LlmState {
  providers: LlmProviderLocal[];
  minDuration: number;
  maxDuration: number;
  variantCount: number;
  topFluencyOnly: boolean;
  enableSubtitle: boolean;
  exportResolution: "720" | "1080" | "1440" | "source";
  rpmLimit: number;
  hydrated: boolean;
  setProviders: (list: LlmProviderLocal[]) => void;
  updateProvider: (id: string, partial: Partial<LlmProviderLocal>) => void;
  addProvider: () => void;
  removeProvider: (id: string) => void;
  moveProviderTop: (id: string) => void;
  promoteProvider: (id: string) => void;
  applyLocalPreset: (preset: {
    name?: string;
    baseUrl: string;
    apiKey?: string;
    model: string;
  }) => string;
  setMinDuration: (v: number) => void;
  setMaxDuration: (v: number) => void;
  setVariantCount: (v: number) => void;
  setTopFluencyOnly: (v: boolean) => void;
  setEnableSubtitle: (v: boolean) => void;
  setExportResolution: (v: "720" | "1080" | "1440" | "source") => void;
  setRpmLimit: (v: number) => void;
  hydrateFromDisk: () => Promise<void>;
}

const LLM_STORAGE_KEY = "cut-claude-llm-settings";
const LLM_PROVIDERS_KEY = "cut-claude-llm-providers";
const SUBTITLE_STORAGE_KEY = "cut-claude-enable-subtitle";
const TOP_FLUENCY_STORAGE_KEY = "cut-claude-top-fluency-only";
const EXPORT_PREFS_KEY = "cut-claude-export-prefs";
const EXPORT_RESOLUTION_KEY = "cut-claude-export-resolution";
const RPM_LIMIT_KEY = "cut-claude-llm-rpm-limit";

function uid() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function defaultProvider(
  partial?: Partial<LlmProviderLocal>,
): LlmProviderLocal {
  return {
    id: partial?.id || uid(),
    name: partial?.name || "主 API",
    baseUrl: partial?.baseUrl || "https://api.openai.com",
    apiKey: partial?.apiKey || "",
    model: partial?.model || "gpt-4o-mini",
    enabled: partial?.enabled ?? true,
  };
}

function promoteList(list: LlmProviderLocal[], id: string): LlmProviderLocal[] {
  const idx = list.findIndex((p) => p.id === id);
  if (idx <= 0) return list;
  const next = [...list];
  const [item] = next.splice(idx, 1);
  next.unshift(item!);
  return next;
}

function normalizeProviders(list: any[]): LlmProviderLocal[] {
  if (!Array.isArray(list) || list.length === 0) return [defaultProvider()];
  return list.map((p: any, i: number) => ({
    id: String(p.id || uid()),
    name: String(p.name || `API${i + 1}`),
    baseUrl: String(p.baseUrl || "https://api.openai.com"),
    apiKey: String(p.apiKey || ""),
    model: String(p.model || "gpt-4o-mini"),
    enabled: p.enabled !== false,
  }));
}

function loadProvidersFromLocalStorage(): LlmProviderLocal[] {
  try {
    const raw = localStorage.getItem(LLM_PROVIDERS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) return normalizeProviders(arr);
    }
  } catch {}

  try {
    const s = localStorage.getItem(LLM_STORAGE_KEY);
    if (s) {
      const old = JSON.parse(s);
      return [
        defaultProvider({
          name: "主 API",
          baseUrl: old.baseUrl,
          apiKey: old.apiKey,
          model: old.model,
          enabled: true,
        }),
      ];
    }
  } catch {}

  return [defaultProvider()];
}

function saveProvidersLocal(list: LlmProviderLocal[]) {
  // Keep non-secret fields as a fast cache. API keys live only in the encrypted disk settings.
  try {
    const safeList = list.map((provider) => ({ ...provider, apiKey: "" }));
    localStorage.setItem(LLM_PROVIDERS_KEY, JSON.stringify(safeList));
    const first = list.find((p) => p.enabled) || list[0];
    if (first) {
      localStorage.setItem(
        LLM_STORAGE_KEY,
        JSON.stringify({
          apiKey: "",
          baseUrl: first.baseUrl,
          model: first.model,
        }),
      );
    }
  } catch {}
}

function loadBool(key: string, defaultValue: boolean): boolean {
  try {
    const s = localStorage.getItem(key);
    if (s === null) return defaultValue;
    return s === "1" || s === "true";
  } catch {
    return defaultValue;
  }
}

function saveBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {}
}

function loadExportPrefs() {
  const defaults = { minDuration: 25, maxDuration: 55, variantCount: 5 };
  try {
    const s = localStorage.getItem(EXPORT_PREFS_KEY);
    if (!s) return defaults;
    const parsed = JSON.parse(s);
    return {
      minDuration: Number(parsed.minDuration) || 25,
      maxDuration: Number(parsed.maxDuration) || 55,
      variantCount: Number(parsed.variantCount) || 5,
    };
  } catch {
    return defaults;
  }
}

function loadExportResolution(): "720" | "1080" | "1440" | "source" {
  try {
    const s = localStorage.getItem(EXPORT_RESOLUTION_KEY);
    if (s === "720" || s === "1080" || s === "1440" || s === "source") return s;
  } catch {}
  return "1080";
}

function saveExportResolution(v: "720" | "1080" | "1440" | "source") {
  try {
    localStorage.setItem(EXPORT_RESOLUTION_KEY, v);
  } catch {}
}

function clampRpmLimit(v: number): number {
  return Math.max(1, Math.min(10, Math.round(Number(v) || 5)));
}

function loadRpmLimit(): number {
  try {
    return clampRpmLimit(Number(localStorage.getItem(RPM_LIMIT_KEY) || 5));
  } catch {
    return 5;
  }
}

function saveRpmLimit(v: number) {
  try {
    localStorage.setItem(RPM_LIMIT_KEY, String(clampRpmLimit(v)));
  } catch {}
}

function syncRpmLimit(v: number) {
  if (
    typeof window !== "undefined" &&
    typeof window.api?.setLlmRpmLimit === "function"
  ) {
    void window.api.setLlmRpmLimit(clampRpmLimit(v));
  }
}

function saveExportPrefs(prefs: {
  minDuration: number;
  maxDuration: number;
  variantCount: number;
}) {
  try {
    localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

function persistAll(state: {
  providers: LlmProviderLocal[];
  minDuration: number;
  maxDuration: number;
  variantCount: number;
  topFluencyOnly: boolean;
  enableSubtitle: boolean;
  exportResolution: "720" | "1080" | "1440" | "source";
  rpmLimit: number;
}) {
  saveProvidersLocal(state.providers);
  saveExportPrefs({
    minDuration: state.minDuration,
    maxDuration: state.maxDuration,
    variantCount: state.variantCount,
  });
  saveBool(TOP_FLUENCY_STORAGE_KEY, state.topFluencyOnly);
  saveBool(SUBTITLE_STORAGE_KEY, state.enableSubtitle);
  saveExportResolution(state.exportResolution);
  saveRpmLimit(state.rpmLimit);
  syncRpmLimit(state.rpmLimit);

  savePermanentSettings({
    llm: {
      providers: state.providers,
      minDuration: state.minDuration,
      maxDuration: state.maxDuration,
      variantCount: state.variantCount,
      topFluencyOnly: state.topFluencyOnly,
      enableSubtitle: state.enableSubtitle,
      exportResolution: state.exportResolution,
      rpmLimit: state.rpmLimit,
    },
  });
}

const initialPrefs = loadExportPrefs();

export const useLlmStore = create<LlmState>((set, get) => ({
  providers: loadProvidersFromLocalStorage(),
  minDuration: initialPrefs.minDuration,
  maxDuration: initialPrefs.maxDuration,
  variantCount: initialPrefs.variantCount,
  topFluencyOnly: loadBool(TOP_FLUENCY_STORAGE_KEY, true),
  enableSubtitle: loadBool(SUBTITLE_STORAGE_KEY, false),
  exportResolution: loadExportResolution(),
  rpmLimit: loadRpmLimit(),
  hydrated: false,

  hydrateFromDisk: async () => {
    if (get().hydrated) return;
    const disk = await loadPermanentSettings();
    const localProviders = loadProvidersFromLocalStorage();
    const localHasKey = localProviders.some((p) => !!p.apiKey?.trim());

    if (disk?.llm) {
      const diskProviders = normalizeProviders(disk.llm.providers || []);
      const diskHasKey = diskProviders.some((p) => !!p.apiKey?.trim());

      // Prefer disk if it already has keys; otherwise migrate localStorage keys onto disk
      const providers =
        diskHasKey || !localHasKey ? diskProviders : localProviders;
      const next = {
        providers,
        minDuration: Number(disk.llm.minDuration) || get().minDuration,
        maxDuration: Number(disk.llm.maxDuration) || get().maxDuration,
        variantCount: Number(disk.llm.variantCount) || get().variantCount,
        topFluencyOnly: disk.llm.topFluencyOnly !== false,
        enableSubtitle: !!disk.llm.enableSubtitle,
        rpmLimit: clampRpmLimit(Number(disk.llm.rpmLimit) || get().rpmLimit),
        exportResolution:
          disk.llm.exportResolution === "720" ||
          disk.llm.exportResolution === "1080" ||
          disk.llm.exportResolution === "1440" ||
          disk.llm.exportResolution === "source"
            ? disk.llm.exportResolution
            : get().exportResolution,
      };
      set({ ...next, hydrated: true });
      // always rewrite permanent settings so future launches keep them
      persistAll(next);
      return;
    }

    // no disk settings yet: migrate current local values to disk
    const next = {
      providers: localProviders,
      minDuration: get().minDuration,
      maxDuration: get().maxDuration,
      variantCount: get().variantCount,
      topFluencyOnly: get().topFluencyOnly,
      enableSubtitle: get().enableSubtitle,
      exportResolution: get().exportResolution,
      rpmLimit: get().rpmLimit,
    };
    set({ hydrated: true });
    persistAll(next);
  },

  setProviders: (list) => {
    const providers = normalizeProviders(list);
    const next = { ...pickPersist(get()), providers };
    set({ providers });
    persistAll(next);
  },
  updateProvider: (id, partial) => {
    const providers = get().providers.map((p) =>
      p.id === id ? { ...p, ...partial } : p,
    );
    const next = { ...pickPersist(get()), providers };
    set({ providers });
    persistAll(next);
  },
  addProvider: () => {
    const providers = get().providers;
    const list = [
      ...providers,
      defaultProvider({
        name: `候补 API${providers.length}`,
        baseUrl: providers[0]?.baseUrl,
        model: providers[0]?.model,
      }),
    ];
    const next = { ...pickPersist(get()), providers: list };
    set({ providers: list });
    persistAll(next);
  },
  removeProvider: (id) => {
    const providers = get().providers;
    if (providers.length <= 1) return;
    const list = providers.filter((p) => p.id !== id);
    const next = { ...pickPersist(get()), providers: list };
    set({ providers: list });
    persistAll(next);
  },
  moveProviderTop: (id) => {
    const list = promoteList(get().providers, id);
    const next = { ...pickPersist(get()), providers: list };
    set({ providers: list });
    persistAll(next);
  },
  promoteProvider: (id) => {
    const list = promoteList(get().providers, id);
    const next = { ...pickPersist(get()), providers: list };
    set({ providers: list });
    persistAll(next);
  },
  applyLocalPreset: (preset) => {
    const baseUrl = String(preset.baseUrl || "")
      .trim()
      .replace(/\/$/, "");
    const model = String(preset.model || "").trim();
    const apiKey = String(preset.apiKey || "ollama").trim() || "ollama";
    const name = String(preset.name || `本地-${model || "LLM"}`).trim();
    if (!baseUrl || !model) return "";

    const providers = get().providers;
    const sameIdx = providers.findIndex((p) => {
      const a = String(p.baseUrl || "")
        .trim()
        .replace(/\/$/, "")
        .toLowerCase();
      const b = baseUrl.toLowerCase();
      return (
        a === b &&
        String(p.model || "")
          .trim()
          .toLowerCase() === model.toLowerCase()
      );
    });

    let list: LlmProviderLocal[];
    let targetId = "";
    if (sameIdx >= 0) {
      const existing = providers[sameIdx]!;
      targetId = existing.id;
      const updated = {
        ...existing,
        name: name || existing.name,
        baseUrl,
        apiKey: apiKey || existing.apiKey,
        model,
        enabled: true,
      };
      list = providers.map((p, i) => (i === sameIdx ? updated : p));
      list = promoteList(list, targetId);
    } else {
      const created = defaultProvider({
        name,
        baseUrl,
        apiKey,
        model,
        enabled: true,
      });
      targetId = created.id;
      list = [created, ...providers];
    }

    const next = { ...pickPersist(get()), providers: list };
    set({ providers: list });
    persistAll(next);
    return targetId;
  },
  setMinDuration: (v) => {
    const minDuration = Math.max(1, v || 1);
    const next = { ...pickPersist(get()), minDuration };
    set({ minDuration });
    persistAll(next);
  },
  setMaxDuration: (v) => {
    const maxDuration = Math.max(1, v || 1);
    const next = { ...pickPersist(get()), maxDuration };
    set({ maxDuration });
    persistAll(next);
  },
  setVariantCount: (v) => {
    const variantCount = Math.max(1, Math.min(20, v || 1));
    const next = { ...pickPersist(get()), variantCount };
    set({ variantCount });
    persistAll(next);
  },
  setTopFluencyOnly: (v) => {
    const next = { ...pickPersist(get()), topFluencyOnly: v };
    set({ topFluencyOnly: v });
    persistAll(next);
  },
  setEnableSubtitle: (v) => {
    const next = { ...pickPersist(get()), enableSubtitle: v };
    set({ enableSubtitle: v });
    persistAll(next);
  },
  setExportResolution: (v) => {
    const exportResolution =
      v === "720" || v === "1080" || v === "1440" || v === "source"
        ? v
        : "1080";
    const next = { ...pickPersist(get()), exportResolution };
    set({ exportResolution });
    persistAll(next);
  },
  setRpmLimit: (v) => {
    const rpmLimit = clampRpmLimit(v);
    const next = { ...pickPersist(get()), rpmLimit };
    set({ rpmLimit });
    persistAll(next);
  },
}));

function pickPersist(state: LlmState) {
  return {
    providers: state.providers,
    minDuration: state.minDuration,
    maxDuration: state.maxDuration,
    variantCount: state.variantCount,
    topFluencyOnly: state.topFluencyOnly,
    enableSubtitle: state.enableSubtitle,
    exportResolution: state.exportResolution,
    rpmLimit: state.rpmLimit,
  };
}
