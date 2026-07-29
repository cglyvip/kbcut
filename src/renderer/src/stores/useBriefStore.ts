import { create } from 'zustand'

export type HookStrategy = 'curiosity' | 'pain' | 'benefit' | 'anti_common' | 'identity' | 'price' | 'urgency'
export type TemplateId = 'general' | 'beauty' | 'food' | 'home' | 'apparel' | 'knowledge'

export interface ProductBrief {
  productName: string
  price: string
  targetAudience: string
  painPoints: string
  coreSellingPoints: string
  evidence: string
  offer: string
  cta: string
  forbiddenWords: string
  extraPrompt: string
  templateId: TemplateId
  hookStrategies: HookStrategy[]
  audienceVariants: boolean
  enableCompliance: boolean
  enableSemanticCheck: boolean
  enableAbMatrix: boolean
  enablePacing: boolean
  subtitleKeywords: string
  llmInputPricePerMillion: number
  llmOutputPricePerMillion: number
  asrPricePerMinute: number
}

export interface FeedbackRecord {
  id: string
  videoName: string
  hookType: string
  threeSecondRate: number
  completionRate: number
  clickRate: number
  conversionRate: number
  spend: number
  createdAt: number
}

export interface UsageRecord {
  id: string
  taskId: string
  fileName: string
  inputTokens: number
  outputTokens: number
  asrMinutes: number
  createdAt: number
  modelUsages?: ModelTokenUsage[]
}

export interface ModelTokenUsage {
  providerId: string
  providerName: string
  model: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  estimated: boolean
}

export interface ProductProfile {
  id: string
  name: string
  createdAt: number
}

function feedbackScore(record: FeedbackRecord): number {
  return safeMetric(record.threeSecondRate) * 0.2
    + safeMetric(record.completionRate) * 0.2
    + safeMetric(record.clickRate) * 2
    + safeMetric(record.conversionRate) * 4
}

function safeMetric(value: number): number {
  const numeric = Number(value)
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0
}

function normalizeModelTokenUsage(item: any): ModelTokenUsage | null {
  if (!item || typeof item !== 'object') return null
  const inputTokens = safeMetric(item.inputTokens)
  const outputTokens = safeMetric(item.outputTokens)
  const requestCount = Math.round(safeMetric(item.requestCount))
  if (inputTokens <= 0 && outputTokens <= 0 && requestCount <= 0) return null
  return {
    providerId: String(item.providerId || 'unknown'),
    providerName: String(item.providerName || '历史记录'),
    model: String(item.model || '模型未知'),
    requestCount,
    inputTokens,
    outputTokens,
    estimated: item.estimated !== false
  }
}

export function mergeModelTokenUsages(
  ...collections: Array<ModelTokenUsage[] | undefined>
): ModelTokenUsage[] {
  const merged = new Map<string, ModelTokenUsage>()
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue
    for (const raw of collection) {
      const item = normalizeModelTokenUsage(raw)
      if (!item) continue
      const key = `${item.providerId}\u0000${item.model}`
      const current = merged.get(key)
      merged.set(key, {
        providerId: item.providerId,
        providerName: item.providerName,
        model: item.model,
        requestCount: (current?.requestCount || 0) + item.requestCount,
        inputTokens: (current?.inputTokens || 0) + item.inputTokens,
        outputTokens: (current?.outputTokens || 0) + item.outputTokens,
        estimated: Boolean(current?.estimated || item.estimated)
      })
    }
  }
  return Array.from(merged.values())
}

export function getUsageRecordModelUsages(
  record: Pick<UsageRecord, 'inputTokens' | 'outputTokens' | 'modelUsages'>
): ModelTokenUsage[] {
  const explicit = mergeModelTokenUsages(record.modelUsages)
  if (explicit.length > 0) return explicit
  const inputTokens = safeMetric(record.inputTokens)
  const outputTokens = safeMetric(record.outputTokens)
  if (inputTokens <= 0 && outputTokens <= 0) return []
  return [{
    providerId: 'unknown',
    providerName: '历史记录',
    model: '模型未知',
    requestCount: 0,
    inputTokens,
    outputTokens,
    estimated: true
  }]
}

