import { callChatWithFailover, type LlmProvider } from "./llm-client";

import type { LlmCallSuccess } from "./llm-client";
import { checkCompliance } from "./compliance-checker";

export interface SimpleSegment {
  start: number;
  end: number;
  text: string;
  duration: number;
  words?: { start: number; end: number; text: string }[];
}

export interface VariantPlan {
  id: number;
  name: string;
  strategy: string;
  segments: SimpleSegment[];
  totalDuration: number;
  targetAudience?: string;
  abLabel?: string;
  pacingHints?: string[];
  quality?: VariantQuality;
}

export interface VariantQuality {
  total: number;
  hook: number;
  clarity: number;
  pain: number;
  sellingPoint: number;
  evidence: number;
  cta: number;
  transition: number;
  compliance: number;
  warnings: string[];
}

export interface MaterialDiagnostics {
  score: number;
  present: string[];
  missing: string[];
  suggestions: string[];
}

export interface ProductBrief {
  productName: string;
  price: string;
  targetAudience: string;
  painPoints: string;
  coreSellingPoints: string;
  evidence: string;
  offer: string;
  cta: string;
  forbiddenWords: string;
  extraPrompt: string;
  templateId?: string;
  hookStrategies?: string[];
  audienceVariants?: boolean;
  enableCompliance?: boolean;
  enableSemanticCheck?: boolean;
  enableAbMatrix?: boolean;
  enablePacing?: boolean;
  subtitleKeywords?: string;
  performanceInsights?: string;
}

export interface GenerateOptions {
  segments: SimpleSegment[];
  minDuration: number;
  maxDuration: number;
  variantCount: number;
  /** When true, over-generate then keep only the top fluency variants. */
  topFluencyOnly?: boolean;
  topFluencyCount?: number;
  /** Multi-provider failover list, ordered by priority. */
  providers?: LlmProvider[];
  /** When false, do not use local fallback if all LLMs fail (batch mode). */
  allowFallback?: boolean;
  brief?: ProductBrief;
  /** Legacy single-provider fields (compat). */
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

export interface GenerateVariantsResult {
  variants: VariantPlan[];
  usedProvider?: LlmProvider | null;
  usedProviderIndex?: number;
  usedModel?: string;
  failedProviders?: { name: string; error: string }[];
  usedFallback?: boolean;
  notice?: string;
  diagnostics?: MaterialDiagnostics;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    byModel: ModelTokenUsage[];
  };
}

export interface ModelTokenUsage {
  providerId: string;
  providerName: string;
  model: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  estimated: boolean;
}

function addModelUsage(
  target: Map<string, ModelTokenUsage>,
  call: LlmCallSuccess,
): void {
  const model = call.model || call.provider.model || "模型未知";
  const key = `${call.provider.id}\u0000${model}`;
  const current = target.get(key);
  target.set(key, {
    providerId: call.provider.id || "unknown",
    providerName:
      call.provider.name?.trim() ||
      call.provider.model ||
      call.provider.baseUrl ||
      "未命名 API",
    model,
    requestCount: (current?.requestCount || 0) + 1,
    inputTokens: (current?.inputTokens || 0) + call.usage.inputTokens,
    outputTokens: (current?.outputTokens || 0) + call.usage.outputTokens,
    estimated: Boolean(current?.estimated || call.usage.estimated),
  });
}

function buildUsage(
  target: Map<string, ModelTokenUsage>,
): GenerateVariantsResult["usage"] {
  const byModel = Array.from(target.values());
  return {
    inputTokens: byModel.reduce((sum, item) => sum + item.inputTokens, 0),
    outputTokens: byModel.reduce((sum, item) => sum + item.outputTokens, 0),
    byModel,
  };
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
    "segmentIndexes": [3, 5, 6, 9, 12]
  }
]

