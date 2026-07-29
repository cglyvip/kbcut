import { execFile } from 'child_process'
import { promisify } from 'util'
import os from 'os'

const execFileAsync = promisify(execFile)

/**
 * 从显卡名称中提取显存大小（GB）。
 * 许多显卡型号名会带显存标识，如 "NVIDIA GeForce RTX 4090 24GB" / "AMD Radeon RX 7900 XTX 24GB"。
 */
function guessVramFromName(name: string): number | null {
  const lower = String(name || '').toLowerCase()
  // 匹配 "24gb" / "24 gb" / "16g" / "16 g" 等
  const m = lower.match(/(\d{1,3})\s*gb\b/)
  if (m) {
    const gb = Number(m[1])
    if (Number.isFinite(gb) && gb >= 1 && gb <= 80) return gb
  }
  // RTX 40 系列常见型号显存映射（兜底，AdapterRAM 溢出时用）
  const knownMap: Record<string, number> = {
    'rtx 5090': 32, 'rtx 5080': 16,
    'rtx 4090': 24, 'rtx 4080': 16, 'rtx 4080 super': 16,
    'rtx 4070 ti super': 16, 'rtx 4070 ti': 12, 'rtx 4070 super': 12, 'rtx 4070': 12,
    'rtx 4060 ti': 16, 'rtx 4060': 8,
    'rtx 3090': 24, 'rtx 3090 ti': 24, 'rtx 3080 ti': 12, 'rtx 3080': 10, 'rtx 3080 12gb': 12,
    'rtx 3070 ti': 8, 'rtx 3070': 8, 'rtx 3060 ti': 8, 'rtx 3060': 12,
    'rtx 3050': 8,
    'rtx 2080 ti': 11, 'rtx 2080 super': 8, 'rtx 2080': 8,
    'rtx 2070 super': 8, 'rtx 2070': 8, 'rtx 2060 super': 8, 'rtx 2060': 6
  }
  for (const key of Object.keys(knownMap)) {
    if (lower.includes(key)) return knownMap[key] ?? null
  }
  return null
}

/**
 * 使用 nvidia-smi 查询 NVIDIA 显卡显存（字节）。仅对 NVIDIA 显卡有效。
 */
async function queryNvidiaVramBytes(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', [
      '--query-gpu=memory.total',
      '--format=csv,noheader,nounits'
    ], { timeout: 4000, windowsHide: true, maxBuffer: 1024 * 1024 })
    const lines = String(stdout || '').trim().split(/\r?\n/).filter(Boolean)
    let maxBytes = 0
    for (const line of lines) {
      const mib = Number(line.trim())
      if (Number.isFinite(mib) && mib > 0) {
        // nvidia-smi 返回的是 MiB
        maxBytes = Math.max(maxBytes, mib * 1024 * 1024)
      }
    }
    return maxBytes > 0 ? maxBytes : null
  } catch {
    return null
  }
}

export type LocalModelTier = 'entry' | 'standard' | 'high' | 'ultra'
export type LocalRuntimeKind = 'ollama' | 'lmstudio'

export interface HardwareInfo {
  platform: string
  arch: string
  cpuModel: string
  cpuCores: number
  totalMemGB: number
  freeMemGB: number
  gpuName: string
  hasNvidia: boolean
  hasAmd: boolean
  hasIntelGpu: boolean
  vramGB: number | null
}

export interface LocalRuntimeApp {
  id: LocalRuntimeKind
  name: string
  recommended: boolean
  running: boolean
  baseUrl: string
  defaultApiKey: string
  downloadUrl: string
  docsUrl: string
  description: string
  installSteps: string[]
  envRequirements: string[]
  models: string[]
}

export interface LocalRuntimeStatus {
  preferredRuntime: LocalRuntimeKind
  apps: LocalRuntimeApp[]
  ollama: { running: boolean; baseUrl: string; models: string[] }
  lmStudio: { running: boolean; baseUrl: string; models: string[] }
}

