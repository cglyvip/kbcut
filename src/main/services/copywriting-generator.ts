// 文案创作：调用大模型生成「可直接照着拍」的完整口播文案。
// 复用 llm-client 的多 API 失败切换与限流；不做本地兜底，失败直接抛错给 UI。
import { callChatWithFailover, type LlmProvider } from "./llm-client";
import { COPY_LIMITS, type CopywritingBrief } from "./copywriting-library";

export interface CopywritingDraftRequest {
  brief?: Partial<CopywritingBrief> | null;
  /** 已有口播素材全文（例如已识别视频的 ASR 文本），作为提炼/改写来源 */
  materialText?: string;
  /** 额外要求，例如「突出性价比」「面向宝妈」 */
  requirements?: string;
  /** 目标口播时长（秒），用于控制文案长度 */
  targetDurationSec?: number;
  /** 风格 / 模板说明，纯文本 */
  style?: string;
  providers?: LlmProvider[];
}

export interface CopywritingDraft {
  title: string;
  content: string;
  usedProviderName: string;
  usedModel: string;
  inputTokens: number;
  outputTokens: number;
}

/** 中文口播平均语速（字/秒），用于估算文案时长 */
export const CHARS_PER_SECOND = 4.5;

const MATERIAL_LIMIT = 12000;
const REQUIREMENTS_LIMIT = 1000;
const STYLE_LIMIT = 200;
const DURATION_MIN = 5;
const DURATION_MAX = 600;

export const COPYWRITING_SYSTEM = `你是抖音 / 千川口播短视频的资深编导，擅长写"照着念就能拍"的高转化口播文案。
你的文案必须是口语，像真人对着镜头一口气讲完，而不是书面文章或产品说明书。`;

function clampDuration(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(DURATION_MAX, Math.max(DURATION_MIN, Math.round(number)));
}

export function estimateSpeechSeconds(text: string): number {
  const length = String(text ?? "").replace(/\s+/g, "").length;
  return length / CHARS_PER_SECOND;
}

export function buildCopywritingPrompt(
  request: CopywritingDraftRequest,
): string {
  const brief = request?.brief ?? {};
  const lines: string[] = [];

  lines.push("# 任务");
  lines.push("写一条全新的、可以直接照着念的完整口播文案。");
  lines.push("");

  const durationSec = clampDuration(request?.targetDurationSec);
  lines.push("# 硬性要求");
  lines.push("1. 通顺第一：像真人一口气讲完，不要书面语，不要流水账式罗列。");
  lines.push(
    "2. 结构完整：钩子（前 3 秒抓人）→ 痛点/场景共鸣 → 核心卖点 → 信任证据 → 优惠逼单行动。",
  );
  lines.push(
    "3. 只使用下面提供的信息。缺失的价格、资质、检测数据、销量一律不要编造，宁可跳过。",
  );
  lines.push(
    "4. 正文里不要出现「第一点」「其次」这类结构词，也不要写括号里的拍摄提示、表情提示。",
  );
  lines.push("5. 正文使用中文口语短句，每段一句完整的话，段与段之间换行。");
  if (durationSec > 0) {
    const targetChars = Math.round(durationSec * CHARS_PER_SECOND);
    lines.push(
      `6. 目标口播时长约 ${durationSec} 秒（约 ${targetChars} 字），请控制在 ${Math.round(targetChars * 0.85)}~${Math.round(targetChars * 1.15)} 字之间。`,
    );
  }
  lines.push("");

  const briefLines: string[] = [];
  const pushBrief = (label: string, value: unknown) => {
    const text = String(value ?? "").trim();
    if (text) briefLines.push(`- ${label}：${text}`);
  };
  pushBrief("商品", brief.productName);
  pushBrief("价格", brief.price);
  pushBrief("目标人群", brief.targetAudience);
  pushBrief("用户痛点", brief.painPoints);
  pushBrief("核心卖点", brief.coreSellingPoints);
  pushBrief("信任证据", brief.evidence);
  pushBrief("优惠活动", brief.offer);
  pushBrief("期望喊单", brief.cta);
  lines.push("# 商品信息");
  lines.push(
    briefLines.length > 0
      ? briefLines.join("\n")
      : "- 未提供。请写成通用口播文案，不要编造具体参数。",
  );
  lines.push("");

  const forbidden = String(brief.forbiddenWords ?? "").trim();
  if (forbidden) {
    lines.push("# 禁用词");
    lines.push(`以下词不得出现：${forbidden}`);
    lines.push("");
  }

  const style = String(request?.style ?? "")
    .slice(0, STYLE_LIMIT)
    .trim();
  if (style) {
    lines.push("# 风格要求");
    lines.push(style);
    lines.push("");
  }

  const material = String(request?.materialText ?? "")
    .slice(0, MATERIAL_LIMIT)
    .trim();
  if (material) {
    lines.push("# 已有素材（旧口播原句）");
    lines.push(
      "这些句子来自之前的拍摄。可以提炼其中已被验证的说法和卖点，但必须重新组织成一条完整、连贯的全新文案，不允许原样拼接。",
    );
    lines.push(material);
    lines.push("");
  }

  const requirements = String(request?.requirements ?? "")
    .slice(0, REQUIREMENTS_LIMIT)
    .trim();
  if (requirements) {
    lines.push("# 额外要求");
    lines.push(requirements);
    lines.push("");
  }

  lines.push("# 返回格式");
  lines.push("严格返回 JSON 对象，不要 Markdown 代码块，不要任何解释文字：");
  lines.push(
    '{"title": "12 字以内的短标题", "content": "完整口播文案正文，用 \\n 分段"}',
  );

  return lines.join("\n");
}