segmentIndexes 从 0 开始，按最终播放顺序排列。
不要返回空数组；尽量返回请求数量的变体。
不要重复返回原句文案，只返回编号，减少输出长度。`;

const HOOK_HINTS = [
  "别",
  "你是不是",
  "为什么",
  "千万",
  "注意",
  "真相",
  "居然",
  "竟然",
  "谁说",
  "还在",
  "后悔",
  "便宜",
  "免费",
  "限时",
  "爆",
  "绝了",
  "救命",
  "蹲",
  "冲",
];
const CTA_HINTS = [
  "下单",
  "点击",
  "购买",
  "拍下",
  "直接拍",
  "拍一单",
  "上车",
  "链接",
  "马上",
  "立即",
  "现在就买",
  "现在下单",
  "别犹豫",
  "库存",
  "限时",
  "优惠",
  "到手",
  "加购",
  "领券",
  "领取",
];
const FILLER_HINTS = [
  "然后",
  "就是说",
  "那个",
  "这个呢",
  "嗯",
  "啊",
  "对吧",
  "好吧",
  "接下来",
  "我们再看",
  "简单说一下",
];

function parseJsonArray(content: string): any[] {
  const raw = String(content || "").trim();
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");

  if (start >= 0 && end > start) {
    const jsonStr = raw.slice(start, end + 1);
    const candidates = [
      jsonStr.replace(/,\s*([}\]])/g, "$1"),
      jsonStr
        .replace(/，/g, ",")
        .replace(/：/g, ":")
        .replace(/[“”]/g, '"')
        .replace(/,\s*([}\]])/g, "$1"),
    ];

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch {}
    }
  }

  // Models often break quotes/commas in name or strategy while the index arrays remain valid.
  // The indexes are the only fields required to build a video, so salvage them locally.
  const salvaged: any[] = [];
  const indexPattern =
    /["“”']?(?:segmentIndexes|segment_indexes|indexes|segments)["“”']?\s*[:：]\s*\[([^\]]+)\]/gi;
  let match: RegExpExecArray | null;
  while ((match = indexPattern.exec(raw)) !== null) {
    const indexes = (match[1]!.match(/-?\d+/g) || [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0);
    if (indexes.length === 0) continue;

    const contextStart = Math.max(0, raw.lastIndexOf("{", match.index));
    const context = raw.slice(contextStart, match.index);
    const nameMatch = context.match(
      /["“”']?name["“”']?\s*[:：]\s*["“”']([^"“”'\r\n,，}]{1,40})/i,
    );
    const strategyMatch = context.match(
      /["“”']?strategy["“”']?\s*[:：]\s*["“”']([^"“”'\r\n}]{1,120})/i,
    );
    salvaged.push({
      name: nameMatch?.[1]?.trim() || `自动恢复变体${salvaged.length + 1}`,
      strategy: strategyMatch?.[1]?.trim() || "AI 格式容错恢复",
      segmentIndexes: indexes,
    });
  }

  if (salvaged.length > 0) return salvaged;
  throw new Error("AI 返回格式异常，且未找到可恢复的句子编号");
}

async function repairVariantJson(
  content: string,
  providers: LlmProvider[],
): Promise<LlmCallSuccess> {
  const clipped = String(content || "").slice(0, 24_000);
  if (!clipped.trim()) throw new Error("AI 返回内容为空，无法修复");

  const call = await callChatWithFailover(
    providers,
    [
      {
        role: "system",
        content:
          "你是 JSON 修复器。只返回合法 JSON 数组，不要 Markdown、解释或原句全文。保留 name、strategy、segmentIndexes 字段。",
      },
      {
        role: "user",
        content: `修复下面的模型输出。删除不完整对象和多余文字，至少保留一个完整方案：\n${clipped}`,
      },
    ],
    { temperature: 0, timeoutMs: 300000 },
  );

  return call;
}

function normalizeIndexes(raw: any, segmentCount: number): number[] {
  const source = Array.isArray(raw?.segmentIndexes)
    ? raw.segmentIndexes
    : Array.isArray(raw?.indexes)
      ? raw.indexes
      : Array.isArray(raw?.segments)
        ? raw.segments
        : [];

  const indexes: number[] = [];
  const seen = new Set<number>();

  for (const item of source) {
    const idx = typeof item === "number" ? item : Number(item);
    if (
      !Number.isInteger(idx) ||
      idx < 0 ||
      idx >= segmentCount ||
      seen.has(idx)
    )
      continue;
    seen.add(idx);
    indexes.push(idx);
  }

  return indexes;
}

function includesAny(text: string, hints: string[]): boolean {
  return hints.some((h) => text.includes(h));
}

function contentTokens(text: string): Set<string> {
  const tokens = text
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, " ")
    .split(/\s+/)
    .flatMap((part) => {
      if (!part) return [];
      if (/[\u4e00-\u9fa5]/.test(part)) {
        const chars = [...part];
        const grams: string[] = [];
        for (let i = 0; i < chars.length; i++) {
          grams.push(chars[i]!);
          if (i + 1 < chars.length) grams.push(chars[i]! + chars[i + 1]!);
        }
        return grams;
      }
      return [part.toLowerCase()];
    })
    .filter((t) => t.length > 0);

  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function scoreDuration(
  duration: number,
  minDuration: number,
  maxDuration: number,
): number {
  if (duration >= minDuration && duration <= maxDuration) return 0;
  if (duration < minDuration) return minDuration - duration;
  return duration - maxDuration;
}

function scoreFluency(indexes: number[], segments: SimpleSegment[]): number {
  if (indexes.length === 0) return -999;

  let score = 0;
  const texts = indexes.map((i) => segments[i]!.text);
  const first = texts[0] || "";
  const last = texts[texts.length - 1] || "";

  // Opening / ending quality
  if (includesAny(first, HOOK_HINTS)) score += 8;
  else if (first.length >= 8) score += 2;
  else score -= 4;

  if (includesAny(last, CTA_HINTS)) score += 8;
  else score -= 2;

  // Continuity between neighbors
  for (let i = 0; i < indexes.length - 1; i++) {
    const a = indexes[i]!;
    const b = indexes[i + 1]!;
    const gap = Math.abs(b - a);
    if (gap === 1) score += 10;
    else if (gap === 2) score += 6;
    else if (gap <= 4) score += 2;
    else if (gap >= 8) score -= 6;

    const sim = jaccard(
      contentTokens(segments[a]!.text),
      contentTokens(segments[b]!.text),
    );
    if (sim >= 0.12) score += 4;
    else if (sim < 0.03 && gap > 3) score -= 5;
  }

  // Penalize near-duplicate consecutive content
  for (let i = 0; i < texts.length - 1; i++) {
    const sim = jaccard(contentTokens(texts[i]!), contentTokens(texts[i + 1]!));
    if (sim > 0.72) score -= 8;
  }

  // Penalize filler-heavy scripts
  const fillerCount = texts.filter(
    (t) => includesAny(t, FILLER_HINTS) && t.length < 12,
  ).length;
  score -= fillerCount * 3;

  // Prefer compact, information-dense cuts over long rambling
  const avgLen = texts.reduce((s, t) => s + t.length, 0) / texts.length;
  if (avgLen >= 10 && avgLen <= 28) score += 3;
  if (texts.length >= 3 && texts.length <= 12) score += 2;

  // Mild preference for mostly forward storytelling (not totally shuffled chaos)
  let forward = 0;
  for (let i = 1; i < indexes.length; i++)
    if (indexes[i]! > indexes[i - 1]!) forward++;
  const forwardRatio = forward / Math.max(1, indexes.length - 1);
  if (forwardRatio >= 0.55) score += 4;
  if (forwardRatio < 0.25) score -= 6;

  return score;
}

const EVIDENCE_HINTS = [
  "检测",
  "报告",
  "专利",
  "认证",
  "数据",
  "销量",
  "回购",
  "用户",
  "评价",
  "对比",
  "实测",
  "成分",
  "材质",
  "工艺",
];
const PAIN_HINTS = [
  "难",
  "烦",
  "痛",
  "贵",
  "慢",
  "累",
  "怕",
  "担心",
  "浪费",
  "反复",
  "不好",
  "不够",
  "不会",
  "没有",
];
const BENEFIT_HINTS = [
  "省",
  "快",
  "方便",
  "改善",
  "提升",
  "帮助",
  "效果",
  "好用",
  "舒服",
  "轻松",
  "清洁",
  "显瘦",
  "好吃",
];
const HOOK_STRATEGY_LABELS: Record<string, string> = {
  curiosity: "好奇悬念",
  pain: "痛点直击",
  benefit: "利益结果",
  anti_common: "反常识",
  identity: "身份筛选",
  price: "价格冲击",
  urgency: "紧迫稀缺",
  mixed: "综合策略",
};
const TEMPLATE_LABELS: Record<string, string> = {
  general: "通用投流",
  beauty: "美妆个护",
  food: "食品饮料",
  home: "家清日用",
  apparel: "服饰鞋包",
  knowledge: "知识服务",
};

function splitTerms(value?: string): string[] {
  return String(value || "")
    .split(/[，,、；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function containsTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => term && text.includes(term));
}

function diagnoseMaterial(
  segments: SimpleSegment[],
  brief?: ProductBrief,
): MaterialDiagnostics {
  const text = segments.map((segment) => segment.text).join("");
  const present: string[] = [];
  const missing: string[] = [];
  const suggestions: string[] = [];
  const checks = [
    {
      label: "强钩子",
      ok:
        includesAny(
          text.slice(0, Math.max(80, Math.ceil(text.length * 0.3))),
          HOOK_HINTS,
        ) || /[？?！!]/.test(text.slice(0, 80)),
      suggestion: "补录一条带冲突、疑问、身份筛选或明确利益点的开场。",
    },
    {
      label: "用户痛点",
      ok: containsTerm(text, [...PAIN_HINTS, ...splitTerms(brief?.painPoints)]),
      suggestion: "补录目标用户正在经历的具体麻烦和场景。",
    },
    {
      label: "核心卖点",
      ok: containsTerm(text, [
        ...BENEFIT_HINTS,
        ...splitTerms(brief?.coreSellingPoints),
      ]),
      suggestion: "补录最核心的一个结果型卖点，避免只介绍产品参数。",
    },
    {
      label: "信任证据",
      ok: containsTerm(text, [
        ...EVIDENCE_HINTS,
        ...splitTerms(brief?.evidence),
      ]),
      suggestion: "补录检测、数据、使用对比、材质或真实反馈。",
    },
    {
      label: "价格权益",
      ok:
        /\d+\s*(元|块|折|件|盒|瓶)|优惠|券|赠|到手|买.+送/.test(text) ||
        containsTerm(text, splitTerms(brief?.offer)),
      suggestion: "补录价格、到手权益或限时活动，降低用户决策成本。",
    },
    {
      label: "行动句",
      ok:
        includesAny(text, CTA_HINTS) ||
        containsTerm(text, splitTerms(brief?.cta)),
      suggestion: "补录明确的点击、下单、领券或加购行动句。",
    },
  ];

  for (const check of checks) {
    if (check.ok) present.push(check.label);
    else {
      missing.push(check.label);
      suggestions.push(check.suggestion);
    }
  }

  return {
    score: Math.round((present.length / checks.length) * 100),
    present,
    missing,
    suggestions,
  };
}

function scoreVariantQuality(
  variant: VariantPlan,
  brief?: ProductBrief,
): VariantQuality {
  const texts = variant.segments.map((segment) => segment.text || "");
  const text = texts.join("");
  const first = texts[0] || "";
  const last = texts[texts.length - 1] || "";
  const painTerms = [...PAIN_HINTS, ...splitTerms(brief?.painPoints)];
  const sellingTerms = [
    ...BENEFIT_HINTS,
    ...splitTerms(brief?.coreSellingPoints),
  ];
  const evidenceTerms = [...EVIDENCE_HINTS, ...splitTerms(brief?.evidence)];

  const hook = Math.min(
    100,
    (includesAny(first, HOOK_HINTS) ? 70 : 25) +
      (/[？?！!]/.test(first) ? 20 : 0) +
      (first.length >= 8 && first.length <= 35 ? 10 : 0),
  );
  const clarity = Math.min(
    100,
    35 +
      (brief?.productName && text.includes(brief.productName) ? 30 : 0) +
      (text.length >= 40 ? 20 : 0) +
      (texts.length >= 3 ? 15 : 0),
  );
  const pain = containsTerm(text, painTerms) ? 90 : 35;
  const sellingPoint = containsTerm(text, sellingTerms) ? 90 : 35;
  const evidence = containsTerm(text, evidenceTerms) ? 90 : 30;
  const cta =
    includesAny(last, CTA_HINTS) || containsTerm(last, splitTerms(brief?.cta))
      ? 95
      : includesAny(text, CTA_HINTS)
        ? 70
        : 25;

  let transitionTotal = 0;
  for (let index = 0; index < texts.length - 1; index++) {
    const similarity = jaccard(
      contentTokens(texts[index]!),
      contentTokens(texts[index + 1]!),
    );
    transitionTotal += similarity >= 0.12 ? 95 : similarity >= 0.05 ? 75 : 50;
  }
  const transition =
    texts.length <= 1 ? 60 : Math.round(transitionTotal / (texts.length - 1));

  const customForbidden = splitTerms(brief?.forbiddenWords);
  const customHits = customForbidden.filter((word) => text.includes(word));
  const complianceViolations =
    brief?.enableCompliance === false ? [] : checkCompliance([text]);
  const errorCount =
    complianceViolations.filter((item) => item.severity === "error").length +
    customHits.length;
  const compliance = Math.max(
    0,
    100 -
      errorCount * 35 -
      complianceViolations.filter((item) => item.severity === "warning")
        .length *
        10,
  );
  const warnings = [
    ...customHits.map((word) => `命中自定义禁用词：${word}`),
    ...complianceViolations.map((item) =>
      item.message.replace(/^变体1\s*/, ""),
    ),
    ...(brief?.enableSemanticCheck !== false && transition < 65
      ? ["语义转场偏弱，建议人工检查相邻句子的主语、指代和因果关系。"]
      : []),
    ...(hook < 60 ? ["开场钩子偏弱，前 3 秒可能难以留住用户。"] : []),
    ...(sellingPoint < 60
      ? ["核心卖点不够明确，用户可能听不懂为什么要买。"]
      : []),
    ...(cta < 60
      ? ["结尾行动句偏弱，建议补充点击、领券、加购或下单动作。"]
      : []),
  ].slice(0, 8);

  const total = Math.round(
    hook * 0.18 +
      clarity * 0.12 +
      pain * 0.12 +
      sellingPoint * 0.16 +
      evidence * 0.12 +
      cta * 0.12 +
      transition * 0.12 +
      compliance * 0.06,
  );

  return {
    total,
    hook,
    clarity,
    pain,
    sellingPoint,
    evidence,
    cta,
    transition,
    compliance,
    warnings,
  };
}

function buildPacingHints(
  variant: VariantPlan,
  brief?: ProductBrief,
): string[] | undefined {
  if (!brief?.enablePacing) return undefined;

  const hints: string[] = [];
  const text = variant.segments.map((segment) => segment.text).join("");
  const firstDuration = variant.segments[0]?.duration || 0;
  const keywordHits = splitTerms(brief.subtitleKeywords)
    .filter((keyword) => text.includes(keyword))
    .slice(0, 8);
  const shortSentenceCount = variant.segments.filter(
    (segment) => segment.duration <= 2.8,
  ).length;
  const ctaIndex = variant.segments.findIndex((segment) =>
    includesAny(segment.text, CTA_HINTS),
  );

  hints.push(
    firstDuration <= 3.2
      ? "前 3 秒保持快节奏，钩子句使用大字字幕并尽快出现核心利益点。"
      : "首句超过 3 秒，建议在首句中间增加画面切换或字幕分屏，避免开场拖沓。",
  );
  if (keywordHits.length > 0)
    hints.push(`重点字幕：${keywordHits.join("、")}，建议放大或换色突出。`);
  if (shortSentenceCount >= Math.ceil(variant.segments.length / 2)) {
    hints.push("短句较多，适合 1.5-3 秒一切镜，画面跟随每个卖点变化。");
  } else {
    hints.push(
      "长句较多，建议每句至少安排一次景别或素材变化，降低单画面疲劳。",
    );
  }
  if (ctaIndex >= 0)
    hints.push(
      `第 ${ctaIndex + 1} 句为行动句，结尾建议保留约 1 秒商品与按钮停留。`,
    );
  return hints.slice(0, 4);
}

export function classifyHookStrategy(
  text: string,
  brief?: ProductBrief,
  fallback = "mixed",
): string {
  const opening = String(text || "").slice(0, 60);
  const audienceTerms = splitTerms(brief?.targetAudience);

  if (/\d+(?:\.\d+)?\s*(元|块|折)|到手价|价格|便宜|立省/.test(opening))
    return "price";
  if (/限时|最后|仅剩|库存|错过|今天|马上结束|倒计时/.test(opening))
    return "urgency";
  if (
    containsTerm(opening, audienceTerms) ||
    /(宝妈|上班族|学生党|新手|老板|打工人|姐妹|男生|女生|中老年|年轻人)/.test(
      opening,
    )
  )
    return "identity";
  if (/不是|并不是|别再|谁说|误区|很多人都错了|真相/.test(opening))
    return "anti_common";
  if (/[？?]/.test(opening) || /为什么|你知道吗|没想到|居然|竟然/.test(opening))
    return "curiosity";
  if (containsTerm(opening, [...PAIN_HINTS, ...splitTerms(brief?.painPoints)]))
    return "pain";
  if (
    containsTerm(opening, [
      ...BENEFIT_HINTS,
      ...splitTerms(brief?.coreSellingPoints),
    ])
  )
    return "benefit";
  return fallback;
}

function enrichVariants(
  variants: VariantPlan[],
  brief?: ProductBrief,
): VariantPlan[] {
  const audiences = splitTerms(brief?.targetAudience);
  const hookStrategies = brief?.hookStrategies?.length
    ? brief.hookStrategies
    : ["mixed"];
  return variants
    .map((variant, index) => {
      const audience =
        brief?.audienceVariants !== false && audiences.length > 0
          ? audiences[index % audiences.length]
          : undefined;
      const plannedHookStrategy = hookStrategies[index % hookStrategies.length];
      const hookStrategy = classifyHookStrategy(
        variant.segments[0]?.text || "",
        brief,
        plannedHookStrategy,
      );
      const quality = scoreVariantQuality(variant, brief);
      const hookLabel = HOOK_STRATEGY_LABELS[hookStrategy] || hookStrategy;
      return {
        ...variant,
        targetAudience: audience,
        abLabel:
          brief?.enableAbMatrix === false
            ? undefined
            : `${hookLabel}-${index + 1}${audience ? `-${audience}` : ""}`,
        pacingHints: buildPacingHints(variant, brief),
        quality,
      };
    })
    .sort(
      (left, right) => (right.quality?.total || 0) - (left.quality?.total || 0),
    );
}

function buildVariantFromIndexes(
  indexes: number[],
  segments: SimpleSegment[],
  name: string,
  strategy: string,
  id: number,
): VariantPlan | null {
  const selected = indexes.map((idx) => segments[idx]!).filter(Boolean);
  if (selected.length === 0) return null;

  const totalDuration = selected.reduce((sum, s) => sum + s.duration, 0);
  return {
    id,
    name,
    strategy,
    segments: selected,
    totalDuration,
  };
}

function keepVariantsInDurationRange(
  variants: VariantPlan[],
  minDuration: number,
  maxDuration: number,
): VariantPlan[] {
  return variants.filter(
    (variant) =>
      variant.totalDuration >= minDuration - 0.35 &&
      variant.totalDuration <= maxDuration + 0.35,
  );
}

function dropLeastHarmful(
  indexes: number[],
  segments: SimpleSegment[],
): number[] {
  if (indexes.length <= 1) return indexes;

  let bestIdx = -1;
  let bestScore = -Infinity;

  for (let i = 0; i < indexes.length; i++) {
    // Prefer not dropping first hook and last CTA unless necessary
    let score = segments[indexes[i]!]!.duration;
    if (i === 0) score -= 100;
    if (i === indexes.length - 1) score -= 40;
    if (includesAny(segments[indexes[i]!]!.text, FILLER_HINTS)) score += 30;
    if (
      includesAny(segments[indexes[i]!]!.text, CTA_HINTS) &&
      i === indexes.length - 1
    )
      score -= 50;
    if (includesAny(segments[indexes[i]!]!.text, HOOK_HINTS) && i === 0)
      score -= 50;

    // Dropping a middle sentence that breaks a tight original pair is costly
    if (i > 0 && i < indexes.length - 1) {
      const prev = indexes[i - 1]!;
      const next = indexes[i + 1]!;
      if (Math.abs(next - prev) === 1) score -= 20;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx < 0) return indexes.slice(0, -1);
  return indexes.filter((_, i) => i !== bestIdx);
}

function bestInsertCandidate(
  current: number[],
  segments: SimpleSegment[],
  maxDuration: number,
  currentDuration: number,
): number | null {
  const used = new Set(current);
  let best: { idx: number; score: number } | null = null;

  for (let idx = 0; idx < segments.length; idx++) {
    if (used.has(idx)) continue;
    const nextDur = currentDuration + segments[idx]!.duration;
    if (nextDur > maxDuration + 0.35) continue;

    // Prefer original-neighborhood continuity
    let local = 0;
    for (const c of current) {
      const gap = Math.abs(c - idx);
      if (gap === 1) local += 12;
      else if (gap === 2) local += 7;
      else if (gap <= 4) local += 3;
    }

    // Semantic closeness with last sentence
    const last = current[current.length - 1]!;
    const sim = jaccard(
      contentTokens(segments[last]!.text),
      contentTokens(segments[idx]!.text),
    );
    local += sim * 20;

    // Avoid pure filler
    if (
      includesAny(segments[idx]!.text, FILLER_HINTS) &&
      segments[idx]!.text.length < 10
    )
      local -= 8;
    // Prefer actionable closers near the end
    if (includesAny(segments[idx]!.text, CTA_HINTS)) local += 3;

    // Prefer not re-adding near-duplicates
    for (const c of current) {
      const dup = jaccard(
        contentTokens(segments[c]!.text),
        contentTokens(segments[idx]!.text),
      );
      if (dup > 0.75) local -= 15;
    }

    if (!best || local > best.score) best = { idx, score: local };
  }

  return best?.idx ?? null;
}

function repairVariantDuration(
  indexes: number[],
  segments: SimpleSegment[],
  minDuration: number,
  maxDuration: number,
): number[] {
  let current = [...indexes];
  let duration = current.reduce((sum, idx) => sum + segments[idx]!.duration, 0);

  // Too long: drop least harmful sentences while protecting hook/cta and flow
  let guard = 0;
  while (duration > maxDuration && current.length > 1 && guard < 40) {
    const next = dropLeastHarmful(current, segments);
    if (next.length === current.length) break;
    current = next;
    duration = current.reduce((sum, idx) => sum + segments[idx]!.duration, 0);
    guard++;
  }

  // Too short: insert only continuity-friendly candidates
  guard = 0;
  while (duration < minDuration && guard < 40) {
    const addIdx = bestInsertCandidate(
      current,
      segments,
      maxDuration,
      duration,
    );
    if (addIdx === null) break;

    // Insert near original neighbors when possible to keep speech natural
    let insertAt = current.length;
    let bestPosScore = -Infinity;
    for (let pos = 0; pos <= current.length; pos++) {
      let posScore = 0;
      const left = pos > 0 ? current[pos - 1]! : null;
      const right = pos < current.length ? current[pos]! : null;
      if (left !== null) {
        const gap = Math.abs(left - addIdx);
        posScore += gap === 1 ? 10 : gap === 2 ? 6 : gap <= 4 ? 2 : -2;
        posScore +=
          jaccard(
            contentTokens(segments[left]!.text),
            contentTokens(segments[addIdx]!.text),
          ) * 8;
      }
      if (right !== null) {
        const gap = Math.abs(right - addIdx);
        posScore += gap === 1 ? 10 : gap === 2 ? 6 : gap <= 4 ? 2 : -2;
        posScore +=
          jaccard(
            contentTokens(segments[addIdx]!.text),
            contentTokens(segments[right]!.text),
          ) * 8;
      }
      // Prefer ending with CTA
      if (
        pos === current.length &&
        includesAny(segments[addIdx]!.text, CTA_HINTS)
      )
        posScore += 5;
      // Prefer not inserting before strong hook opening
      if (
        pos === 0 &&
        includesAny(segments[current[0]!]?.text || "", HOOK_HINTS)
      )
        posScore -= 6;

      if (posScore > bestPosScore) {
        bestPosScore = posScore;
        insertAt = pos;
      }
    }

    current = [
      ...current.slice(0, insertAt),
      addIdx,
      ...current.slice(insertAt),
    ];
    duration += segments[addIdx]!.duration;
    guard++;
  }

  // Final hard clamp if still too long
  guard = 0;
  while (duration > maxDuration && current.length > 1 && guard < 20) {
    current = dropLeastHarmful(current, segments);
    duration = current.reduce((sum, idx) => sum + segments[idx]!.duration, 0);
    guard++;
  }

  return current;
}

function polishOrderForFluency(
  indexes: number[],
  segments: SimpleSegment[],
): number[] {
  if (indexes.length <= 2) return indexes;

  // Keep chosen set, but gently re-order to improve local continuity.
  // Strategy: start from best hook, then repeatedly append the most coherent remaining sentence.
  const remaining = new Set(indexes);
  let start = indexes[0]!;
  let bestStartScore = -Infinity;
  for (const idx of indexes) {
    let s = includesAny(segments[idx]!.text, HOOK_HINTS) ? 10 : 0;
    s += Math.min(12, segments[idx]!.text.length / 2);
    // Prefer earlier original lines a bit for natural exposition
    s += Math.max(0, 4 - idx * 0.15);
    if (s > bestStartScore) {
      bestStartScore = s;
      start = idx;
    }
  }

  const ordered: number[] = [start];
  remaining.delete(start);

  while (remaining.size > 0) {
    const prev = ordered[ordered.length - 1]!;
    let bestIdx = -1;
    let bestScore = -Infinity;

    for (const idx of remaining) {
      let s = 0;
      const gap = Math.abs(idx - prev);
      if (gap === 1) s += 14;
      else if (gap === 2) s += 9;
      else if (gap <= 4) s += 4;
      else s -= Math.min(8, gap);

      s +=
        jaccard(
          contentTokens(segments[prev]!.text),
          contentTokens(segments[idx]!.text),
        ) * 24;
      if (remaining.size === 1 && includesAny(segments[idx]!.text, CTA_HINTS))
        s += 8;
      if (
        includesAny(segments[idx]!.text, FILLER_HINTS) &&
        segments[idx]!.text.length < 10
      )
        s -= 5;
      // Soft forward bias
      if (idx > prev) s += 2;

      if (s > bestScore) {
        bestScore = s;
        bestIdx = idx;
      }
    }

    if (bestIdx < 0) break;
    ordered.push(bestIdx);
    remaining.delete(bestIdx);
  }

  // If polish hurts fluency, keep original
  return scoreFluency(ordered, segments) >= scoreFluency(indexes, segments)
    ? ordered
    : indexes;
}

function diversifyFallback(
  segments: SimpleSegment[],
  minDuration: number,
  maxDuration: number,
  count: number,
): VariantPlan[] {
  if (segments.length === 0) return [];

  const hookCandidates = segments
    .map((seg, idx) => ({
      idx,
      score:
        (includesAny(seg.text, HOOK_HINTS) ? 12 : 0) +
        Math.min(20, seg.text.length) * 0.3 +
        (idx < Math.ceil(segments.length * 0.4) ? 2 : 0),
    }))
    .sort((a, b) => b.score - a.score);

  const variants: VariantPlan[] = [];
  for (let i = 0; i < count; i++) {
    const startIdx = hookCandidates[i % hookCandidates.length]?.idx ?? 0;

    // Grow a continuity-first path from the hook
    const picked: number[] = [startIdx];
    let duration = segments[startIdx]!.duration;
    const used = new Set(picked);

    while (duration < minDuration) {
      const addIdx = bestInsertCandidate(
        picked,
        segments,
        maxDuration,
        duration,
      );
      if (addIdx === null) break;
      // append mostly, but allow continuity insert
      const last = picked[picked.length - 1]!;
      if (Math.abs(addIdx - last) <= 2) picked.push(addIdx);
      else {
        // find neighbor-ish position
        let pos = picked.length;
        for (let p = 1; p < picked.length; p++) {
          if (Math.abs(picked[p]! - addIdx) === 1) {
            pos = p + (picked[p]! < addIdx ? 1 : 0);
            break;
          }
        }
        picked.splice(pos, 0, addIdx);
      }
      used.add(addIdx);
      duration += segments[addIdx]!.duration;
      if (picked.length > segments.length) break;
    }

    // Ensure CTA-ish ending if available
    const cta = segments
      .map((seg, idx) => ({ idx, seg }))
      .filter((x) => !used.has(x.idx) && includesAny(x.seg.text, CTA_HINTS))
      .sort((a, b) => b.seg.text.length - a.seg.text.length)[0];
    if (cta && duration + cta.seg.duration <= maxDuration) {
      picked.push(cta.idx);
    }

    const polished = polishOrderForFluency(picked, segments);
    const repaired = repairVariantDuration(
      polished,
      segments,
      minDuration,
      maxDuration,
    );
    const finalOrder = polishOrderForFluency(repaired, segments);
    const variant = buildVariantFromIndexes(
      finalOrder,
      segments,
      `连贯变体${i + 1}`,
      "本地兜底：优先语义衔接与爆款结构，避免乱序流水账",
      i + 1,
    );
    if (variant) variants.push(variant);
  }

  return variants;
}

async function refineVariantsWithLlm(
  segments: SimpleSegment[],
  drafts: {
    name: string;
    strategy: string;
    indexes: number[];
    preview: string;
  }[],
  minDuration: number,
  maxDuration: number,
  providers: LlmProvider[],
): Promise<LlmCallSuccess | null> {
  if (drafts.length === 0) return null;

  const segmentList = segments
    .map((seg, i) => `[${i}] (${seg.duration.toFixed(1)}s) ${seg.text}`)
    .join("\n");

  const draftList = drafts
    .map((d, i) => {
      return `### 草案${i + 1}