export interface LocalModelRecommendation {
  id: string
  name: string
  model: string
  sizeHint: string
  minRamGB: number
  reason: string
  recommended: boolean
  runtime: LocalRuntimeKind
  downloadCommand: string
  downloadUrl: string
  modelPageUrl: string
  providerPreset: {
    name: string
    baseUrl: string
    apiKey: string
    model: string
  }
}

export interface LocalModelAdvice {
  hardware: HardwareInfo
  runtime: LocalRuntimeStatus
  tier: LocalModelTier
  tierLabel: string
  summary: string
  tips: string[]
  setupGuide: string[]
  recommendations: LocalModelRecommendation[]
}

function roundGB(bytes: number): number {
  return Math.round((bytes / (1024 ** 3)) * 10) / 10
}

async function detectGpuWindows(): Promise<{ name: string; vramGB: number | null; hasNvidia: boolean; hasAmd: boolean; hasIntelGpu: boolean }> {
  let name = '未知显卡'
  let hasNvidia = false
  let hasAmd = false
  let hasIntelGpu = false

  try {
    const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$gpus = Get-CimInstance Win32_VideoController | Select-Object Name, AdapterRAM
$gpus | ConvertTo-Json -Compress
`
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile', '-Command', ps
    ], { timeout: 8000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })

    const raw = (stdout || '').trim()
    if (raw) {
      const parsed = JSON.parse(raw)
      const list = Array.isArray(parsed) ? parsed : [parsed]
      const names = list.map((g: any) => String(g?.Name || '')).filter(Boolean)
      name = names.join(' / ') || '未知显卡'
      const lower = name.toLowerCase()
      hasNvidia = /nvidia|geforce|rtx|gtx|quadro/.test(lower)
      hasAmd = /amd|radeon|rx /.test(lower)
      hasIntelGpu = /intel|uhd|iris/.test(lower)
    }
  } catch {
    // PowerShell 失败时继续尝试其他方式
  }

  // 显存识别优先级：
  // 1. nvidia-smi（NVIDIA 显卡最准确，不受 uint32 限制）
  // 2. 显卡名称中提取（如 "RTX 4090 24GB"）
  // 3. AdapterRAM（uint32，超过 4GB 会溢出，仅作为最后兜底）
  let vramGB: number | null = null

  if (hasNvidia) {
    const nvidiaBytes = await queryNvidiaVramBytes()
    if (nvidiaBytes && nvidiaBytes > 0) {
      vramGB = Math.round((nvidiaBytes / (1024 ** 3)) * 10) / 10
    }
  }

  if (vramGB == null) {
    const guessed = guessVramFromName(name)
    if (guessed != null) vramGB = guessed
  }

  if (vramGB == null) {
    // 最后兜底：AdapterRAM（uint32，超过 4GB 会溢出，仅当 < 4GB 时可信）
    try {
      const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$gpus = Get-CimInstance Win32_VideoController | Select-Object AdapterRAM
$gpus | ConvertTo-Json -Compress
`
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile', '-Command', ps
      ], { timeout: 5000, windowsHide: true, maxBuffer: 2 * 1024 * 1024 })
      const parsed = JSON.parse((stdout || '').trim() || 'null')
      const list = Array.isArray(parsed) ? parsed : [parsed]
      for (const g of list) {
        const ram = Number(g?.AdapterRAM)
        // uint32 最大约 4GB，超过 3.9GB 的值视为溢出不可信
        if (Number.isFinite(ram) && ram > 0 && ram < 4 * 1024 * 1024 * 1024) {
          const gb = Math.round((ram / (1024 ** 3)) * 10) / 10
          if (vramGB == null || gb > vramGB) vramGB = gb
        }
      }
    } catch {}
  }

  return { name, vramGB, hasNvidia, hasAmd, hasIntelGpu }
}