export function summarizeModelTokenUsages(records: UsageRecord[]): ModelTokenUsage[] {
  return mergeModelTokenUsages(...records.map((record) => getUsageRecordModelUsages(record)))
}

export function buildFeedbackInsights(records: FeedbackRecord[]): string {
  const usable = records.filter((record) => String(record?.videoName || '').trim())
  if (usable.length === 0) return ''

  const averages = usable.reduce((result, record) => ({
    threeSecondRate: result.threeSecondRate + safeMetric(record.threeSecondRate),
    completionRate: result.completionRate + safeMetric(record.completionRate),
    clickRate: result.clickRate + safeMetric(record.clickRate),
    conversionRate: result.conversionRate + safeMetric(record.conversionRate)
  }), { threeSecondRate: 0, completionRate: 0, clickRate: 0, conversionRate: 0 })

  const hookGroups = new Map<string, FeedbackRecord[]>()
  for (const record of usable) {
    const hookType = String(record.hookType || '').trim() || '未标注钩子'
    hookGroups.set(hookType, [...(hookGroups.get(hookType) || []), record])
  }

  const bestHooks = Array.from(hookGroups.entries())
    .map(([hookType, items]) => ({
      hookType,
      score: items.reduce((sum, item) => sum + feedbackScore(item), 0) / items.length,
      clickRate: items.reduce((sum, item) => sum + safeMetric(item.clickRate), 0) / items.length,
      conversionRate: items.reduce((sum, item) => sum + safeMetric(item.conversionRate), 0) / items.length
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, 3)

  const bestSamples = [...usable]
    .sort((left, right) => feedbackScore(right) - feedbackScore(left))
    .slice(0, 3)

  const count = usable.length
  const lines = [
    `历史样本 ${count} 条；平均 3 秒播放率 ${(averages.threeSecondRate / count).toFixed(1)}%，完播率 ${(averages.completionRate / count).toFixed(1)}%，点击率 ${(averages.clickRate / count).toFixed(1)}%，转化率 ${(averages.conversionRate / count).toFixed(1)}%。`
  ]
  if (bestHooks.length > 0) {
    lines.push(`优先参考钩子：${bestHooks.map((item) => `${item.hookType}（点击 ${item.clickRate.toFixed(1)}%，转化 ${item.conversionRate.toFixed(1)}%）`).join('；')}。`)
  }
  if (bestSamples.length > 0) {
    lines.push(`高表现样本：${bestSamples.map((item) => `${item.videoName}${item.hookType ? `/${item.hookType}` : ''}`).join('、')}。只学习其结构，不得编造原素材中不存在的信息。`)
  }
  return lines.join('\n')
}

export const GROWTH_TEMPLATES: Array<{
  id: TemplateId
  name: string
  description: string
  defaults: Partial<ProductBrief>
}> = [
  { id: 'general', name: '通用投流', description: '钩子、痛点、卖点、证据、逼单完整结构', defaults: { hookStrategies: ['pain', 'benefit', 'curiosity'] } },
  { id: 'beauty', name: '美妆个护', description: '场景痛点、效果对比、成分背书、限时权益', defaults: { hookStrategies: ['pain', 'benefit', 'identity'], extraPrompt: '优先选择使用前后对比、成分与肤感相关原句。' } },
  { id: 'food', name: '食品饮料', description: '口感场景、配料证据、价格权益、囤货理由', defaults: { hookStrategies: ['benefit', 'price', 'urgency'], extraPrompt: '优先选择口感、配料、食用场景和囤货权益相关原句。' } },
  { id: 'home', name: '家清日用', description: '麻烦场景、效率提升、演示证据、立即下单', defaults: { hookStrategies: ['pain', 'anti_common', 'benefit'], extraPrompt: '优先选择清洁演示、效率对比和省时省力相关原句。' } },
  { id: 'apparel', name: '服饰鞋包', description: '人群筛选、上身效果、材质版型、价格冲击', defaults: { hookStrategies: ['identity', 'benefit', 'price'], extraPrompt: '优先选择版型、身材适配、面料和穿搭场景相关原句。' } },
  { id: 'knowledge', name: '知识服务', description: '结果利益、错误认知、方法证明、行动门槛', defaults: { hookStrategies: ['anti_common', 'identity', 'curiosity'], extraPrompt: '优先选择认知冲突、可验证结果和方法论相关原句。' } }
]

const STORAGE_KEY = 'kbcut-growth-workbench-v2'
const LEGACY_STORAGE_KEY = 'kbcut-growth-workbench-v1'

function createDefaultBrief(): ProductBrief {
  return {
    productName: '',
    price: '',
    targetAudience: '',
    painPoints: '',
    coreSellingPoints: '',
    evidence: '',
    offer: '',
    cta: '',
    forbiddenWords: '',
    extraPrompt: '',
    templateId: 'general',
    hookStrategies: ['pain', 'benefit', 'curiosity'],
    audienceVariants: true,
    enableCompliance: true,
    enableSemanticCheck: true,
    enableAbMatrix: true,
    enablePacing: false,
    subtitleKeywords: '',
    llmInputPricePerMillion: 0,
    llmOutputPricePerMillion: 0,
    asrPricePerMinute: 0
  }
}

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

interface PersistedState {
  products: ProductProfile[]
  briefs: Record<string, ProductBrief>
  feedback: Record<string, FeedbackRecord[]>
  usage: Record<string, UsageRecord[]>
  activeProductId: string
}

function migrateLegacy(): PersistedState | null {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const legacyId = uid('product')
    const legacyBrief = { ...createDefaultBrief(), ...(parsed?.brief || {}) }
    const legacyFeedback = Array.isArray(parsed?.feedback) ? parsed.feedback : []
    const legacyUsage = Array.isArray(parsed?.usage)
      ? parsed.usage.slice(-500).map((item: any, index: number) => ({
          id: String(item?.id || `usage_legacy_${index}`),
          taskId: String(item?.taskId || `legacy_${index}`),
          fileName: String(item?.fileName || '历史任务'),
          inputTokens: safeMetric(item?.inputTokens),
          outputTokens: safeMetric(item?.outputTokens),
          asrMinutes: safeMetric(item?.asrMinutes),
          createdAt: safeMetric(item?.createdAt) || Date.now(),
          modelUsages: mergeModelTokenUsages(item?.modelUsages)
        }))
      : []
    const productName = legacyBrief.productName?.trim() || '默认产品'
    return {
      products: [{ id: legacyId, name: productName, createdAt: Date.now() }],
      briefs: { [legacyId]: legacyBrief },
      feedback: { [legacyId]: legacyFeedback },
      usage: { [legacyId]: legacyUsage },
      activeProductId: legacyId
    }
  } catch {
    return null
  }
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (parsed?.products?.length > 0 && parsed.activeProductId) {
        return {
          products: parsed.products,
          briefs: parsed.briefs || {},
          feedback: parsed.feedback || {},
          usage: parsed.usage || {},
          activeProductId: parsed.activeProductId
        }
      }
    }
  } catch {}
  const migrated = migrateLegacy()
  if (migrated) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      localStorage.removeItem(LEGACY_STORAGE_KEY)
    } catch {}
    return migrated
  }
  const defaultId = uid('product')
  return {
    products: [{ id: defaultId, name: '默认产品', createdAt: Date.now() }],
    briefs: { [defaultId]: createDefaultBrief() },
    feedback: { [defaultId]: [] },
    usage: { [defaultId]: [] },
    activeProductId: defaultId
  }
}

