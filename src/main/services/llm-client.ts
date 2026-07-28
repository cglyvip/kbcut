import { normalizeOpenAiCompatibleUrl } from '../utils/openai-api-url'

export interface LlmProvider {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  model: string
  enabled?: boolean
}

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmCallSuccess {
  content: string
  provider: LlmProvider
  providerIndex: number
  failures: { provider: LlmProvider; error: string }[]
  model: string
  usage: LlmTokenUsage
}

export interface LlmTokenUsage {
  inputTokens: number
  outputTokens: number
  estimated: boolean
}

export interface LlmCompletionResult {
  content: string
  model: string
  usage: LlmTokenUsage
}

export interface LlmTestResult {
  ok: boolean
  providerId: string
  providerName: string
  message: string
  latencyMs: number
  model?: string
}

/** Conservative caps for long structured-output requests. */
const DEFAULT_RPM = 5
const MIN_RPM = 1
const MAX_RPM = 10
const ESTIMATED_TPM = 20_000

function clampRpm(rpm?: number): number {
  const n = Number(rpm)
  if (!Number.isFinite(n)) return DEFAULT_RPM
  return Math.max(MIN_RPM, Math.min(MAX_RPM, Math.round(n)))
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)))
}

/**
 * Global serial RPM limiter for all chat completions.
 * - Keeps requests <= rpm in any rolling 60s window
 * - Also enforces min spacing between consecutive calls
 */
class LlmRpmLimiter {
  private rpm = DEFAULT_RPM
  private desiredRpm = DEFAULT_RPM
  private timestamps: number[] = []
  private chain: Promise<void> = Promise.resolve()
  private lastStartAt = 0
  private consecutiveSuccesses = 0
  private coolDownUntil = 0
  private tokenUsage: { at: number; tokens: number }[] = []

  setRpm(rpm?: number) {
    this.desiredRpm = clampRpm(rpm)
    this.rpm = this.desiredRpm
    this.consecutiveSuccesses = 0
  }

  getRpm() {
    return this.rpm
  }

  noteSuccess() {
    this.consecutiveSuccesses++
    if (this.consecutiveSuccesses >= 10 && this.rpm < this.desiredRpm) {
      this.rpm++
      this.consecutiveSuccesses = 0
    }
  }

  noteRateLimit() {
    this.rpm = Math.max(MIN_RPM, this.rpm - 1)
    this.consecutiveSuccesses = 0
    this.coolDownUntil = Math.max(this.coolDownUntil, Date.now() + 60_000)
  }

  /** Wait until a new request slot is available, then mark it used. */
  async waitTurn(estimatedTokens: number): Promise<void> {
    // 1. 冷却期等待不持有 chain，让多个请求可并行等待冷却结束
    while (true) {
      const now = Date.now()
      if (now >= this.coolDownUntil) break
      await sleep(Math.min(this.coolDownUntil - now, 20_000))
    }

    // 2. 在串行链内竞争 slot（只持有 chain 做时间戳检查和记录，不长时间等待）
    const run = async () => {
      const windowMs = 60_000
      const minGapMs = Math.ceil(windowMs / this.rpm)

      while (true) {
        const now = Date.now()
        // 冷却可能在 chain 等待期间被其他请求触发，再检查一次
        if (now < this.coolDownUntil) {
          // 释放 chain 让其他请求也能等待：把冷却等待放在 chain 外
          // 这里直接返回，调用方会在外层重试
          throw new Error('__COOLDOWN_RETRY__')
        }
        this.timestamps = this.timestamps.filter((t) => now - t < windowMs)
        this.tokenUsage = this.tokenUsage.filter((item) => now - item.at < windowMs)

        const gapWait = this.lastStartAt > 0 ? minGapMs - (now - this.lastStartAt) : 0
        const usedTokens = this.tokenUsage.reduce((sum, item) => sum + item.tokens, 0)
        const tokenSlotAvailable = this.tokenUsage.length === 0 || usedTokens + estimatedTokens <= ESTIMATED_TPM
        if (this.timestamps.length < this.rpm && gapWait <= 0 && tokenSlotAvailable) {
          const started = Date.now()
          this.timestamps.push(started)
          this.tokenUsage.push({ at: started, tokens: estimatedTokens })
          this.lastStartAt = started
          return
        }

        let waitMs = gapWait
        if (this.timestamps.length >= this.rpm) {
          const oldest = this.timestamps[0]
          waitMs = Math.max(waitMs, windowMs - (now - oldest) + 30)
        }
        if (!tokenSlotAvailable && this.tokenUsage.length > 0) {
          waitMs = Math.max(waitMs, windowMs - (now - this.tokenUsage[0].at) + 30)
        }
        // Cap single wait so UI doesn't look frozen forever on clock skew
        await sleep(Math.min(Math.max(waitMs, 50), 20_000))
      }
    }

    // 串行化 slot 竞争；若运行中触发冷却则在外层重试
    let attempt = 0
    while (true) {
      attempt++
      try {
        const next = this.chain.then(run, run)
        this.chain = next.then(() => undefined, () => undefined)
        await next
        return
      } catch (err) {
        if (err instanceof Error && err.message === '__COOLDOWN_RETRY__' && attempt < 10) {
          // 冷却期间被中断，回到外层等待冷却结束后重试
          while (true) {
            const now = Date.now()
            if (now >= this.coolDownUntil) break
            await sleep(Math.min(this.coolDownUntil - now, 20_000))
          }
          continue
        }
        throw err
      }
    }
  }
}

