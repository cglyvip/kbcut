import { describe, expect, it } from "vitest";
import {
  normalizeLlmApiUrl,
  parseLlmCompletionPayload,
  type LlmChatMessage,
} from "../src/main/services/llm-client";

const messages: LlmChatMessage[] = [
  { role: "system", content: "只返回 JSON。" },
  { role: "user", content: "生成一个测试结果。" },
];

describe("llm completion usage parsing", () => {
  it("uses API-reported OpenAI token counts and response model", () => {
    const result = parseLlmCompletionPayload(
      {
        model: "deepseek-chat-actual",
        choices: [
          { finish_reason: "stop", message: { content: '[{"ok":true}]' } },
        ],
        usage: { prompt_tokens: 321, completion_tokens: 45, total_tokens: 366 },
      },
      { model: "configured-model" },
      messages,
    );

    expect(result.model).toBe("deepseek-chat-actual");
    expect(result.usage).toEqual({
      inputTokens: 321,
      outputTokens: 45,
      estimated: false,
    });
  });

  it("supports alternate usage fields used by compatible providers", () => {
    const result = parseLlmCompletionPayload(
      {
        choices: [{ finish_reason: "stop", message: { content: "完成" } }],
        usageMetadata: {
          promptTokenCount: 100,
          candidatesTokenCount: 20,
          totalTokenCount: 120,
        },
      },
      { model: "gemini-compatible" },
      messages,
    );

    expect(result.model).toBe("gemini-compatible");
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      estimated: false,
    });
  });

  it("marks character-based fallback counts as estimated", () => {
    const result = parseLlmCompletionPayload(
      {
        choices: [
          {
            finish_reason: "stop",
            message: { content: "这是没有 usage 的返回内容" },
          },
        ],
      },
      { model: "local-model" },
      messages,
    );

    expect(result.usage.inputTokens).toBeGreaterThan(0);
    expect(result.usage.outputTokens).toBeGreaterThan(0);
    expect(result.usage.estimated).toBe(true);
  });
});

describe("llm API URL normalization", () => {
  it("supports roots, versioned vendor paths, and complete endpoints", () => {
    expect(normalizeLlmApiUrl("https://api.openai.com")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
    expect(normalizeLlmApiUrl("https://openrouter.ai/api/v1/")).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(normalizeLlmApiUrl("https://ark.example.com/api/v3")).toBe(
      "https://ark.example.com/api/v3/chat/completions",
    );
    expect(
      normalizeLlmApiUrl(
        "https://generativelanguage.googleapis.com/v1beta/openai",
      ),
    ).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(
      normalizeLlmApiUrl(
        "https://proxy.example.com/v1/chat/completions?channel=main",
      ),
    ).toBe("https://proxy.example.com/v1/chat/completions?channel=main");
  });
});
