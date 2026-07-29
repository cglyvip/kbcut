export interface ModelTokenUsage {
  providerId: string
  providerName: string
  model: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  estimated: boolean
}

export function mergeModelTokenUsages(
  ...arrays: (ModelTokenUsage[] | undefined)[]
): ModelTokenUsage[] {
  const map = new Map<string, ModelTokenUsage>()
  for (const arr of arrays) {
    for (const u of arr ?? []) {
      const key = `${u.providerId}:${u.model}`
      const existing = map.get(key)
      if (existing) {
        existing.requestCount += u.requestCount
        existing.inputTokens += u.inputTokens
        existing.outputTokens += u.outputTokens
      } else {
        map.set(key, { ...u })
      }
    }
  }
  return Array.from(map.values())
}
