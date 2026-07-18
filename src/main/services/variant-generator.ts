import { callChatWithFailover, type LlmProvider } from './llm-client'

export interface SimpleSegment {
  start: number
  end: number
  text: string
  duration: number
  words?: { start: number; end: number; text: string }[]
}

export interface VariantPlan {
  id: number
  name: string
  strategy: string
  segments: SimpleSegment[]
  totalDuration: number
}

export interface GenerateOptions {
  segments: SimpleSegment[]
  minDuration: number
  maxDuration: number
  variantCount: number
  /** When true, over-generate then keep only the top fluency variants. */
  topFluencyOnly?: boolean
  topFluencyCount?: number
  /** Multi-provider failover list, ordered by priority. */
  providers?: LlmProvider[]
  /** When false, do not use local fallback if all LLMs fail (batch mode). */
  allowFallback?: boolean
  /** Legacy single-provider fields (compat). */
  apiKey?: string
  baseUrl?: string
  model?: string
}

export interface GenerateVariantsResult {
  variants: VariantPlan[]
  usedProvider?: LlmProvider | null
  usedProviderIndex?: number
  failedProviders?: { name: string; error: string }[]
  usedFallback?: boolean
  notice?: string
}

const VARIANT_PROMPT = `你是千川投流口播短视频的首席编剧+剪辑总监。
你的唯一目标：从用户提供的口播原句中，重组出“听起来像一个人一口气讲完、语言通顺、信息清晰、能冲爆款”的短视频脚本。

# 绝对原则（比时长更重要）
1. 通顺第一：拼出来的文案必须像真人连续口述，不能跳跃、不能前言不搭后语。
2. 易懂第一：普通人3秒内听懂在卖什么、为什么买。
3. 禁止流水账：不要“第一句介绍+第二句再介绍+第三句又重复”的平铺直叙。
4. 禁止乱拼：不要为了凑时长把不相关句子硬塞进去。
5. 只能选原句完整句子：不能改写、不能截断、不能发明新词。
6. 相邻两句必须语义可衔接：后句应承接前句的话题、痛点、产品、效果或行动。

# 爆款叙事结构（每个变体都尽量贴近）
钩子开场（3秒抓住）→ 痛点/场景共鸣 → 核心卖点/效果证明 → 信任增强（对比/数据/细节）→ 逼单行动（下单/点击/限时）

# 选句与排序规则
- 开头必须有冲突感、好奇心、利益点或强情绪，禁止用平淡过渡句开头。
- 中段只保留最有信息密度的卖点句，重复表达只留一句最强的。
- 结尾必须有行动驱动；如果没有明确逼单句，选最接近行动的收束句。
- 允许重排，但重排后必须“听得懂、接得上”。
- 同一变体内不要出现明显重复信息。
- 不同变体要有明显差异：不同开头、不同主卖点、不同叙事角度。
- 目标时长必须尽量满足；但若“凑时长”会破坏通顺，宁可偏短一点，也不要硬塞废话。

# 自检清单（输出前逐条检查）
- 读一遍拼接文案，是否像一个人自然讲完？
- 有没有指代混乱（“这个/那个/它”突然无对象）？
- 有没有话题跳切（上一句还在讲A，下一句突然B）？
- 有没有流水账罗列感？
- 是否清楚产品是什么、好处是什么、要用户做什么？

# 返回格式
严格返回 JSON 数组，不要其他文字：
[
  {
    "name": "变体短名（突出策略）",
    "strategy": "一句话说明：开头抓什么、中段推什么、结尾逼什么",
    "segmentIndexes": [3, 5, 6, 9, 12],
    "preview": "按顺序拼接后的完整口播文案",
    "fluencyNote": "为什么这段听起来通顺且像爆款"
  }
]

segmentIndexes 从 0 开始，按最终播放顺序排列。
不要返回空数组；尽量返回请求数量的变体。
每个变体都必须包含 preview。`