const rpmLimiter = new LlmRpmLimiter()

export function setLlmRpmLimit(rpm?: number): number {
  rpmLimiter.setRpm(rpm)
  return rpmLimiter.getRpm()
}

export function getLlmRpmLimit(): number {
  return rpmLimiter.getRpm()
}

export function normalizeLlmApiUrl(baseUrl: string): string {
  return normalizeOpenAiCompatibleUrl(baseUrl, 'chat/completions', '大模型 API')
}

function maskKey(apiKey: string): string {
  if (!apiKey) return '(空)'
  if (apiKey.length <= 8) return '****'
  return `${apiKey.slice(0, 3)}***${apiKey.slice(-4)}`
}

export function providerLabel(p: LlmProvider): string {
  return p.name?.trim() || p.model || p.baseUrl || '未命名 API'
}

function isRateLimitError(message: string): boolean {
  const m = String(message || '').toLowerCase()
  return (
    m.includes('429') ||
    m.includes('rate limit') ||
    m.includes('too many requests') ||
    m.includes('rpm') ||
    m.includes('quota') ||
    m.includes('限流') ||
    m.includes('频率')
  )
}

function nonNegativeToken(value: unknown): number | null {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || numeric < 0) return null
  return Math.round(numeric)
}

function firstTokenValue(...values: unknown[]): number | null {
  for (const value of values) {
    const numeric = nonNegativeToken(value)
    if (numeric !== null) return numeric
  }
  return null
}

function estimateTextTokens(text: string): number {
  return Math.max(1, Math.ceil(String(text || '').length / 2))
}

export function parseLlmCompletionPayload(
  data: any,
  provider: Pick<LlmProvider, 'model'>,
  messages: LlmChatMessage[]
): LlmCompletionResult {
  const finishReason = String(data?.choices?.[0]?.finish_reason || '')
  if (finishReason === 'length') {
    throw new Error('API 响应被输出长度限制截断（finish_reason=length），请减少变体数量、缩短原视频文稿，或提高服务商输出 Token 上限')
  }
  if (finishReason === 'content_filter') {
    throw new Error('API 响应被服务商内容审核拦截（finish_reason=content_filter）')
  }

  const content = data?.choices?.[0]?.message?.content
  if (!content || typeof content !== 'string') {
    throw new Error('API 返回空内容或格式异常')
  }

  const usage = data?.usage || data?.usageMetadata || {}
  let inputTokens = firstTokenValue(
    usage.prompt_tokens,
    usage.input_tokens,
    usage.promptTokenCount,
    usage.prompt_eval_count
  )
  let outputTokens = firstTokenValue(
    usage.completion_tokens,
    usage.output_tokens,
    usage.candidatesTokenCount,
    usage.eval_count
  )
  const totalTokens = firstTokenValue(usage.total_tokens, usage.totalTokenCount)
  let estimated = false

  if (inputTokens === null && totalTokens !== null && outputTokens !== null) {
    inputTokens = Math.max(0, totalTokens - outputTokens)
  }
  if (outputTokens === null && totalTokens !== null && inputTokens !== null) {
    outputTokens = Math.max(0, totalTokens - inputTokens)
  }
  if (inputTokens === null) {
    inputTokens = estimateTextTokens(messages.map((message) => message.content).join('\n'))
    estimated = true
  }
  if (outputTokens === null) {
    outputTokens = totalTokens !== null
      ? Math.max(0, totalTokens - inputTokens)
      : estimateTextTokens(content)
    estimated = true
  }

  return {
    content,
    model: String(data?.model || provider.model || '模型未知').trim() || '模型未知',
    usage: { inputTokens, outputTokens, estimated }
  }
}

async function requestChatCompletionsOnce(
  provider: LlmProvider,
  messages: LlmChatMessage[],
  options?: { temperature?: number; timeoutMs?: number }
): Promise<LlmCompletionResult> {
  if (!provider?.apiKey?.trim()) throw new Error('缺少 API Key')
  if (!provider?.baseUrl?.trim()) throw new Error('缺少 API 地址')
  if (!provider?.model?.trim()) throw new Error('缺少模型名')

  const inputChars = messages.reduce((sum, message) => sum + message.content.length, 0)
  const estimatedTokens = Math.max(1_000, Math.ceil(inputChars / 2) + 3_000)
  await rpmLimiter.waitTurn(estimatedTokens)

  const url = normalizeLlmApiUrl(provider.baseUrl)
  const timeoutMs = options?.timeoutMs ?? 300000
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`
      },
      body: JSON.stringify({
        model: provider.model,
        messages,
        temperature: options?.temperature ?? 0.5
      }),
      signal: controller.signal
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 300)}`)
    }

    const data = await response.json() as any
    const result = parseLlmCompletionPayload(data, provider, messages)
    rpmLimiter.noteSuccess()
    return result
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new Error(`请求超时（>${Math.round(timeoutMs / 1000)}s）`)
    }
    throw new Error(err?.message || String(err))
  } finally {
    clearTimeout(timer)
  }
}

