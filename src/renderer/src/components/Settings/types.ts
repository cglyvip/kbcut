export interface AsrModelInfoView {
  modelId: string;
  cacheDir: string;
  downloaded: boolean;
  fileCount: number;
  sizeBytes: number;
  missingFiles: string[];
  hasTemporaryFiles: boolean;
  mirrorUrl: string;
  officialUrl: string;
}

export interface LocalModelAdviceView {
  hardware: {
    cpuModel: string;
    cpuCores: number;
    totalMemGB: number;
    freeMemGB: number;
    gpuName: string;
    hasNvidia: boolean;
    vramGB: number | null;
  };
  runtime: {
    preferredRuntime?: "ollama" | "lmstudio";
    apps?: Array<{
      id: "ollama" | "lmstudio";
      name: string;
      recommended: boolean;
      running: boolean;
      baseUrl: string;
      defaultApiKey: string;
      downloadUrl: string;
      docsUrl: string;
      description: string;
      installSteps: string[];
      envRequirements: string[];
      models: string[];
    }>;
    ollama: { running: boolean; baseUrl: string; models: string[] };
    lmStudio: { running: boolean; baseUrl: string; models?: string[] };
  };
  tier: string;
  tierLabel: string;
  summary: string;
  tips: string[];
  setupGuide?: string[];
  recommendations: Array<{
    id: string;
    name: string;
    model: string;
    sizeHint: string;
    minRamGB: number;
    reason: string;
    recommended: boolean;
    runtime?: "ollama" | "lmstudio";
    downloadCommand?: string;
    downloadUrl?: string;
    modelPageUrl?: string;
    providerPreset: {
      name: string;
      baseUrl: string;
      apiKey: string;
      model: string;
    };
  }>;
}
