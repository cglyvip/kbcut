export function normalizeOpenAiCompatibleUrl(
  baseUrl: string,
  endpoint: 'chat/completions' | 'audio/transcriptions',
  label: string
): string {
  const raw = String(baseUrl || '').trim()
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new Error(`${label} 地址格式无效`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`${label} 地址仅支持 http/https`)
  }

  const path = parsed.pathname
    .replace(/\/+$/, '')
    .replace(/\/v(\d+(?:beta\d*)?)(?=\/|$)/gi, (_match, version) => `/v${String(version).toLowerCase()}`)
    .replace(/\/openai(?=\/|$)/gi, '/openai')
  const endpointPath = `/${endpoint}`
  if (path.toLowerCase().endsWith(endpointPath.toLowerCase())) {
    parsed.pathname = `${path.slice(0, -endpointPath.length)}${endpointPath}`
  } else if (!path) {
    parsed.pathname = `/v1/${endpoint}`
  } else if (/(?:\/v\d+(?:beta\d*)?|\/openai)$/i.test(path)) {
    parsed.pathname = `${path}/${endpoint}`
  } else {
    parsed.pathname = `${path}/v1/${endpoint}`
  }
  parsed.hash = ''
  return parsed.toString()
}
