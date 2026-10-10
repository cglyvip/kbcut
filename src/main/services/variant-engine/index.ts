// Entry point: orchestrates LLM generation, repair, refinement and fallback.
import { callChatWithFailover, type LlmProvider } from "../llm-client";
import type { LlmCallSuccess } from "../llm-client";
import { VARIANT_PROMPT, buildBriefContext } from "./prompts";
import { diagnoseMaterial, scoreFluency, scoreDuration } from "./scoring";
import {
  enrichVariants,
  buildVariantFromIndexes,
  keepVariantsInDurationRange,
  repairVariantDuration,
  polishOrderForFluency,
  diversifyFallback,
} from "./strategy";
import type {
  SimpleSegment,
  VariantPlan,
  GenerateOptions,
  GenerateVariantsResult,
  ModelTokenUsage,
} from "./types";

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
