import { execFile } from 'child_process'
import { promisify } from 'util'
import os from 'os'

const execFileAsync = promisify(execFile)

export type LocalModelTier = 'entry' | 'standard' | 'high' | 'ultra'

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

export interface LocalRuntimeStatus {
  ollama: { running: boolean; baseUrl: string; models: string[] }
  lmStudio: { running: boolean; baseUrl: string }
}

export interface LocalModelRecommendation {
  id: string
  name: string
  model: string
  sizeHint: string
  minRamGB: number
  reason: string
  recommended: boolean
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
  recommendations: LocalModelRecommendation[]
}

function roundGB(bytes: number): number {
  return Math.round((bytes / (1024 ** 3)) * 10) / 10
}

async function detectGpuWindows(): Promise<{ name: string; vramGB: number | null; hasNvidia: boolean; hasAmd: boolean; hasIntelGpu: boolean }> {
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
    if (!raw) {
      return { name: '未知显卡', vramGB: null, hasNvidia: false, hasAmd: false, hasIntelGpu: false }
    }
    const parsed = JSON.parse(raw)
    const list = Array.isArray(parsed) ? parsed : [parsed]
    const names = list.map((g: any) => String(g?.Name || '')).filter(Boolean)
    const name = names.join(' / ') || '未知显卡'
    let vramGB: number | null = null
    for (const g of list) {
      const ram = Number(g?.AdapterRAM)
      if (Number.isFinite(ram) && ram > 0) {
        const gb = ram / (1024 ** 3)
        // AdapterRAM is often capped/wrong on Windows; keep max positive value as weak signal
        if (vramGB == null || gb > vramGB) vramGB = Math.round(gb * 10) / 10
      }
    }
    const lower = name.toLowerCase()
    return {
      name,
      vramGB,
      hasNvidia: /nvidia|geforce|rtx|gtx|quadro/.test(lower),
      hasAmd: /amd|radeon|rx /.test(lower),
      hasIntelGpu: /intel|uhd|iris/.test(lower)
    }
  } catch {
    return { name: '未知显卡', vramGB: null, hasNvidia: false, hasAmd: false, hasIntelGpu: false }
  }
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

  // LM Studio OpenAI-compatible endpoint often exposes /v1/models
  const lmModels = await fetchJson(`${lmBase}/v1/models`)

  return {
    ollama: {
      running: !!ollamaTags,
      baseUrl: `${ollamaBase}/v1`,
      models
    },
    lmStudio: {
      running: !!lmModels,
      baseUrl: `${lmBase}/v1`
    }
  }
}

function decideTier(h: HardwareInfo): LocalModelTier {
  // Prefer total RAM as primary constraint for local LLM
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

function buildRecommendations(h: HardwareInfo, runtime: LocalRuntimeStatus, tier: LocalModelTier): LocalModelRecommendation[] {
  const preferOllama = runtime.ollama.running || !runtime.lmStudio.running
  const baseUrl = preferOllama ? runtime.ollama.baseUrl : runtime.lmStudio.baseUrl
  const runtimeName = preferOllama ? 'Ollama' : 'LM Studio'
  const apiKey = preferOllama ? 'ollama' : 'lm-studio'

  // If Ollama already has models, surface them first
  const installed: LocalModelRecommendation[] = (runtime.ollama.models || []).slice(0, 4).map((m, idx) => ({
    id: `installed_${idx}`,
    name: `本机已安装：${m}`,
    model: m,
    sizeHint: '已安装',
    minRamGB: 0,
    reason: '检测到 Ollama 本地已有此模型，可直接一键填入',
    recommended: true,
    providerPreset: {
      name: `${runtimeName}-${m}`,
      baseUrl,
      apiKey,
      model: m
    }
  }))

  const catalog: Array<Omit<LocalModelRecommendation, 'recommended' | 'providerPreset'> & { tiers: LocalModelTier[] }> = [
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
      providerPreset: {
        name: `${runtimeName}-${c.model}`,
        baseUrl,
        apiKey,
        model: c.model
      }
    }))

  // Always include a safe small model option
  if (!primary.some((p) => p.id === 'qwen25_3b') && h.totalMemGB < 16) {
    primary.push({
      id: 'qwen25_3b_safe',
      name: 'Qwen2.5 3B（保底）',
      model: 'qwen2.5:3b',
      sizeHint: '约 2GB',
      minRamGB: 8,
      reason: '当前内存偏紧张时的保底方案',
      recommended: primary.length === 0,
      providerPreset: {
        name: `${runtimeName}-qwen2.5:3b`,
        baseUrl,
        apiKey,
        model: 'qwen2.5:3b'
      }
    })
  }

  // Merge installed first, then recommended catalog (dedupe by model)
  const seen = new Set<string>()
  const all: LocalModelRecommendation[] = []
  for (const item of [...installed, ...primary]) {
    const key = item.model.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    all.push(item)
  }
  if (all.length > 0 && !all.some((x) => x.recommended)) all[0].recommended = true
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

  const tips: string[] = []
  if (!runtime.ollama.running && !runtime.lmStudio.running) {
    tips.push('未检测到本地推理服务。推荐先安装 Ollama，并启动后再一键填入。')
    tips.push('Ollama 默认地址：http://127.0.0.1:11434/v1 ，API Key 可填 ollama。')
  }
  if (runtime.ollama.running) {
    tips.push('已检测到 Ollama 正在运行，可直接使用下方推荐模型。')
    if (runtime.ollama.models.length === 0) {
      tips.push('Ollama 已启动但还没模型。可在终端执行：ollama pull qwen2.5:7b')
    }
  }
  if (runtime.lmStudio.running) {
    tips.push('已检测到 LM Studio（1234端口）。可在 LM Studio 开启本地服务器后填入。')
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

  const summary = `本机约 ${hardware.totalMemGB}GB 内存 / ${hardware.cpuCores} 核，评级：${tierLabel(tier)}。` +
    (runtime.ollama.running ? ' 已发现 Ollama。' : ' 未发现 Ollama。')

  return {
    hardware,
    runtime,
    tier,
    tierLabel: tierLabel(tier),
    summary,
    tips,
    recommendations
  }
}
