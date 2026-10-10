// Prompt templates and brief context for variant generation.
import { HOOK_STRATEGY_LABELS, TEMPLATE_LABELS } from "./types";
import type { ProductBrief } from "./types";

export const VARIANT_PROMPT = `你是千川投流口播短视频的首席编剧+剪辑总监。
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

export function buildBriefContext(brief?: ProductBrief): string {
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
