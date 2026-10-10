// Type definitions and hint constants for variant generation.
import type { LlmProvider } from "../llm-client";

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

export const HOOK_HINTS = [
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
export const CTA_HINTS = [
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
export const FILLER_HINTS = [
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

export const EVIDENCE_HINTS = [
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
export const PAIN_HINTS = [
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
export const BENEFIT_HINTS = [
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
export const HOOK_STRATEGY_LABELS: Record<string, string> = {
  curiosity: "好奇悬念",
  pain: "痛点直击",
  benefit: "利益结果",
  anti_common: "反常识",
  identity: "身份筛选",
  price: "价格冲击",
  urgency: "紧迫稀缺",
  mixed: "综合策略",
};
export const TEMPLATE_LABELS: Record<string, string> = {
  general: "通用投流",
  beauty: "美妆个护",
  food: "食品饮料",
  home: "家清日用",
  apparel: "服饰鞋包",
  knowledge: "知识服务",
};