async function fetchJson(url: string, timeoutMs = 2500): Promise<any | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal as any })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

async function detectRuntime(): Promise<LocalRuntimeStatus> {
  const ollamaBase = 'http://127.0.0.1:11434'
  const lmBase = 'http://127.0.0.1:1234'

  const ollamaTags = await fetchJson(`${ollamaBase}/api/tags`)
  const models: string[] = []
  if (ollamaTags?.models && Array.isArray(ollamaTags.models)) {
    for (const m of ollamaTags.models) {
      if (m?.name) models.push(String(m.name))
    }
  }

  const lmModels = await fetchJson(`${lmBase}/v1/models`)
  const lmModelIds: string[] = Array.isArray(lmModels?.data)
    ? lmModels.data.map((item: any) => String(item?.id || '')).filter(Boolean)
    : []
  const ollamaRunning = !!ollamaTags
  const lmRunning = !!lmModels
  // Prefer Ollama for most users: free desktop client + one-command model download.
  const preferredRuntime: LocalRuntimeKind = ollamaRunning || !lmRunning ? 'ollama' : 'lmstudio'

  const apps: LocalRuntimeApp[] = [
    {
      id: 'ollama',
      name: 'Ollama（优先推荐）',
      recommended: preferredRuntime === 'ollama',
      running: ollamaRunning,
      baseUrl: `${ollamaBase}/v1`,
      defaultApiKey: 'ollama',
      downloadUrl: 'https://ollama.com/download/windows',
      docsUrl: 'https://ollama.com/download',
      description: '有 Windows 客户端。安装后会常驻托盘，支持一键下载模型，API 兼容 OpenAI。',
      installSteps: [
        '打开官网下载 Windows 安装包并安装：https://ollama.com/download/windows',
        '安装完成后启动 Ollama（任务栏托盘出现图标即表示运行中）',
        '打开 PowerShell 执行模型下载命令，例如：ollama pull qwen2.5:7b',
        '回到本软件「本地模型推荐」点「重新检测」，再点「一键填入」'
      ],
      envRequirements: [
        '系统：Windows 10/11 x64',
        '内存：最低 8GB，推荐 16GB+',
        '磁盘：至少预留 10~30GB 给模型',
        '显卡：NVIDIA 独显更稳更快；无独显也能用 CPU 跑小模型',
        '网络：首次下载模型需要联网'
      ],
      models
    },
    {
      id: 'lmstudio',
      name: 'LM Studio（图形界面备选）',
      recommended: preferredRuntime === 'lmstudio',
      running: lmRunning,
      baseUrl: `${lmBase}/v1`,
      defaultApiKey: 'lm-studio',
      downloadUrl: 'https://lmstudio.ai/download',
      docsUrl: 'https://lmstudio.ai/',
      description: '有完整桌面客户端，适合不习惯命令行的用户。在软件内搜索并下载模型，再开启本地服务器。',
      installSteps: [
        '下载并安装 LM Studio：https://lmstudio.ai/download',
        '打开软件后，在 Discover/搜索页下载推荐模型（如 Qwen2.5 7B）',
        '进入 Local Server / Developer 页，启动本地服务器（默认端口 1234）',
        '回到本软件点「重新检测」，再点「一键填入」'
      ],
      envRequirements: [
        '系统：Windows 10/11 x64',
        '内存：最低 16GB 更稳，8GB 仅建议小模型',
        '磁盘：模型文件通常 2~20GB+',
        '显卡：NVIDIA 更佳；AMD/Intel 也能尝试，但速度可能偏慢',
        '注意：必须在 LM Studio 内手动开启本地服务器，否则本软件检测不到'
      ],
      models: lmModelIds
    }
  ]

  return {
    preferredRuntime,
    apps,
    ollama: {
      running: ollamaRunning,
      baseUrl: `${ollamaBase}/v1`,
      models
    },
    lmStudio: {
      running: lmRunning,
      baseUrl: `${lmBase}/v1`,
      models: lmModelIds
    }
  }
}