export async function callChatCompletions(
  provider: LlmProvider,
  messages: LlmChatMessage[],
  options?: { temperature?: number; timeoutMs?: number; maxRetries?: number }
): Promise<string> {
  const result = await callChatCompletionsDetailed(provider, messages, options)
  return result.content
}

export async function callChatCompletionsDetailed(
  provider: LlmProvider,
  messages: LlmChatMessage[],
  options?: { temperature?: number; timeoutMs?: number; maxRetries?: number }
): Promise<LlmCompletionResult> {
  const maxRetries = Math.max(0, Math.min(2, options?.maxRetries ?? 2))
  let lastError = ''

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await requestChatCompletionsOnce(provider, messages, options)
    } catch (err: any) {
      lastError = err?.message || String(err)
      if (isRateLimitError(lastError)) rpmLimiter.noteRateLimit()
      const retryable = isRateLimitError(lastError) || /timeout|网络|fetch failed|econnreset|socket/i.test(lastError)
      if (!retryable || attempt >= maxRetries) break

      // Extra cool-down on 429 / transient errors (on top of RPM spacing)
      const coolDownMs = isRateLimitError(lastError)
        ? 60_000 + attempt * 30_000
        : 15_000 + attempt * 10_000
      console.warn(`[llm] retry after ${coolDownMs}ms: ${providerLabel(provider)} -> ${lastError}`)
      await sleep(coolDownMs)
    }
  }

  throw new Error(lastError || '大模型请求失败')
}

export async function callChatWithFailover(
  providers: LlmProvider[],
  messages: LlmChatMessage[],
  options?: { temperature?: number; timeoutMs?: number }
): Promise<LlmCallSuccess> {
  const list = (providers || []).filter((p) => p && p.enabled !== false && p.apiKey && p.baseUrl && p.model)
  if (list.length === 0) {
    throw new Error('没有可用的大模型 API，请先添加并填写 API 地址 / Key / 模型')
  }

  const failures: { provider: LlmProvider; error: string }[] = []

  for (let i = 0; i < list.length; i++) {
    const provider = list[i]
    try {
      const result = await callChatCompletionsDetailed(provider, messages, options)
      return {
        content: result.content,
        provider,
        providerIndex: i,
        failures,
        model: result.model,
        usage: result.usage
      }
    } catch (err: any) {
      const message = err?.message || String(err)
      failures.push({ provider, error: message })
      console.error(`[llm] provider failed: ${providerLabel(provider)} ->`, message)

      // If rate-limited, cool down before hammering the next provider (often same vendor)
      if (isRateLimitError(message)) {
        await sleep(8_000)
      }
    }
  }

  const detail = failures
    .map((f, idx) => `${idx + 1}. ${providerLabel(f.provider)} (${maskKey(f.provider.apiKey)}): ${f.error}`)
    .join('\n')

  throw new Error(
    `全部大模型 API 均失败，请检查/更换 API。\n${detail}`
  )
}

export async function testLlmProvider(provider: LlmProvider): Promise<LlmTestResult> {
  const started = Date.now()
  const name = providerLabel(provider)
  try {
    // Use a small structured-output task so the test is closer to real variant generation.
    const result = await callChatCompletionsDetailed(
      provider,
      [
        { role: 'system', content: '你是 API 业务测试助手。严格返回 JSON，不要 Markdown。' },
        { role: 'user', content: '返回一个 JSON 数组，内容为 [{"ok":true,"message":"连接正常"}]。' }
      ],
      { temperature: 0, timeoutMs: 30000, maxRetries: 0 }
    )
    const latencyMs = Date.now() - started
    const normalized = String(result.content).trim().replace(/^```json\s*/i, '').replace(/\s*```$/, '')
    const parsed = JSON.parse(normalized)
    if (!Array.isArray(parsed) || parsed[0]?.ok !== true) {
      throw new Error('API 可连接，但结构化 JSON 输出不符合要求')
    }
    return {
      ok: true,
      providerId: provider.id,
      providerName: name,
      message: `连接及 JSON 业务测试成功（${latencyMs}ms）；实际模型 ${result.model}；Token ${result.usage.inputTokens}/${result.usage.outputTokens}${result.usage.estimated ? '（估算）' : ''}；当前限速 ${getLlmRpmLimit()} RPM`,
      latencyMs,
      model: result.model
    }
  } catch (err: any) {
    return {
      ok: false,
      providerId: provider.id,
      providerName: name,
      message: err?.message || String(err),
      latencyMs: Date.now() - started,
      model: provider.model
    }
  }
}

export async function testLlmProviders(providers: LlmProvider[]): Promise<LlmTestResult[]> {
  const list = providers || []
  const results: LlmTestResult[] = []
  for (const p of list) {
    if (!p) continue
    results.push(await testLlmProvider(p))
  }
  return results
}
