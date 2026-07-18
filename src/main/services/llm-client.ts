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

export async function callChatCompletions(
  provider: LlmProvider,
  messages: LlmChatMessage[],
  options?: { temperature?: number; timeoutMs?: number }
): Promise<string> {
  if (!provider?.apiKey?.trim()) throw new Error('缺少 API Key')
  if (!provider?.baseUrl?.trim()) throw new Error('缺少 API 地址')
  if (!provider?.model?.trim()) throw new Error('缺少模型名')

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
    const content = await callChatCompletions(
      provider,
      [
        { role: 'system', content: '你是连通性测试助手。只回复 OK。' },
        { role: 'user', content: 'ping' }
      ],
      { temperature: 0, timeoutMs: 30000 }
    )
    const latencyMs = Date.now() - started
    const okText = String(content).trim().slice(0, 40)
    return {
      ok: true,
      providerId: provider.id,
      providerName: name,
      message: `连接成功（${latencyMs}ms），模型响应: ${okText || 'OK'}`,
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