function decideTier(h: HardwareInfo): LocalModelTier {
  if (h.totalMemGB >= 48 || (h.hasNvidia && (h.vramGB || 0) >= 16)) return 'ultra'
  if (h.totalMemGB >= 24 || (h.hasNvidia && (h.vramGB || 0) >= 10)) return 'high'
  if (h.totalMemGB >= 12) return 'standard'
  return 'entry'
}

function tierLabel(tier: LocalModelTier): string {
  switch (tier) {
    case 'ultra': return '旗舰档（可跑大参数）'
    case 'high': return '高配档（推荐 14B 级）'
    case 'standard': return '主流档（推荐 7B~9B）'
    default: return '入门档（推荐小模型）'
  }
}

function modelPageUrl(model: string): string {
  const slug = String(model || '').split(':')[0] ?? ''
  return `https://ollama.com/library/${encodeURIComponent(slug)}`
}

function buildRecommendations(h: HardwareInfo, runtime: LocalRuntimeStatus, tier: LocalModelTier): LocalModelRecommendation[] {
  const preferred = runtime.preferredRuntime
  const preferredApp = runtime.apps.find((a) => a.id === preferred) || runtime.apps[0]!
  const baseUrl = preferredApp!.baseUrl
  const runtimeName = preferredApp!.id === 'ollama' ? 'Ollama' : 'LM Studio'
  const apiKey = preferredApp!.defaultApiKey

  const installedLm: LocalModelRecommendation[] = (runtime.lmStudio.models || []).slice(0, 4).map((m, idx) => ({
    id: `lm_installed_${idx}`,
    name: `LM Studio 已安装：${m}`,
    model: m,
    sizeHint: '已安装',
    minRamGB: 0,
    reason: '检测到 LM Studio 本地服务器已加载此模型，可直接一键填入',
    recommended: true,
    runtime: 'lmstudio',
    downloadCommand: `在 LM Studio 中加载：${m}`,
    downloadUrl: 'https://lmstudio.ai/download',
    modelPageUrl: 'https://lmstudio.ai/',
    providerPreset: {
      name: `LM Studio-${m}`,
      baseUrl: runtime.lmStudio.baseUrl,
      apiKey: 'lm-studio',
      model: m
    }
  }))

  const installed: LocalModelRecommendation[] = (runtime.ollama.models || []).slice(0, 4).map((m, idx) => ({
    id: `installed_${idx}`,
    name: `本机已安装：${m}`,
    model: m,
    sizeHint: '已安装',
    minRamGB: 0,
    reason: '检测到 Ollama 本地已有此模型，可直接一键填入',
    recommended: true,
    runtime: 'ollama',
    downloadCommand: `ollama pull ${m}`,
    downloadUrl: modelPageUrl(m),
    modelPageUrl: modelPageUrl(m),
    providerPreset: {
      name: `Ollama-${m}`,
      baseUrl: runtime.ollama.baseUrl,
      apiKey: 'ollama',
      model: m
    }
  }))

  const catalog: Array<Omit<LocalModelRecommendation, 'recommended' | 'providerPreset' | 'runtime' | 'downloadCommand' | 'downloadUrl' | 'modelPageUrl'> & { tiers: LocalModelTier[] }> = [
    {
      id: 'qwen25_3b',
      name: 'Qwen2.5 3B（轻量）',
      model: 'qwen2.5:3b',
      sizeHint: '约 2GB',
      minRamGB: 8,
      reason: '内存紧张时优先，响应快，适合基础改写',
      tiers: ['entry', 'standard']
    },
    {
      id: 'qwen25_7b',
      name: 'Qwen2.5 7B（均衡）',
      model: 'qwen2.5:7b',
      sizeHint: '约 4~5GB',
      minRamGB: 12,
      reason: '中文口播改写效果与速度较均衡，最推荐主流配置',
      tiers: ['entry', 'standard', 'high']
    },
    {
      id: 'qwen25_14b',
      name: 'Qwen2.5 14B（高质量）',
      model: 'qwen2.5:14b',
      sizeHint: '约 8~10GB',
      minRamGB: 24,
      reason: '文案通顺度和创意更好，适合爆款重组',
      tiers: ['standard', 'high', 'ultra']
    },
    {
      id: 'deepseek_r1_8b',
      name: 'DeepSeek R1 8B 蒸馏',
      model: 'deepseek-r1:8b',
      sizeHint: '约 5~6GB',
      minRamGB: 16,
      reason: '逻辑整理能力强，适合脚本重排与结构优化',
      tiers: ['standard', 'high', 'ultra']
    },
    {
      id: 'qwen25_32b',
      name: 'Qwen2.5 32B（旗舰）',
      model: 'qwen2.5:32b',
      sizeHint: '约 18GB+',
      minRamGB: 48,
      reason: '质量上限高，但更吃内存/显存，适合高配机器',
      tiers: ['high', 'ultra']
    }
  ]

  const primary = catalog
    .filter((c) => c.tiers.includes(tier) && h.totalMemGB + 0.1 >= Math.max(8, c.minRamGB * 0.75))
    .map((c, idx) => ({
      id: c.id,
      name: c.name,
      model: c.model,
      sizeHint: c.sizeHint,
      minRamGB: c.minRamGB,
      reason: c.reason,
      recommended: idx === 0,
      runtime: preferred,
      downloadCommand: preferred === 'ollama'
        ? `ollama pull ${c.model}`
        : `在 LM Studio 搜索并下载：${c.model.split(':')[0]}`,
      downloadUrl: preferred === 'ollama' ? modelPageUrl(c.model) : 'https://lmstudio.ai/models',
      modelPageUrl: preferred === 'ollama' ? modelPageUrl(c.model) : 'https://lmstudio.ai/models',
      providerPreset: {
        name: `${runtimeName}-${c.model}`,
        baseUrl,
        apiKey,
        model: preferred === 'ollama' ? c.model : (runtime.lmStudio.models[0] || '')
      }
    }))

  if (!primary.some((p) => p.id === 'qwen25_3b') && h.totalMemGB < 16) {
    primary.push({
      id: 'qwen25_3b_safe',
      name: 'Qwen2.5 3B（保底）',
      model: 'qwen2.5:3b',
      sizeHint: '约 2GB',
      minRamGB: 8,
      reason: '当前内存偏紧张时的保底方案',
      recommended: primary.length === 0,
      runtime: preferred,
      downloadCommand: preferred === 'ollama'
        ? 'ollama pull qwen2.5:3b'
        : '在 LM Studio 搜索并下载：qwen2.5 3B',
      downloadUrl: preferred === 'ollama' ? modelPageUrl('qwen2.5:3b') : 'https://lmstudio.ai/models',
      modelPageUrl: preferred === 'ollama' ? modelPageUrl('qwen2.5:3b') : 'https://lmstudio.ai/models',
      providerPreset: {
        name: `${runtimeName}-qwen2.5:3b`,
        baseUrl,
        apiKey,
        model: preferred === 'ollama' ? 'qwen2.5:3b' : (runtime.lmStudio.models[0] || '')
      }
    })
  }

  const seen = new Set<string>()
  const all: LocalModelRecommendation[] = []
  for (const item of [...installed, ...installedLm, ...primary]) {
    const key = `${item.runtime}:${item.model}`.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    all.push(item)
  }
  if (all.length > 0 && !all.some((x) => x.recommended)) all[0]!.recommended = true
  return all.slice(0, 6)
}

