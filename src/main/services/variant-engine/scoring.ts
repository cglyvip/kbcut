// Pure scoring / classification helpers for variant generation.
import { checkCompliance } from "../compliance-checker";
import {
  HOOK_HINTS,
  CTA_HINTS,
  FILLER_HINTS,
  EVIDENCE_HINTS,
  PAIN_HINTS,
  BENEFIT_HINTS,
} from "./types";
import type {
  SimpleSegment,
  VariantPlan,
  VariantQuality,
  ProductBrief,
  MaterialDiagnostics,
} from "./types";

export function includesAny(text: string, hints: string[]): boolean {
  return hints.some((h) => text.includes(h));
}

export function contentTokens(text: string): Set<string> {
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

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function scoreDuration(
  duration: number,
  minDuration: number,
  maxDuration: number,
): number {
  if (duration >= minDuration && duration <= maxDuration) return 0;
  if (duration < minDuration) return minDuration - duration;
  return duration - maxDuration;
}

export function scoreFluency(indexes: number[], segments: SimpleSegment[]): number {
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

export function splitTerms(value?: string): string[] {
  return String(value || "")
    .split(/[，,、；;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function containsTerm(text: string, terms: string[]): boolean {
  return terms.some((term) => term && text.includes(term));
}

export function diagnoseMaterial(
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

export function scoreVariantQuality(
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

export function buildPacingHints(
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