const HOOK_HINTS = ['别', '你是不是', '为什么', '千万', '注意', '真相', '居然', '竟然', '谁说', '还在', '后悔', '便宜', '免费', '限时', '爆', '绝了', '救命', '蹲', '冲']
const CTA_HINTS = ['下单', '点击', '购买', '拍', '上车', '链接', '马上', '立即', '现在', '别犹豫', '库存', '限时', '优惠', '到手', '加购', '领']
const FILLER_HINTS = ['然后', '就是说', '那个', '这个呢', '嗯', '啊', '对吧', '好吧', '接下来', '我们再看', '简单说一下']

function parseJsonArray(content: string): any[] {
  const jsonMatch = content.match(/\[[\s\S]*\]/)
  if (!jsonMatch) {
    throw new Error('AI 返回格式异常，无法解析变体方案')
  }

  let jsonStr = jsonMatch[0]
    .replace(/，/g, ',')
    .replace(/：/g, ':')
    .replace(/[“”]/g, '"')
    .replace(/[\r\n]+/g, ' ')
    .replace(/,\s*([}\]])/g, '$1')

  try {
    return JSON.parse(jsonStr)
  } catch {
    const fixedMatch = jsonStr.match(/\[\s*\{[\s\S]*\}\s*\]/)
    if (!fixedMatch) throw new Error('AI 返回 JSON 格式异常，请重试')
    return JSON.parse(fixedMatch[0])
  }
}

function normalizeIndexes(raw: any, segmentCount: number): number[] {
  const source = Array.isArray(raw?.segmentIndexes)
    ? raw.segmentIndexes
    : Array.isArray(raw?.indexes)
      ? raw.indexes
      : Array.isArray(raw?.segments)
        ? raw.segments
        : []

  const indexes: number[] = []
  const seen = new Set<number>()

  for (const item of source) {
    const idx = typeof item === 'number' ? item : Number(item)
    if (!Number.isInteger(idx) || idx < 0 || idx >= segmentCount || seen.has(idx)) continue
    seen.add(idx)
    indexes.push(idx)
  }

  return indexes
}

function includesAny(text: string, hints: string[]): boolean {
  return hints.some((h) => text.includes(h))
}