/** 把 JSON 字符串字面量里的裸换行/制表符转成转义形式（模型常直接换行输出长文案）。 */
function escapeRawControlCharsInStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (!inString) {
      if (char === '"') inString = true;
      out += char;
      continue;
    }
    if (escaped) {
      escaped = false;
      out += char;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      out += char;
      continue;
    }
    if (char === '"') {
      inString = false;
      out += char;
      continue;
    }
    if (char === "\n") {
      out += "\\n";
      continue;
    }
    if (char === "\r") {
      out += "\\r";
      continue;
    }
    if (char === "\t") {
      out += "\\t";
      continue;
    }
    out += char;
  }

  return out;
}

export function parseCopywritingDraft(content: string): {
  title: string;
  content: string;
} {
  const raw = String(content ?? "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");

  if (start >= 0 && end > start) {
    const jsonStr = raw.slice(start, end + 1);
    const normalized = jsonStr
      .replace(/，/g, ",")
      .replace(/：/g, ":")
      .replace(/[“”]/g, '"')
      .replace(/,\s*([}\]])/g, "$1");
    const candidates = [
      jsonStr.replace(/,\s*([}\]])/g, "$1"),
      normalized,
      escapeRawControlCharsInStrings(normalized),
    ];

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        const text = String(
          parsed?.content ?? parsed?.text ?? parsed?.copy ?? "",
        ).trim();
        if (!text) continue;
        return {
          title: String(parsed?.title ?? "")
            .trim()
            .slice(0, COPY_LIMITS.title),
          content: text.slice(0, COPY_LIMITS.content),
        };
      } catch {}
    }
  }

  throw new Error("AI 返回内容里没有解析出文案正文，请重试或更换模型");
}

export async function generateCopywritingDraft(
  request: CopywritingDraftRequest,
): Promise<CopywritingDraft> {
  const providers = Array.isArray(request?.providers)
    ? request.providers.filter((p): p is LlmProvider => Boolean(p))
    : [];

  const call = await callChatWithFailover(
    providers,
    [
      { role: "system", content: COPYWRITING_SYSTEM },
      { role: "user", content: buildCopywritingPrompt(request) },
    ],
    { temperature: 0.9, timeoutMs: 300_000 },
  );

  const draft = parseCopywritingDraft(call.content);
  return {
    title: draft.title || draft.content.slice(0, 16),
    content: draft.content,
    usedProviderName: call.provider.name?.trim() || call.model,
    usedModel: call.model,
    inputTokens: call.usage.inputTokens,
    outputTokens: call.usage.outputTokens,
  };
}