名称: ${d.name}
策略: ${d.strategy}
索引: ${JSON.stringify(d.indexes)}
文案: ${d.preview}`;
    })
    .join("\n\n");

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
  {"name":"...", "strategy":"...", "segmentIndexes":[...]}
]
不要输出其他文字。`;

  try {
    const call = await callChatWithFailover(
      providers,
      [
        {
          role: "system",
          content:
            "你负责把口播剪辑草案优化得通顺自然、信息清晰、具备爆款结构。只返回JSON。",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.4, timeoutMs: 300000 },
    );
    return call;
  } catch {
    return null;
  }
}

function buildBriefContext(brief?: ProductBrief): string {
  if (!brief) return "未提供商品 Brief。从原口播中推断卖点和结构。";
  const lines: string[] = [];
  if (brief.productName) lines.push(`商品：${brief.productName}`);
  if (brief.price) lines.push(`价格：${brief.price}`);
  if (brief.targetAudience) lines.push(`目标人群：${brief.targetAudience}`);
  if (brief.painPoints) lines.push(`核心痛点：${brief.painPoints}`);
  if (brief.coreSellingPoints)
    lines.push(`核心卖点：${brief.coreSellingPoints}`);
  if (brief.evidence) lines.push(`信任证据：${brief.evidence}`);
  if (brief.offer) lines.push(`优惠活动：${brief.offer}`);
  if (brief.cta) lines.push(`喊单句：${brief.cta}`);
  if (brief.forbiddenWords)
    lines.push(`禁用词（禁止在变体中出现）：${brief.forbiddenWords}`);
  if (brief.templateId)
    lines.push(
      `投流模板：${TEMPLATE_LABELS[brief.templateId] || brief.templateId}`,
    );
  if (brief.hookStrategies?.length) {
    lines.push(
      `优先钩子策略：${brief.hookStrategies.map((strategy) => HOOK_STRATEGY_LABELS[strategy] || strategy).join("、")}`,
    );
  }
  if (brief.audienceVariants !== false && brief.targetAudience)
    lines.push("不同候选尽量面向不同目标人群，避免所有版本使用相同叙事角度。");
  if (brief.enableAbMatrix !== false)
    lines.push(
      "按 A/B 测试思路生成：固定主体卖点，优先改变开场钩子、人群角度和结尾 CTA。",
    );
  if (brief.enableSemanticCheck !== false)
    lines.push(
      "对每个句子连接处检查主语、指代、因果和时态，低连贯连接必须换句。",
    );
  if (brief.enablePacing)
    lines.push(
      `节奏提示：优先保留可形成强字幕节奏的短句${brief.subtitleKeywords ? `，重点词：${brief.subtitleKeywords}` : ""}。`,
    );
  if (brief.performanceInsights)
    lines.push(`历史投放数据回流：\n${brief.performanceInsights}`);
  if (brief.extraPrompt) lines.push(`额外指令：${brief.extraPrompt}`);
  return lines.length > 0 ? lines.join("\n") : "未提供商品 Brief。";
}