function contentTokens(text: string): Set<string> {
  const tokens = text
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ')
    .split(/\s+/)
    .flatMap((part) => {
      if (!part) return []
      if (/[\u4e00-\u9fa5]/.test(part)) {
        const chars = [...part]
        const grams: string[] = []
        for (let i = 0; i < chars.length; i++) {
          grams.push(chars[i])
          if (i + 1 < chars.length) grams.push(chars[i] + chars[i + 1])
        }
        return grams
      }
      return [part.toLowerCase()]
    })
    .filter((t) => t.length > 0)

  return new Set(tokens)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

function scoreDuration(duration: number, minDuration: number, maxDuration: number): number {
  if (duration >= minDuration && duration <= maxDuration) return 0
  if (duration < minDuration) return minDuration - duration
  return duration - maxDuration
}

function scoreFluency(indexes: number[], segments: SimpleSegment[]): number {
  if (indexes.length === 0) return -999

  let score = 0
  const texts = indexes.map((i) => segments[i].text)
  const first = texts[0] || ''
  const last = texts[texts.length - 1] || ''

  // Opening / ending quality
  if (includesAny(first, HOOK_HINTS)) score += 8
  else if (first.length >= 8) score += 2
  else score -= 4

  if (includesAny(last, CTA_HINTS)) score += 8
  else score -= 2

  // Continuity between neighbors
  for (let i = 0; i < indexes.length - 1; i++) {
    const a = indexes[i]
    const b = indexes[i + 1]
    const gap = Math.abs(b - a)
    if (gap === 1) score += 10
    else if (gap === 2) score += 6
    else if (gap <= 4) score += 2
    else if (gap >= 8) score -= 6

    const sim = jaccard(contentTokens(segments[a].text), contentTokens(segments[b].text))
    if (sim >= 0.12) score += 4
    else if (sim < 0.03 && gap > 3) score -= 5
  }

  // Penalize near-duplicate consecutive content
  for (let i = 0; i < texts.length - 1; i++) {
    const sim = jaccard(contentTokens(texts[i]), contentTokens(texts[i + 1]))
    if (sim > 0.72) score -= 8
  }

  // Penalize filler-heavy scripts
  const fillerCount = texts.filter((t) => includesAny(t, FILLER_HINTS) && t.length < 12).length
  score -= fillerCount * 3

  // Prefer compact, information-dense cuts over long rambling
  const avgLen = texts.reduce((s, t) => s + t.length, 0) / texts.length
  if (avgLen >= 10 && avgLen <= 28) score += 3
  if (texts.length >= 3 && texts.length <= 12) score += 2

  // Mild preference for mostly forward storytelling (not totally shuffled chaos)
  let forward = 0
  for (let i = 1; i < indexes.length; i++) if (indexes[i] > indexes[i - 1]) forward++
  const forwardRatio = forward / Math.max(1, indexes.length - 1)
  if (forwardRatio >= 0.55) score += 4
  if (forwardRatio < 0.25) score -= 6

  return score
}

function buildVariantFromIndexes(
  indexes: number[],
  segments: SimpleSegment[],
  name: string,
  strategy: string,
  id: number
): VariantPlan | null {
  const selected = indexes.map((idx) => segments[idx]).filter(Boolean)
  if (selected.length === 0) return null

  const totalDuration = selected.reduce((sum, s) => sum + s.duration, 0)
  return {
    id,
    name,
    strategy,
    segments: selected,
    totalDuration
  }
}

function dropLeastHarmful(
  indexes: number[],
  segments: SimpleSegment[]
): number[] {
  if (indexes.length <= 1) return indexes

  let bestIdx = -1
  let bestScore = -Infinity

  for (let i = 0; i < indexes.length; i++) {
    // Prefer not dropping first hook and last CTA unless necessary
    let score = segments[indexes[i]].duration
    if (i === 0) score -= 100
    if (i === indexes.length - 1) score -= 40
    if (includesAny(segments[indexes[i]].text, FILLER_HINTS)) score += 30
    if (includesAny(segments[indexes[i]].text, CTA_HINTS) && i === indexes.length - 1) score -= 50
    if (includesAny(segments[indexes[i]].text, HOOK_HINTS) && i === 0) score -= 50

    // Dropping a middle sentence that breaks a tight original pair is costly
    if (i > 0 && i < indexes.length - 1) {
      const prev = indexes[i - 1]
      const next = indexes[i + 1]
      if (Math.abs(next - prev) === 1) score -= 20
    }

    if (score > bestScore) {
      bestScore = score
      bestIdx = i
    }
  }

  if (bestIdx < 0) return indexes.slice(0, -1)
  return indexes.filter((_, i) => i !== bestIdx)
}

function bestInsertCandidate(
  current: number[],
  segments: SimpleSegment[],
  maxDuration: number,
  currentDuration: number
): number | null {
  const used = new Set(current)
  let best: { idx: number; score: number } | null = null

  for (let idx = 0; idx < segments.length; idx++) {
    if (used.has(idx)) continue
    const nextDur = currentDuration + segments[idx].duration
    if (nextDur > maxDuration + 0.35) continue

    // Prefer original-neighborhood continuity
    let local = 0
    for (const c of current) {
      const gap = Math.abs(c - idx)
      if (gap === 1) local += 12
      else if (gap === 2) local += 7
      else if (gap <= 4) local += 3
    }

    // Semantic closeness with last sentence
    const last = current[current.length - 1]
    const sim = jaccard(contentTokens(segments[last].text), contentTokens(segments[idx].text))
    local += sim * 20

    // Avoid pure filler
    if (includesAny(segments[idx].text, FILLER_HINTS) && segments[idx].text.length < 10) local -= 8
    // Prefer actionable closers near the end
    if (includesAny(segments[idx].text, CTA_HINTS)) local += 3

    // Prefer not re-adding near-duplicates
    for (const c of current) {
      const dup = jaccard(contentTokens(segments[c].text), contentTokens(segments[idx].text))
      if (dup > 0.75) local -= 15
    }

    if (!best || local > best.score) best = { idx, score: local }
  }

  return best?.idx ?? null
}

function repairVariantDuration(
  indexes: number[],
  segments: SimpleSegment[],
  minDuration: number,
  maxDuration: number
): number[] {
  let current = [...indexes]
  let duration = current.reduce((sum, idx) => sum + segments[idx].duration, 0)

  // Too long: drop least harmful sentences while protecting hook/cta and flow
  let guard = 0
  while (duration > maxDuration && current.length > 1 && guard < 40) {
    const next = dropLeastHarmful(current, segments)
    if (next.length === current.length) break
    current = next
    duration = current.reduce((sum, idx) => sum + segments[idx].duration, 0)
    guard++
  }

  // Too short: insert only continuity-friendly candidates
  guard = 0
  while (duration < minDuration && guard < 40) {
    const addIdx = bestInsertCandidate(current, segments, maxDuration, duration)
    if (addIdx === null) break

    // Insert near original neighbors when possible to keep speech natural
    let insertAt = current.length
    let bestPosScore = -Infinity
    for (let pos = 0; pos <= current.length; pos++) {
      let posScore = 0
      const left = pos > 0 ? current[pos - 1] : null
      const right = pos < current.length ? current[pos] : null
      if (left !== null) {
        const gap = Math.abs(left - addIdx)
        posScore += gap === 1 ? 10 : gap === 2 ? 6 : gap <= 4 ? 2 : -2
        posScore += jaccard(contentTokens(segments[left].text), contentTokens(segments[addIdx].text)) * 8
      }
      if (right !== null) {
        const gap = Math.abs(right - addIdx)
        posScore += gap === 1 ? 10 : gap === 2 ? 6 : gap <= 4 ? 2 : -2
        posScore += jaccard(contentTokens(segments[addIdx].text), contentTokens(segments[right].text)) * 8
      }
      // Prefer ending with CTA
      if (pos === current.length && includesAny(segments[addIdx].text, CTA_HINTS)) posScore += 5
      // Prefer not inserting before strong hook opening
      if (pos === 0 && includesAny(segments[current[0]]?.text || '', HOOK_HINTS)) posScore -= 6

      if (posScore > bestPosScore) {
        bestPosScore = posScore
        insertAt = pos
      }
    }

    current = [...current.slice(0, insertAt), addIdx, ...current.slice(insertAt)]
    duration += segments[addIdx].duration
    guard++
  }

  // Final hard clamp if still too long
  guard = 0
  while (duration > maxDuration && current.length > 1 && guard < 20) {
    current = dropLeastHarmful(current, segments)
    duration = current.reduce((sum, idx) => sum + segments[idx].duration, 0)
    guard++
  }

  return current
}

function polishOrderForFluency(indexes: number[], segments: SimpleSegment[]): number[] {
  if (indexes.length <= 2) return indexes

  // Keep chosen set, but gently re-order to improve local continuity.
  // Strategy: start from best hook, then repeatedly append the most coherent remaining sentence.
  const remaining = new Set(indexes)
  let start = indexes[0]
  let bestStartScore = -Infinity
  for (const idx of indexes) {
    let s = includesAny(segments[idx].text, HOOK_HINTS) ? 10 : 0
    s += Math.min(12, segments[idx].text.length / 2)
    // Prefer earlier original lines a bit for natural exposition
    s += Math.max(0, 4 - idx * 0.15)
    if (s > bestStartScore) {
      bestStartScore = s
      start = idx
    }
  }

  const ordered: number[] = [start]
  remaining.delete(start)

  while (remaining.size > 0) {
    const prev = ordered[ordered.length - 1]
    let bestIdx = -1
    let bestScore = -Infinity

    for (const idx of remaining) {
      let s = 0
      const gap = Math.abs(idx - prev)
      if (gap === 1) s += 14
      else if (gap === 2) s += 9
      else if (gap <= 4) s += 4
      else s -= Math.min(8, gap)

      s += jaccard(contentTokens(segments[prev].text), contentTokens(segments[idx].text)) * 24
      if (remaining.size === 1 && includesAny(segments[idx].text, CTA_HINTS)) s += 8
      if (includesAny(segments[idx].text, FILLER_HINTS) && segments[idx].text.length < 10) s -= 5
      // Soft forward bias
      if (idx > prev) s += 2

      if (s > bestScore) {
        bestScore = s
        bestIdx = idx
      }
    }

    if (bestIdx < 0) break
    ordered.push(bestIdx)
    remaining.delete(bestIdx)
  }

  // If polish hurts fluency, keep original
  return scoreFluency(ordered, segments) >= scoreFluency(indexes, segments) ? ordered : indexes
}

function diversifyFallback(
  segments: SimpleSegment[],
  minDuration: number,
  maxDuration: number,
  count: number
): VariantPlan[] {
  if (segments.length === 0) return []

  const hookCandidates = segments
    .map((seg, idx) => ({
      idx,
      score:
        (includesAny(seg.text, HOOK_HINTS) ? 12 : 0) +
        Math.min(20, seg.text.length) * 0.3 +
        (idx < Math.ceil(segments.length * 0.4) ? 2 : 0)
    }))
    .sort((a, b) => b.score - a.score)

  const variants: VariantPlan[] = []
  for (let i = 0; i < count; i++) {
    const startIdx = hookCandidates[i % hookCandidates.length]?.idx ?? 0

    // Grow a continuity-first path from the hook
    const picked: number[] = [startIdx]
    let duration = segments[startIdx].duration
    const used = new Set(picked)

    while (duration < minDuration) {
      const addIdx = bestInsertCandidate(picked, segments, maxDuration, duration)
      if (addIdx === null) break
      // append mostly, but allow continuity insert
      const last = picked[picked.length - 1]
      if (Math.abs(addIdx - last) <= 2) picked.push(addIdx)
      else {
        // find neighbor-ish position
        let pos = picked.length
        for (let p = 1; p < picked.length; p++) {
          if (Math.abs(picked[p] - addIdx) === 1) {
            pos = p + (picked[p] < addIdx ? 1 : 0)
            break
          }
        }
        picked.splice(pos, 0, addIdx)
      }
      used.add(addIdx)
      duration += segments[addIdx].duration
      if (picked.length > segments.length) break
    }

    // Ensure CTA-ish ending if available
    const cta = segments
      .map((seg, idx) => ({ idx, seg }))
      .filter((x) => !used.has(x.idx) && includesAny(x.seg.text, CTA_HINTS))
      .sort((a, b) => b.seg.text.length - a.seg.text.length)[0]
    if (cta && duration + cta.seg.duration <= maxDuration) {
      picked.push(cta.idx)
    }

    const polished = polishOrderForFluency(picked, segments)
    const repaired = repairVariantDuration(polished, segments, minDuration, maxDuration)
    const finalOrder = polishOrderForFluency(repaired, segments)
    const variant = buildVariantFromIndexes(
      finalOrder,
      segments,
      `连贯变体${i + 1}`,
      '本地兜底：优先语义衔接与爆款结构，避免乱序流水账',
      i + 1
    )
    if (variant) variants.push(variant)
  }

  return variants
}

async function refineVariantsWithLlm(
  segments: SimpleSegment[],
  drafts: { name: string; strategy: string; indexes: number[]; preview: string }[],
  minDuration: number,
  maxDuration: number,
  providers: LlmProvider[]
): Promise<{ name: string; strategy: string; indexes: number[] }[] | null> {
  if (drafts.length === 0) return null

  const segmentList = segments.map((seg, i) =>
    `[${i}] (${seg.duration.toFixed(1)}s) ${seg.text}`
  ).join('\n')

  const draftList = drafts.map((d, i) => {
    return `### 草案${i + 1}
名称: ${d.name}
策略: ${d.strategy}
索引: ${JSON.stringify(d.indexes)}
文案: ${d.preview}`
  }).join('\n\n')

  const prompt = `你是口语流畅度审查官。下面有若干“由原句拼接”的短视频草案。
请只做“重选原句 + 重排”，让每条都更通顺、更易懂、更像千川爆款。禁止改写原句文字。

硬性要求：
1. 读起来必须像一个人连续口播，不能乱跳。
2. 禁止流水账和信息重复堆叠。
3. 开头抓人，中段讲清卖点，结尾促行动。
4. 时长尽量落在 ${minDuration}-${maxDuration} 秒（按原句 duration 求和）。
5. 只能使用给定句子编号。

原句列表：
${segmentList}

草案：
${draftList}

返回 JSON 数组：
[
  {"name":"...", "strategy":"...", "segmentIndexes":[...], "preview":"拼接文案"}
]
不要输出其他文字。`

  try {
    const call = await callChatWithFailover(
      providers,
      [
        { role: 'system', content: '你负责把口播剪辑草案优化得通顺自然、信息清晰、具备爆款结构。只返回JSON。' },
        { role: 'user', content: prompt }
      ],
      { temperature: 0.4, timeoutMs: 120000 }
    )
    const arr = parseJsonArray(call.content)

    return arr.map((raw: any) => ({
      name: String(raw?.name || ''),
      strategy: String(raw?.strategy || ''),
      indexes: normalizeIndexes(raw, segments.length)
    })).filter((x) => x.indexes.length > 0)
  } catch {
    return null
  }
}

export async function generateVariants(options: GenerateOptions): Promise<GenerateVariantsResult> {
  const {
    segments,
    minDuration,
    maxDuration,
    variantCount,
    topFluencyOnly = false,
    topFluencyCount = 3,
    providers,
    allowFallback = true,
    apiKey,
    baseUrl,
    model
  } = options
  if (segments.length === 0) return { variants: [], usedFallback: false, notice: '没有可用句子' }

  const providerList: LlmProvider[] = (providers && providers.length > 0)
    ? providers
    : (apiKey && baseUrl && model)
      ? [{ id: 'legacy', name: '默认 API', apiKey, baseUrl, model, enabled: true }]
      : []

  const safeMin = Math.max(1, Math.min(minDuration, maxDuration))
  const safeMax = Math.max(safeMin, maxDuration)
  const requestedCount = Math.max(1, Math.min(20, Math.round(variantCount || 1)))
  const topN = Math.max(1, Math.min(10, Math.round(topFluencyCount || 3)))
  // Strong filter mode: generate more candidates, keep only the best few.
  const safeCount = topFluencyOnly
    ? Math.min(20, Math.max(requestedCount, topN * 2, 6))
    : requestedCount
  const finalKeepCount = topFluencyOnly ? Math.min(topN, safeCount) : requestedCount

  const totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0)
  if (totalDuration < safeMin) {
    throw new Error(`可用口播总时长仅 ${totalDuration.toFixed(1)}s，小于最小目标 ${safeMin}s，请先减少排除内容或降低最小时长`)
  }

  const segmentList = segments.map((seg, i) =>
    `[${i}] (${seg.duration.toFixed(1)}s) "${seg.text}"`
  ).join('\n')

  const fullText = segments.map((s) => s.text).join('')

  const userMessage = `## 完整文稿
${fullText}

## 逐句明细（带编号和时长）
${segmentList}

## 生成任务
- 目标时长：${safeMin}-${safeMax} 秒
- 先生成 ${safeCount} 个候选爆款变体${topFluencyOnly ? `（最终只保留通顺度最高的 ${finalKeepCount} 条）` : ''}
- 每个变体总时长 = 所选句子时长之和，尽量落在 ${safeMin}-${safeMax} 秒
- 共 ${segments.length} 句，总时长 ${totalDuration.toFixed(1)} 秒
- 质量优先：不通顺、流水账、乱跳的方案直接淘汰

## 特别强调
1. 通顺自然，像真人一口气讲完
2. 易懂，3 秒听懂卖点和行动
3. 不要流水账，不要乱序硬拼
4. 结构尽量：钩子 → 痛点 → 卖点 → 证明 → 逼单
5. 每个变体都给出 preview 拼接文案，并确保读起来通顺`

  let rawVariants: any[] = []
  let llmOk = false
  let usedProvider: LlmProvider | null = null
  let usedProviderIndex = -1
  let failedProviders: { name: string; error: string }[] = []
  let usedFallback = false
  let notice = ''

  try {
    if (providerList.length === 0) {
      throw new Error('缺少大模型 API 配置')
    }

    const call = await callChatWithFailover(
      providerList,
      [
        { role: 'system', content: VARIANT_PROMPT },
        { role: 'user', content: userMessage }
      ],
      { temperature: 0.55, timeoutMs: 120000 }
    )

    usedProvider = call.provider
    usedProviderIndex = call.providerIndex
    failedProviders = call.failures.map((f) => ({
      name: f.provider.name || f.provider.model || f.provider.baseUrl,
      error: f.error
    }))
    if (failedProviders.length > 0) {
      notice = `前序 API 失败 ${failedProviders.length} 个，已自动切换到：${usedProvider.name || usedProvider.model}`
    }
    rawVariants = parseJsonArray(call.content)
    llmOk = true
  } catch (err: any) {
    console.error('[generateVariants] all llm failed:', err)
    notice = err?.message || String(err)
    if (!allowFallback) {
      throw new Error(`全部大模型 API 失败，已暂停。请更换/检查 API 后继续。\n${notice}`)
    }
    usedFallback = true
    return {
      variants: diversifyFallback(segments, safeMin, safeMax, finalKeepCount),
      usedProvider: null,
      usedProviderIndex: -1,
      failedProviders,
      usedFallback: true,
      notice: `全部大模型 API 失败，已使用本地兜底方案。请检查/更换 API。\n${notice}`
    }
  }

  type Draft = {
    name: string
    strategy: string
    indexes: number[]
    preview: string
    fluency: number
  }

  const drafts: Draft[] = []
  for (let i = 0; i < rawVariants.length; i++) {
    const raw = rawVariants[i]
    let indexes = normalizeIndexes(raw, segments.length)
    if (indexes.length === 0) continue

    indexes = polishOrderForFluency(indexes, segments)
    indexes = repairVariantDuration(indexes, segments, safeMin, safeMax)
    indexes = polishOrderForFluency(indexes, segments)

    const fluency = scoreFluency(indexes, segments)
    const preview = indexes.map((idx) => segments[idx].text).join('')
    drafts.push({
      name: raw?.name || `变体${i + 1}`,
      strategy: raw?.strategy || raw?.fluencyNote || '',
      indexes,
      preview,
      fluency
    })
  }

  // Second pass: ask LLM to fix awkward drafts (quality over speed)
  if (llmOk && drafts.length > 0) {
    try {
      const refined = await refineVariantsWithLlm(
        segments,
        drafts.slice(0, safeCount),
        safeMin,
        safeMax,
        usedProvider ? [usedProvider, ...providerList.filter((p) => p.id !== usedProvider!.id)] : providerList
      )
      if (refined && refined.length > 0) {
        for (const item of refined) {
          let indexes = polishOrderForFluency(item.indexes, segments)
          indexes = repairVariantDuration(indexes, segments, safeMin, safeMax)
          indexes = polishOrderForFluency(indexes, segments)
          const fluency = scoreFluency(indexes, segments)
          drafts.push({
            name: item.name || '优化变体',
            strategy: item.strategy || '二轮润顺优化',
            indexes,
            preview: indexes.map((idx) => segments[idx].text).join(''),
            fluency: fluency + 1.5
          })
        }
      }
    } catch (err) {
      console.error('[generateVariants] refine failed:', err)
    }
  }

  // Rank by fluency first, duration fitness second; keep diverse openings
  drafts.sort((a, b) => {
    const fluencyDiff = b.fluency - a.fluency
    if (Math.abs(fluencyDiff) > 0.1) return fluencyDiff
    const aDur = a.indexes.reduce((s, i) => s + segments[i].duration, 0)
    const bDur = b.indexes.reduce((s, i) => s + segments[i].duration, 0)
    return scoreDuration(aDur, safeMin, safeMax) - scoreDuration(bDur, safeMin, safeMax)
  })

  const chosen: Draft[] = []
  const usedOpenings = new Set<string>()
  for (const draft of drafts) {
    if (chosen.length >= finalKeepCount) break
    if (draft.indexes.length === 0) continue
    const opening = segments[draft.indexes[0]]?.text?.slice(0, 12) || String(draft.indexes[0])
    // avoid too-similar openings unless inventory is insufficient
    if (usedOpenings.has(opening) && drafts.length > finalKeepCount) continue

    // Strong mode: drop weak fluency more aggressively
    if (topFluencyOnly) {
      if (draft.fluency < 4 && drafts.some((d) => d.fluency >= 8)) continue
    } else if (draft.fluency < 0 && drafts.some((d) => d.fluency >= 6)) {
      continue
    }

    const duration = draft.indexes.reduce((s, i) => s + segments[i].duration, 0)
    if (scoreDuration(duration, safeMin, safeMax) > safeMax) continue

    chosen.push(draft)
    usedOpenings.add(opening)
  }

  // Normal mode can fill remaining slots; strong top-N mode prefers quality over quantity
  if (!topFluencyOnly && chosen.length < finalKeepCount) {
    for (const draft of drafts) {
      if (chosen.length >= finalKeepCount) break
      if (chosen.includes(draft)) continue
      chosen.push(draft)
    }
  }

  // If strong mode still empty, fall back to absolute top fluency drafts
  if (chosen.length === 0 && drafts.length > 0) {
    chosen.push(...drafts.slice(0, finalKeepCount))
  }

  const variants: VariantPlan[] = []
  for (const draft of chosen.slice(0, finalKeepCount)) {
    const strategyParts = [draft.strategy].filter(Boolean)
    if (topFluencyOnly) {
      strategyParts.push(`通顺度优选 Top${finalKeepCount}`)
    } else if (!strategyParts.some((s) => s.includes('通顺') || s.includes('爆款') || s.includes('衔接'))) {
      strategyParts.push('已按通顺度与爆款结构优选')
    }
    const variant = buildVariantFromIndexes(
      draft.indexes,
      segments,
      draft.name,
      strategyParts.join('；'),
      variants.length + 1
    )
    if (variant) variants.push(variant)
  }

  if (variants.length === 0) {
    return {
      variants: diversifyFallback(segments, safeMin, safeMax, finalKeepCount),
      usedProvider,
      usedProviderIndex,
      failedProviders,
      usedFallback: true,
      notice: notice || '未得到可用 LLM 结果，已使用本地兜底'
    }
  }

  // Only pad with fallback when not in strong top-fluency mode
  if (!topFluencyOnly && variants.length < finalKeepCount) {
    const fallback = diversifyFallback(segments, safeMin, safeMax, finalKeepCount - variants.length)
    for (const item of fallback) {
      item.id = variants.length + 1
      item.name = item.name.replace('连贯', '补充连贯')
      variants.push(item)
    }
  }

  // Final hard guarantee: never exceed finalKeepCount (Top3 mode especially)
  const unique: VariantPlan[] = []
  const seenPreview = new Set<string>()
  for (const v of variants) {
    const preview = v.segments.map((s) => s.text).join('').slice(0, 80)
    if (seenPreview.has(preview)) continue
    seenPreview.add(preview)
    unique.push({ ...v, id: unique.length + 1 })
    if (unique.length >= finalKeepCount) break
  }

  if (!notice && usedProvider) {
    notice = `已使用大模型：${usedProvider.name || usedProvider.model}`
  }

  return {
    variants: unique.slice(0, finalKeepCount),
    usedProvider,
    usedProviderIndex,
    failedProviders,
    usedFallback,
    notice
  }
}