function persist(state: PersistedState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

interface BriefState {
  brief: ProductBrief
  feedback: FeedbackRecord[]
  usage: UsageRecord[]
  products: ProductProfile[]
  activeProductId: string
  hydrated: boolean
  setBrief: (partial: Partial<ProductBrief>) => void
  applyTemplate: (templateId: TemplateId) => void
  resetBrief: () => void
  addFeedback: (record: Omit<FeedbackRecord, 'id' | 'createdAt'>) => void
  removeFeedback: (id: string) => void
  recordUsage: (record: Omit<UsageRecord, 'id' | 'createdAt'>) => void
  hydrateBrief: () => void
  createProduct: (name: string) => string
  switchProduct: (productId: string) => void
  renameProduct: (productId: string, name: string) => void
  deleteProduct: (productId: string) => void
}

export const useBriefStore = create<BriefState>((set, get) => {
  const initial = loadState()
  const activeBrief = initial.briefs[initial.activeProductId] || createDefaultBrief()
  const activeFeedback = initial.feedback[initial.activeProductId] || []
  const activeUsage = initial.usage[initial.activeProductId] || []

  // Closure-held maps for persist calls (not exposed to UI)
  let briefsMap = initial.briefs
  let feedbackMap = initial.feedback
  let usageMap = initial.usage

  return {
    brief: activeBrief,
    feedback: activeFeedback,
    usage: activeUsage,
    products: initial.products,
    activeProductId: initial.activeProductId,
    hydrated: false,

    hydrateBrief: () => {
      if (get().hydrated) return
      const state = loadState()
      const brief = state.briefs[state.activeProductId] || createDefaultBrief()
      set({
        brief,
        feedback: state.feedback[state.activeProductId] || [],
        usage: state.usage[state.activeProductId] || [],
        products: state.products,
        activeProductId: state.activeProductId,
        hydrated: true
      })
    },

    setBrief: (partial) => {
      const state = get()
      const brief = { ...state.brief, ...partial }
      briefsMap = { ...briefsMap, [state.activeProductId]: brief }
      set({ brief })
      persist({ products: state.products, briefs: briefsMap, feedback: feedbackMap, usage: usageMap, activeProductId: state.activeProductId })
    },

    applyTemplate: (templateId) => {
      const template = GROWTH_TEMPLATES.find((item) => item.id === templateId)
      if (!template) return
      const state = get()
      const defaults = createDefaultBrief()
      const brief = {
        ...state.brief,
        hookStrategies: defaults.hookStrategies,
        extraPrompt: defaults.extraPrompt,
        ...template.defaults,
        templateId
      }
      briefsMap = { ...briefsMap, [state.activeProductId]: brief }
      set({ brief })
      persist({ products: state.products, briefs: briefsMap, feedback: feedbackMap, usage: usageMap, activeProductId: state.activeProductId })
    },

    resetBrief: () => {
      const state = get()
      const current = state.brief
      const brief = {
        ...createDefaultBrief(),
        llmInputPricePerMillion: current.llmInputPricePerMillion,
        llmOutputPricePerMillion: current.llmOutputPricePerMillion,
        asrPricePerMinute: current.asrPricePerMinute
      }
      briefsMap = { ...briefsMap, [state.activeProductId]: brief }
      set({ brief })
      persist({ products: state.products, briefs: briefsMap, feedback: feedbackMap, usage: usageMap, activeProductId: state.activeProductId })
    },

    addFeedback: (record) => {
      const state = get()
      const nextFeedback = [{ ...record, id: uid('feedback'), createdAt: Date.now() }, ...state.feedback].slice(0, 300)
      feedbackMap = { ...feedbackMap, [state.activeProductId]: nextFeedback }
      set({ feedback: nextFeedback })
      persist({ products: state.products, briefs: briefsMap, feedback: feedbackMap, usage: usageMap, activeProductId: state.activeProductId })
    },

    removeFeedback: (id) => {
      const state = get()
      const nextFeedback = state.feedback.filter((item) => item.id !== id)
      feedbackMap = { ...feedbackMap, [state.activeProductId]: nextFeedback }
      set({ feedback: nextFeedback })
      persist({ products: state.products, briefs: briefsMap, feedback: feedbackMap, usage: usageMap, activeProductId: state.activeProductId })
    },

    recordUsage: (record) => {
      const state = get()
      const existing = state.usage.find((item) => item.taskId === record.taskId)
      const previous = state.usage.filter((item) => item.taskId !== record.taskId)
      const incomingModelUsages = getUsageRecordModelUsages(record)
      const nextRecord = existing
        ? {
            ...existing,
            ...record,
            inputTokens: safeMetric(existing.inputTokens) + safeMetric(record.inputTokens),
            outputTokens: safeMetric(existing.outputTokens) + safeMetric(record.outputTokens),
            asrMinutes: Math.max(safeMetric(existing.asrMinutes), safeMetric(record.asrMinutes)),
            modelUsages: mergeModelTokenUsages(
              getUsageRecordModelUsages(existing),
              incomingModelUsages
            ),
            createdAt: Date.now()
          }
        : { ...record, modelUsages: incomingModelUsages, id: uid('usage'), createdAt: Date.now() }
      const nextUsage = [...previous, nextRecord].slice(-500)
      usageMap = { ...usageMap, [state.activeProductId]: nextUsage }
      set({ usage: nextUsage })
      persist({ products: state.products, briefs: briefsMap, feedback: feedbackMap, usage: usageMap, activeProductId: state.activeProductId })
    },

    createProduct: (name) => {
      const state = get()
      const id = uid('product')
      const profile: ProductProfile = { id, name: name.trim() || '未命名产品', createdAt: Date.now() }
      const products = [...state.products, profile]
      briefsMap = { ...briefsMap, [id]: createDefaultBrief() }
      feedbackMap = { ...feedbackMap, [id]: [] }
      usageMap = { ...usageMap, [id]: [] }
      set({
        products,
        activeProductId: id,
        brief: briefsMap[id],
        feedback: feedbackMap[id],
        usage: usageMap[id]
      })
      persist({ products, briefs: briefsMap, feedback: feedbackMap, usage: usageMap, activeProductId: id })
      return id
    },

    switchProduct: (productId) => {
      const state = get()
      if (!briefsMap[productId] || productId === state.activeProductId) return
      const brief = briefsMap[productId] || createDefaultBrief()
      const feedback = feedbackMap[productId] || []
      const usage = usageMap[productId] || []
      set({ activeProductId: productId, brief, feedback, usage })
      persist({ products: state.products, briefs: briefsMap, feedback: feedbackMap, usage: usageMap, activeProductId: productId })
    },

    renameProduct: (productId, name) => {
      const state = get()
      const products = state.products.map((p) => p.id === productId ? { ...p, name: name.trim() || p.name } : p)
      set({ products })
      persist({ products, briefs: briefsMap, feedback: feedbackMap, usage: usageMap, activeProductId: state.activeProductId })
    },

    deleteProduct: (productId) => {
      const state = get()
      if (state.products.length <= 1) return
      const products = state.products.filter((p) => p.id !== productId)
      const newBriefsMap = { ...briefsMap }
      const newFeedbackMap = { ...feedbackMap }
      const newUsageMap = { ...usageMap }
      delete newBriefsMap[productId]
      delete newFeedbackMap[productId]
      delete newUsageMap[productId]
      briefsMap = newBriefsMap
      feedbackMap = newFeedbackMap
      usageMap = newUsageMap
      const activeProductId = state.activeProductId === productId ? products[0]!.id : state.activeProductId
      const brief = briefsMap[activeProductId] || createDefaultBrief()
      set({
        products,
        activeProductId,
        brief,
        feedback: feedbackMap[activeProductId] || [],
        usage: usageMap[activeProductId] || []
      })
      persist({ products, briefs: briefsMap, feedback: feedbackMap, usage: usageMap, activeProductId })
    }
  }
})
