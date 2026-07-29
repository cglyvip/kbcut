import { describe, expect, it } from "vitest";
import { checkCompliance } from "../src/main/services/compliance-checker";

describe("compliance checker", () => {
  it("detects absolute promotional claims", () => {
    const violations = checkCompliance([
      "这是全网最好的产品，现在点击链接下单。",
    ]);

    expect(
      violations.some(
        (item) => item.type === "banned_word" && item.severity === "error",
      ),
    ).toBe(true);
  });

  it("detects medical claims", () => {
    // 使用不在 BANNED_WORDS 中的医疗用语"治愈"来测试 medical_claim 检测
    const violations = checkCompliance(["这款产品能治愈你的烦恼，马上下单。"]);

    expect(
      violations.some(
        (item) => item.type === "medical_claim" && item.severity === "error",
      ),
    ).toBe(true);
  });

  it("warns when the call to action is missing", () => {
    const violations = checkCompliance([
      "为什么很多人都忽略了这个收纳问题？它能让桌面更整齐。",
    ]);

    expect(
      violations.some(
        (item) =>
          item.type === "missing_element" && item.message.includes("行动句"),
      ),
    ).toBe(true);
  });

  it("accepts a clear hook and compliant call to action", () => {
    const violations = checkCompliance([
      "为什么上班族都在用这款收纳盒？它能让桌面更整齐，现在点击链接下单。",
    ]);

    expect(violations).toEqual([]);
  });

  it("does not treat ordinary step numbering as an absolute claim", () => {
    const violations = checkCompliance([
      "第一步先清空桌面，为什么这样整理更快？现在点击链接查看。",
    ]);

    expect(violations.some((item) => item.type === "banned_word")).toBe(false);
  });

  it("does not mistake ordinary words for hooks or calls to action", () => {
    const noHook = checkCompliance([
      "这款产品主要为了帮助日常收纳，现在点击链接下单。",
    ]);
    const noCta = checkCompliance([
      "为什么这个衣服领口穿起来更舒服？材质柔软也不勒。",
    ]);

    expect(noHook.some((item) => item.message.includes("没有钩子"))).toBe(true);
    expect(noCta.some((item) => item.message.includes("行动句"))).toBe(true);
  });
});
