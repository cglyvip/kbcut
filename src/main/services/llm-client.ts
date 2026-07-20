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
}

export interface LlmTestResult {
  ok: boolean
  providerId: string
  providerName: string
  message: string
  latencyMs: number
  model?: string
}

/** Soft cap to avoid provider fake-death / 429 storms. User asked 5-10 RPM. */
const DEFAULT_RPM = 8
const MIN_RPM = 5
const MAX_RPM = 10

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
  private timestamps: number[] = []
  private chain: Promise<void> = Promise.resolve()
  private lastStartAt = 0

  setRpm(rpm?: number) {
    this.rpm = clampRpm(rpm)
  }

  getRpm() {
    return this.rpm
  }

  /** Wait until a new request slot is available, then mark it used. */
  waitTurn(): Promise<void> {
    const run = async () => {
      const windowMs = 60_000
      const minGapMs = Math.ceil(windowMs / this.rpm)

      while (true) {
        const now = Date.now()
        this.timestamps = this.timestamps.filter((t) => now - t < windowMs)

        const gapWait = this.lastStartAt > 0 ? minGapMs - (now - this.lastStartAt) : 0
        if (this.timestamps.length < this.rpm && gapWait <= 0) {
          const started = Date.now()
          this.timestamps.push(started)
          this.lastStartAt = started
          return
        }

        let waitMs = gapWait
        if (this.timestamps.length >= this.rpm) {
          const oldest = this.timestamps[0]
          waitMs = Math.max(waitMs, windowMs - (now - oldest) + 30)
        }
        // Cap single wait so UI doesn't look frozen forever on clock skew
        await sleep(Math.min(Math.max(waitMs, 50), 20_000))
      }
    }

    // Serialize waiters so concurrent calls don't all pass the same slot
    const next = this.chain.then(run, run)
    // Keep chain alive even if a waiter throws (it shouldn't)
    this.chain = next.then(() => undefined, () => undefined)
    return next
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

function normalizeBaseUrl(baseUrl: string): string {
  return `${String(baseUrl || '').replace(/\/+$/, '').replace(/\/v1$/i, '')}/v1/chat/completions`
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

async function requestChatCompletionsOnce(
  provider: LlmProvider,
  messages: LlmChatMessage[],
  options?: { temperature?: number; timeoutMs?: number }
): Promise<string> {
  if (!provider?.apiKey?.trim()) throw new Error('缺少 API Key')
  if (!provider?.baseUrl?.trim()) throw new Error('缺少 API 地址')
  if (!provider?.model?.trim()) throw new Error('缺少模型名')

  // Global RPM gate before every real network call
  await rpmLimiter.waitTurn()

  const url = normalizeBaseUrl(provider.baseUrl)
  const timeoutMs = options?.timeoutMs ?? 90000
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
    const content = data?.choices?.[0]?.message?.content
    if (!content || typeof content !== 'string') {
      throw new Error('API 返回空内容或格式异常')
    }
    return content
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
  const maxRetries = Math.max(0, Math.min(2, options?.maxRetries ?? 1))
  let lastError = ''

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await requestChatCompletionsOnce(provider, messages, options)
    } catch (err: any) {
      lastError = err?.message || String(err)
      const retryable = isRateLimitError(lastError) || /timeout|网络|fetch failed|econnreset|socket/i.test(lastError)
      if (!retryable || attempt >= maxRetries) break

      // Extra cool-down on 429 / transient errors (on top of RPM spacing)
      const coolDownMs = isRateLimitError(lastError)
        ? 12_000 + attempt * 6_000
        : 3_000 + attempt * 2_000
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
      const content = await callChatCompletions(provider, messages, options)
      return {
        content,
        provider,
        providerIndex: i,
        failures
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
    // Connectivity test still respects RPM, but no multi-retry storm
    const content = await callChatCompletions(
      provider,
      [
        { role: 'system', content: '你是连通性测试助手。只回复 OK。' },
        { role: 'user', content: 'ping' }
      ],
      { temperature: 0, timeoutMs: 30000, maxRetries: 0 }
    )
    const latencyMs = Date.now() - started
    const okText = String(content).trim().slice(0, 40)
    return {
      ok: true,
      providerId: provider.id,
      providerName: name,
      message: `连接成功（${latencyMs}ms），模型响应: ${okText || 'OK'}；当前限速 ${getLlmRpmLimit()} RPM`,
      latencyMs,
      model: provider.model
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
