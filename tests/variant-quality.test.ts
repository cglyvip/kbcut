import { describe, expect, it } from "vitest";
import {
  classifyHookStrategy,
  generateVariants,
  type ProductBrief,
  type SimpleSegment,
} from "../src/main/services/variant-generator";

const segments: SimpleSegment[] = [
  {
    start: 0,
    end: 2,
    duration: 2,
    text: "为什么很多上班族每天收拾桌面还是很乱？",
  },
  {
    start: 2,
    end: 4,
    duration: 2,
    text: "东西反复找不到，既浪费时间又让人很烦。",
  },
  {
    start: 4,
    end: 6,
    duration: 2,
    text: "这款分区收纳盒拿取方便，能让桌面快速整齐。",
  },
  {
    start: 6,
    end: 8,
    duration: 2,
    text: "材质已经通过检测报告，很多用户实测后都在回购。",
  },
  {
    start: 8,
    end: 10,
    duration: 2,
    text: "现在点击链接领券下单，马上把桌面整理好。",
  },
];

const brief: ProductBrief = {
  productName: "分区收纳盒",
  price: "39元",
  targetAudience: "上班族、宝妈",
  painPoints: "桌面杂乱、找东西浪费时间",
  coreSellingPoints: "分区清晰、拿取方便",
  evidence: "检测报告、用户回购",
  offer: "限时领券",
  cta: "点击链接领券下单",
  forbiddenWords: "根治",
  extraPrompt: "",
  hookStrategies: ["pain", "benefit", "curiosity"],
  audienceVariants: true,
  enableCompliance: true,
  enableSemanticCheck: true,
  enableAbMatrix: true,
  enablePacing: true,
  subtitleKeywords: "分区收纳盒、领券、下单",
  performanceInsights: "历史痛点型钩子点击率更高。",
};

describe("variant quality metadata", () => {
  it("classifies A/B hook labels from the actual opening sentence", () => {
    expect(classifyHookStrategy("为什么很多人整理完还是很乱？", brief)).toBe(
      "curiosity",
    );
    expect(
      classifyHookStrategy("上班族桌面太乱，找东西真的很烦。", brief),
    ).toBe("identity");
    expect(
      classifyHookStrategy("今天到手只要39元，直接省下一半。", brief),
    ).toBe("price");
  });

  it("returns diagnostics, quality scores, A/B labels, and pacing hints without an API", async () => {
    const result = await generateVariants({
      segments,
      minDuration: 6,
      maxDuration: 10,
      variantCount: 4,
      providers: [],
      allowFallback: true,
      brief,
    });

    expect(result.usedFallback).toBe(true);
    expect(result.diagnostics?.score).toBeGreaterThan(50);
    expect(result.variants.length).toBeGreaterThan(0);
    expect(
      result.variants.every(
        (variant) => typeof variant.quality?.total === "number",
      ),
    ).toBe(true);
    expect(result.variants.some((variant) => Boolean(variant.abLabel))).toBe(
      true,
    );
    expect(
      result.variants.some((variant) => (variant.pacingHints?.length || 0) > 0),
    ).toBe(true);
  });

  it("never returns more than three variants in Top3 mode", async () => {
    const result = await generateVariants({
      segments,
      minDuration: 4,
      maxDuration: 10,
      variantCount: 12,
      topFluencyOnly: true,
      topFluencyCount: 3,
      providers: [],
      allowFallback: true,
      brief,
    });

    expect(result.variants.length).toBeLessThanOrEqual(3);
  });
});
