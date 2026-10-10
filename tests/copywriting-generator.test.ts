import { tmpdir } from "os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const llmState = vi.hoisted(() => ({
  calls: [] as { providers: any[]; messages: any[]; options: any }[],
  next: null as any,
}));

vi.mock("electron", () => ({
  app: { getPath: () => tmpdir() },
}));

vi.mock("../src/main/services/llm-client", () => ({
  callChatWithFailover: async (
    providers: any[],
    messages: any[],
    options: any,
  ) => {
    llmState.calls.push({ providers, messages, options });
    if (llmState.next instanceof Error) throw llmState.next;
    return llmState.next;
  },
}));

import {
  CHARS_PER_SECOND,
  buildCopywritingPrompt,
  estimateSpeechSeconds,
  generateCopywritingDraft,
  parseCopywritingDraft,
} from "../src/main/services/copywriting-generator";

function llmReply(content: string) {
  return {
    content,
    provider: { id: "p1", name: "主 API", model: "gpt-4o-mini" },
    providerIndex: 0,
    failures: [],
    model: "gpt-4o-mini",
    usage: { inputTokens: 120, outputTokens: 240, estimated: false },
  };
}

beforeEach(() => {
  llmState.calls.length = 0;
  llmState.next = null;
});

describe("parseCopywritingDraft", () => {
  it("reads title and content from a plain JSON object", () => {
    const draft = parseCopywritingDraft('{"title":"油污克星","content":"喷一喷就干净"}');
    expect(draft).toEqual({ title: "油污克星", content: "喷一喷就干净" });
  });

  it("tolerates markdown fences and full-width punctuation", () => {
    const draft = parseCopywritingDraft(
      '```json\n{“title”：“油污克星”，“content”：“喷一喷就干净，\n擦完像新的。”}\n```',
    );
    expect(draft.title).toBe("油污克星");
    expect(draft.content).toContain("擦完像新的");
  });

  it("throws when the model returns no usable content", () => {
    expect(() => parseCopywritingDraft('{"title":"只有标题"}')).toThrow();
    expect(() => parseCopywritingDraft("模型今天不想干活")).toThrow();
    expect(() => parseCopywritingDraft("")).toThrow();
  });
});

describe("buildCopywritingPrompt", () => {
  it("carries商品信息、素材、禁用词与目标时长", () => {
    const prompt = buildCopywritingPrompt({
      brief: {
        productName: "去油喷雾",
        price: "39.9 元",
        targetAudience: "经常做饭的宝妈",
        forbiddenWords: "最、第一",
      },
      materialText: "以前灶台擦半小时都擦不掉",
      requirements: "开头用疑问句",
      targetDurationSec: 30,
      style: "接地气唠嗑",
    });

    expect(prompt).toContain("去油喷雾");
    expect(prompt).toContain("39.9 元");
    expect(prompt).toContain("经常做饭的宝妈");
    expect(prompt).toContain("最、第一");
    expect(prompt).toContain("以前灶台擦半小时都擦不掉");
    expect(prompt).toContain("开头用疑问句");
    expect(prompt).toContain("接地气唠嗑");
    // 30 秒 * 4.5 字/秒 = 135 字，容差区间应写进提示
    expect(prompt).toContain("30 秒");
    expect(prompt).toContain("135");
  });

  it("never demands made-up facts when the brief is empty", () => {
    const prompt = buildCopywritingPrompt({});
    expect(prompt).toContain("未提供");
    expect(prompt).not.toContain("undefined");
  });

  it("estimates speech length at the documented rate", () => {
    expect(CHARS_PER_SECOND).toBe(4.5);
    expect(estimateSpeechSeconds("一二三四五六七八九")).toBeCloseTo(2, 5);
    expect(estimateSpeechSeconds("一 二\n三")).toBeCloseTo(3 / 4.5, 5);
  });
});

describe("generateCopywritingDraft", () => {
  it("returns the provider/model and token usage reported by the LLM client", async () => {
    llmState.next = llmReply('{"title":"油污克星","content":"喷一喷就干净"}');

    const draft = await generateCopywritingDraft({
      providers: [
        {
          id: "p1",
          name: "主 API",
          baseUrl: "https://example.com",
          apiKey: "sk-x",
          model: "gpt-4o-mini",
        },
      ],
      targetDurationSec: 40,
    });

    expect(draft.title).toBe("油污克星");
    expect(draft.usedProviderName).toBe("主 API");
    expect(draft.usedModel).toBe("gpt-4o-mini");
    expect(draft.inputTokens).toBe(120);
    expect(draft.outputTokens).toBe(240);
    expect(llmState.calls).toHaveLength(1);
    expect(llmState.calls[0]!.messages).toHaveLength(2);
    expect(llmState.calls[0]!.options.timeoutMs).toBe(300_000);
  });

  it("falls back to a derived title when the model omits it", async () => {
    llmState.next = llmReply('{"content":"没有标题的一条完整口播文案"}');
    const draft = await generateCopywritingDraft({ providers: [] });
    expect(draft.title).toBe("没有标题的一条完整口播文案");
  });

  it("surfaces LLM failures instead of inventing a fallback draft", async () => {
    llmState.next = new Error("全部大模型 API 均失败，请检查/更换 API。");
    await expect(
      generateCopywritingDraft({ providers: [] }),
    ).rejects.toThrow("全部大模型 API 均失败");
  });
});