export async function getLocalModelAdvice(): Promise<LocalModelAdvice> {
  const cpus = os.cpus() || []
  const gpu = process.platform === 'win32'
    ? await detectGpuWindows()
    : { name: '未知显卡', vramGB: null, hasNvidia: false, hasAmd: false, hasIntelGpu: false }

  const hardware: HardwareInfo = {
    platform: process.platform,
    arch: process.arch,
    cpuModel: cpus[0]?.model || '未知 CPU',
    cpuCores: cpus.length || os.availableParallelism?.() || 1,
    totalMemGB: roundGB(os.totalmem()),
    freeMemGB: roundGB(os.freemem()),
    gpuName: gpu.name,
    hasNvidia: gpu.hasNvidia,
    hasAmd: gpu.hasAmd,
    hasIntelGpu: gpu.hasIntelGpu,
    vramGB: gpu.vramGB
  }

  const runtime = await detectRuntime()
  const tier = decideTier(hardware)
  const recommendations = buildRecommendations(hardware, runtime, tier)
  const preferredApp = runtime.apps.find((a) => a.id === runtime.preferredRuntime) || runtime.apps[0]
  const topModel = recommendations.find((r) => r.recommended) || recommendations[0]

  const tips: string[] = []
  const setupGuide: string[] = []

  if (!runtime.ollama.running && !runtime.lmStudio.running) {
    tips.push('当前没有检测到本地模型服务。仅“一键填入”不够，需要先安装客户端并下载模型。')
    tips.push('优先推荐 Ollama：有 Windows 客户端，安装简单，模型下载命令也简单。')
    tips.push('如果更喜欢图形界面、不喜欢命令行，可改用 LM Studio。')
    setupGuide.push(...preferredApp!.installSteps)
    if (topModel) {
      setupGuide.push(`下载推荐模型：${topModel.downloadCommand}`)
      setupGuide.push(`模型页面：${topModel.modelPageUrl}`)
    }
  }

  if (runtime.ollama.running) {
    tips.push('已检测到 Ollama 正在运行。')
    if (runtime.ollama.models.length === 0) {
      tips.push('Ollama 已启动，但还没有模型。请先下载模型再使用。')
      if (topModel) setupGuide.push(`在 PowerShell 执行：${topModel.downloadCommand}`)
    } else {
      tips.push(`Ollama 已安装 ${runtime.ollama.models.length} 个模型，可直接一键填入。`)
    }
  }

  if (runtime.lmStudio.running) {
    tips.push('已检测到 LM Studio 本地服务器（1234端口）。')
  } else if (!runtime.ollama.running) {
    tips.push('LM Studio 备选方案：安装后需在软件内手动开启 Local Server。')
  }

  if (hardware.totalMemGB < 12) {
    tips.push('内存低于 12GB，建议只用 3B/7B 小模型，并关闭其他占内存软件。')
  } else if (hardware.totalMemGB < 24) {
    tips.push('内存 12~24GB：优先 7B/8B；14B 可能能跑但会偏慢。')
  } else {
    tips.push('内存充足：可优先 14B，质量通常明显更好。')
  }

  if (hardware.hasNvidia) {
    tips.push('检测到 NVIDIA 显卡，本地推理通常比纯 CPU 更快。')
  } else {
    tips.push('未检测到 NVIDIA 独显时，本地大模型可能较慢，建议选更小模型。')
  }

  tips.push('口播重组属于中文文本任务，优先通义千问（Qwen）系列通常更稳。')
  tips.push('“一键填入”只会写入 API 地址；客户端未安装或模型未下载时，测试仍会失败。')

  const summary = `本机约 ${hardware.totalMemGB}GB 内存 / ${hardware.cpuCores} 核，评级：${tierLabel(tier)}。` +
    (runtime.ollama.running ? ' 已发现 Ollama。' : ' 未发现 Ollama。') +
    (runtime.lmStudio.running ? ' 已发现 LM Studio。' : ' 未发现 LM Studio。')

  return {
    hardware,
    runtime,
    tier,
    tierLabel: tierLabel(tier),
    summary,
    tips,
    setupGuide,
    recommendations
  }
}