export async function generateVariants(
  options: GenerateOptions,
): Promise<GenerateVariantsResult> {
  if (!options || typeof options !== "object")
    throw new Error("AI 重组参数无效");
  const rawSegments = Array.isArray(options.segments) ? options.segments : [];
  if (rawSegments.length > 5000)
    throw new Error("识别片段过多，请减少碎片化删词后重试");
  const segments: SimpleSegment[] = rawSegments
    .map((segment) => {
      const startValue = Number(segment?.start);
      const endValue = Number(segment?.end);
      const durationValue = Number(segment?.duration);
      const start =
        Number.isFinite(startValue) && startValue >= 0 ? startValue : 0;
      const hasValidRange = Number.isFinite(endValue) && endValue > start;
      const duration = hasValidRange
        ? endValue - start
        : Number.isFinite(durationValue) && durationValue > 0
          ? durationValue
          : 0;
      const end = hasValidRange ? endValue : start + duration;
      return {
        start,
        end,
        duration,
        text: String(segment?.text || "").trim(),
        words: Array.isArray(segment?.words) ? segment.words : undefined,
      };
    })
    .filter(
      (segment) =>
        segment.text.length > 0 &&
        segment.duration >= 0.05 &&
        segment.end > segment.start,
    );

  const {
    minDuration,
    maxDuration,
    variantCount,
    topFluencyOnly = false,
    topFluencyCount = 3,
    providers,
    allowFallback = true,
    apiKey,
    baseUrl,
    model,
    brief,
  } = options;
  if (segments.length === 0)
    return { variants: [], usedFallback: false, notice: "没有可用句子" };

  const providerList: LlmProvider[] =
    providers && providers.length > 0
      ? providers
      : apiKey && baseUrl && model
        ? [
            {
              id: "legacy",
              name: "默认 API",
              apiKey,
              baseUrl,
              model,
              enabled: true,
            },
          ]
        : [];

  const minValue = Number(minDuration);
  const maxValue = Number(maxDuration);
  const normalizedMin = Number.isFinite(minValue) ? minValue : 25;
  const normalizedMax = Number.isFinite(maxValue) ? maxValue : 55;
  const safeMin = Math.max(
    1,
    Math.min(600, Math.min(normalizedMin, normalizedMax)),
  );
  const safeMax = Math.max(
    safeMin,
    Math.min(600, Math.max(normalizedMin, normalizedMax)),
  );
  const requestedCount = Math.max(
    1,
    Math.min(20, Math.round(variantCount || 1)),
  );
  const topN = Math.max(1, Math.min(10, Math.round(topFluencyCount || 3)));
  // Strong filter mode: generate more candidates, keep only the best few.
  const safeCount = topFluencyOnly
    ? Math.min(20, Math.max(requestedCount, topN * 2, 6))
    : requestedCount;
  const finalKeepCount = topFluencyOnly
    ? Math.min(topN, safeCount)
    : requestedCount;

  const briefContext = buildBriefContext(brief);
  const diagnostics = diagnoseMaterial(segments, brief);
  const totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0);
  if (totalDuration < safeMin) {
    throw new Error(
      `可用口播总时长仅 ${totalDuration.toFixed(1)}s，小于最小目标 ${safeMin}s，请先减少排除内容或降低最小时长`,
    );
  }

  const segmentList = segments
    .map((seg, i) => `[${i}] (${seg.duration.toFixed(1)}s) "${seg.text}"`)
    .join("\n");

  const userMessage = `## 商品 Brief（投流策略）
${briefContext}

## 逐句明细（带编号和时长）
${segmentList}

## 生成任务
- 目标时长：${safeMin}-${safeMax} 秒
- 先生成 ${safeCount} 个候选爆款变体${topFluencyOnly ? `（最终只保留通顺度最高的 ${finalKeepCount} 条）` : ""}
- 每个变体总时长 = 所选句子时长之和，尽量落在 ${safeMin}-${safeMax} 秒
- 共 ${segments.length} 句，总时长 ${totalDuration.toFixed(1)} 秒
- 质量优先：不通顺、流水账、乱跳的方案直接淘汰

## 特别强调
1. 通顺自然，像真人一口气讲完
2. 易懂，3 秒听懂卖点和行动
3. 不要流水账，不要乱序硬拼
4. 结构尽量：钩子 → 痛点 → 卖点 → 证明 → 逼单
5. 只返回句子编号，不重复输出完整文案，减少输出截断风险`;
  let rawVariants: any[] = [];
  let llmOk = false;
  let usedProvider: LlmProvider | null = null;
  let usedProviderIndex = -1;
  let usedModel = "";
  let failedProviders: { name: string; error: string }[] = [];
  let usedFallback = false;
  let notice = "";
  const modelUsage = new Map<string, ModelTokenUsage>();

  let llmContent = "";
  try {
    if (providerList.length === 0) {
      throw new Error("缺少大模型 API 配置");
    }

    const call = await callChatWithFailover(
      providerList,
      [
        { role: "system", content: VARIANT_PROMPT },
        { role: "user", content: userMessage },
      ],
      { temperature: 0.55, timeoutMs: 300000 },
    );

    usedProvider = call.provider;
    usedProviderIndex = call.providerIndex;
    usedModel = call.model;
    addModelUsage(modelUsage, call);
    failedProviders = call.failures.map((f) => ({
      name: f.provider.name || f.provider.model || f.provider.baseUrl,
      error: f.error,
    }));
    if (failedProviders.length > 0) {
      notice = `前序 API 失败 ${failedProviders.length} 个，已自动切换到：${usedProvider.name || usedProvider.model}`;
    }
    llmContent = call.content;
    llmOk = true;
  } catch (err: unknown) {
    console.error("[generateVariants] all llm failed:", err);
    notice = err instanceof Error ? err.message : String(err);
    if (!allowFallback) {
      throw new Error(
        `全部大模型 API 失败，已暂停。请更换/检查 API 后继续。\n${notice}`,
      );
    }
    usedFallback = true;
    return {
      variants: enrichVariants(
        keepVariantsInDurationRange(
          diversifyFallback(segments, safeMin, safeMax, finalKeepCount),
          safeMin,
          safeMax,
        ),
        brief,
      ),
      usedProvider: null,
      usedProviderIndex: -1,
      usedModel: undefined,
      failedProviders,
      usedFallback: true,
      notice: `全部大模型 API 失败，已使用本地兜底方案。请检查/更换 API。\n${notice}`,
      diagnostics,
      usage: buildUsage(modelUsage),
    };
  }

  try {
    rawVariants = parseJsonArray(llmContent);
  } catch (err: unknown) {
    const detail = err instanceof Error ? err.message : String(err);
    const formatMessage = `大模型连接成功，但返回内容不是可用 JSON。通常是模型输出被截断、上下文过长，或该模型不稳定遵循 JSON 格式。${detail}`;
    console.error(
      "[generateVariants] llm response parse failed:",
      detail,
      llmContent.slice(0, 500),
    );
    try {
      const repairProviders = usedProvider
        ? [
            usedProvider,
            ...providerList.filter(
              (provider) => provider.id !== usedProvider!.id,
            ),
          ]
        : providerList;
      const repairCall = await repairVariantJson(llmContent, repairProviders);
      addModelUsage(modelUsage, repairCall);
      rawVariants = parseJsonArray(repairCall.content);
      notice = `${notice ? `${notice}；` : ""}AI 返回格式异常，已自动修复`;
    } catch (repairErr: unknown) {
      const repairDetail =
        repairErr instanceof Error ? repairErr.message : String(repairErr);
      if (!allowFallback) {
        throw new Error(
          `AI 返回格式异常且自动修复失败，队列已暂停；这不是 API Key 失效。\n${formatMessage}\n修复失败：${repairDetail}`,
        );
      }
      return {
        variants: enrichVariants(
          keepVariantsInDurationRange(
            diversifyFallback(segments, safeMin, safeMax, finalKeepCount),
            safeMin,
            safeMax,
          ),
          brief,
        ),
        usedProvider,
        usedProviderIndex,
        usedModel,
        failedProviders,
        usedFallback: true,
        notice: `${formatMessage}\n自动修复失败：${repairDetail}\n已使用本地兜底方案。`,
        diagnostics,
        usage: buildUsage(modelUsage),
      };
    }
  }

  type Draft = {
    name: string;
    strategy: string;
    indexes: number[];
    preview: string;
    fluency: number;
  };

  const drafts: Draft[] = [];
  for (let i = 0; i < rawVariants.length; i++) {
    const raw = rawVariants[i];
    let indexes = normalizeIndexes(raw, segments.length);
    if (indexes.length === 0) continue;

    indexes = polishOrderForFluency(indexes, segments);
    indexes = repairVariantDuration(indexes, segments, safeMin, safeMax);
    indexes = polishOrderForFluency(indexes, segments);

    const fluency = scoreFluency(indexes, segments);
    const preview = indexes.map((idx) => segments[idx]!.text).join("");
    drafts.push({
      name: raw?.name || `变体${i + 1}`,
      strategy: raw?.strategy || raw?.fluencyNote || "",
      indexes,
      preview,
      fluency,
    });
  }

  // Second pass: ask LLM to fix awkward drafts (quality over speed)
  if (llmOk && drafts.length > 0) {
    try {
      const refineCall = await refineVariantsWithLlm(
        segments,
        drafts.slice(0, safeCount),
        safeMin,
        safeMax,
        usedProvider
          ? [
              usedProvider,
              ...providerList.filter((p) => p.id !== usedProvider!.id),
            ]
          : providerList,
      );
      if (refineCall) addModelUsage(modelUsage, refineCall);
      const refined = refineCall
        ? parseJsonArray(refineCall.content)
            .map((raw: any) => ({
              name: String(raw?.name || ""),
              strategy: String(raw?.strategy || ""),
              indexes: normalizeIndexes(raw, segments.length),
            }))
            .filter((item) => item.indexes.length > 0)
        : null;
      if (refined && refined.length > 0) {
        for (const item of refined) {
          let indexes = polishOrderForFluency(item.indexes, segments);
          indexes = repairVariantDuration(indexes, segments, safeMin, safeMax);
          indexes = polishOrderForFluency(indexes, segments);
          const fluency = scoreFluency(indexes, segments);
          drafts.push({
            name: item.name || "优化变体",
            strategy: item.strategy || "二轮润顺优化",
            indexes,
            preview: indexes.map((idx) => segments[idx]!.text).join(""),
            fluency: fluency + 1.5,
          });
        }
      }
    } catch (err) {
      console.error("[generateVariants] refine failed:", err);
    }
  }

  // Rank by fluency first, duration fitness second; keep diverse openings
  drafts.sort((a, b) => {
    const fluencyDiff = b.fluency - a.fluency;
    if (Math.abs(fluencyDiff) > 0.1) return fluencyDiff;
    const aDur = a.indexes.reduce((s, i) => s + segments[i]!.duration, 0);
    const bDur = b.indexes.reduce((s, i) => s + segments[i]!.duration, 0);
    return (
      scoreDuration(aDur, safeMin, safeMax) -
      scoreDuration(bDur, safeMin, safeMax)
    );
  });

  const chosen: Draft[] = [];
  const usedOpenings = new Set<string>();
  for (const draft of drafts) {
    if (chosen.length >= finalKeepCount) break;
    if (draft.indexes.length === 0) continue;
    const opening =
      segments[draft.indexes[0]!]?.text?.slice(0, 12) ||
      String(draft.indexes[0]!);
    // avoid too-similar openings unless inventory is insufficient
    if (usedOpenings.has(opening) && drafts.length > finalKeepCount) continue;

    // Strong mode: drop weak fluency more aggressively
    if (topFluencyOnly) {
      if (draft.fluency < 4 && drafts.some((d) => d.fluency >= 8)) continue;
    } else if (draft.fluency < 0 && drafts.some((d) => d.fluency >= 6)) {
      continue;
    }

    const duration = draft.indexes.reduce(
      (s, i) => s + segments[i]!.duration,
      0,
    );
    if (duration < safeMin - 0.35 || duration > safeMax + 0.35) continue;

    chosen.push(draft);
    usedOpenings.add(opening);
  }

  // Normal mode can fill remaining slots; strong top-N mode prefers quality over quantity
  if (!topFluencyOnly && chosen.length < finalKeepCount) {
    for (const draft of drafts) {
      if (chosen.length >= finalKeepCount) break;
      if (chosen.includes(draft)) continue;
      chosen.push(draft);
    }
  }

  // If strong mode still empty, fall back to absolute top fluency drafts
  if (chosen.length === 0 && drafts.length > 0) {
    chosen.push(...drafts.slice(0, finalKeepCount));
  }

  const variants: VariantPlan[] = [];
  for (const draft of chosen.slice(0, finalKeepCount)) {
    const strategyParts = [draft.strategy].filter(Boolean);
    if (topFluencyOnly) {
      strategyParts.push(`通顺度优选 Top${finalKeepCount}`);
    } else if (
      !strategyParts.some(
        (s) => s.includes("通顺") || s.includes("爆款") || s.includes("衔接"),
      )
    ) {
      strategyParts.push("已按通顺度与爆款结构优选");
    }
    const variant = buildVariantFromIndexes(
      draft.indexes,
      segments,
      draft.name,
      strategyParts.join("；"),
      variants.length + 1,
    );
    if (variant) variants.push(variant);
  }

  if (variants.length === 0) {
    return {
      variants: enrichVariants(
        keepVariantsInDurationRange(
          diversifyFallback(segments, safeMin, safeMax, finalKeepCount),
          safeMin,
          safeMax,
        ),
        brief,
      ),
      usedProvider,
      usedProviderIndex,
      usedModel,
      failedProviders,
      usedFallback: true,
      notice: notice || "未得到可用 LLM 结果，已使用本地兜底",
      diagnostics,
      usage: buildUsage(modelUsage),
    };
  }

  // Only pad with fallback when not in strong top-fluency mode
  if (!topFluencyOnly && variants.length < finalKeepCount) {
    const fallback = diversifyFallback(
      segments,
      safeMin,
      safeMax,
      finalKeepCount - variants.length,
    );
    for (const item of fallback) {
      item.id = variants.length + 1;
      item.name = item.name.replace("连贯", "补充连贯");
      variants.push(item);
    }
  }

  // Final hard guarantee: never exceed finalKeepCount (Top3 mode especially)
  const unique: VariantPlan[] = [];
  const seenPreview = new Set<string>();
  for (const v of variants) {
    const preview = v.segments
      .map((s) => s.text)
      .join("")
      .slice(0, 80);
    if (seenPreview.has(preview)) continue;
    seenPreview.add(preview);
    unique.push({ ...v, id: unique.length + 1 });
    if (unique.length >= finalKeepCount) break;
  }

  const ranged = enrichVariants(
    keepVariantsInDurationRange(unique, safeMin, safeMax),
    brief,
  );

  if (!notice && usedProvider) {
    notice = `已使用大模型：${usedProvider.name || usedProvider.model} / ${usedModel || usedProvider.model}`;
  }

  return {
    variants: ranged.slice(0, finalKeepCount),
    usedProvider,
    usedProviderIndex,
    usedModel,
    failedProviders,
    usedFallback,
    notice,
    diagnostics,
    usage: buildUsage(modelUsage),
  };
}
