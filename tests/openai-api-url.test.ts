import { describe, it, expect } from "vitest";
import { normalizeOpenAiCompatibleUrl } from "../src/main/utils/openai-api-url";

describe("normalizeOpenAiCompatibleUrl", () => {
  const chat = "chat/completions" as const;
  const audio = "audio/transcriptions" as const;

  describe("chat/completions endpoint", () => {
    it("appends /v1/chat/completions to bare root URL", () => {
      expect(
        normalizeOpenAiCompatibleUrl("https://api.openai.com", chat, "LLM"),
      ).toBe("https://api.openai.com/v1/chat/completions");
    });

    it("appends /v1/chat/completions to root URL with trailing slash", () => {
      expect(
        normalizeOpenAiCompatibleUrl("https://api.openai.com/", chat, "LLM"),
      ).toBe("https://api.openai.com/v1/chat/completions");
    });

    it("appends endpoint when URL already ends with /v1", () => {
      expect(
        normalizeOpenAiCompatibleUrl("https://api.openai.com/v1", chat, "LLM"),
      ).toBe("https://api.openai.com/v1/chat/completions");
    });

    it("appends endpoint when URL ends with /v1/", () => {
      expect(
        normalizeOpenAiCompatibleUrl("https://api.openai.com/v1/", chat, "LLM"),
      ).toBe("https://api.openai.com/v1/chat/completions");
    });

    it("keeps full path if URL already ends with /chat/completions", () => {
      expect(
        normalizeOpenAiCompatibleUrl(
          "https://api.openai.com/v1/chat/completions",
          chat,
          "LLM",
        ),
      ).toBe("https://api.openai.com/v1/chat/completions");
    });

    it("handles custom base path (e.g. /openai)", () => {
      expect(
        normalizeOpenAiCompatibleUrl(
          "https://proxy.example.com/openai",
          chat,
          "LLM",
        ),
      ).toBe("https://proxy.example.com/openai/chat/completions");
    });

    it("handles custom base path with /v1", () => {
      expect(
        normalizeOpenAiCompatibleUrl(
          "https://proxy.example.com/openai/v1",
          chat,
          "LLM",
        ),
      ).toBe("https://proxy.example.com/openai/v1/chat/completions");
    });

    it("handles http protocol", () => {
      expect(
        normalizeOpenAiCompatibleUrl("http://localhost:11434/v1", chat, "LLM"),
      ).toBe("http://localhost:11434/v1/chat/completions");
    });

    it("handles custom path without version marker", () => {
      expect(
        normalizeOpenAiCompatibleUrl(
          "https://my-api.com/llm-proxy",
          chat,
          "LLM",
        ),
      ).toBe("https://my-api.com/llm-proxy/v1/chat/completions");
    });
  });

  describe("audio/transcriptions endpoint", () => {
    it("appends /v1/audio/transcriptions to bare root URL", () => {
      expect(
        normalizeOpenAiCompatibleUrl("https://api.openai.com", audio, "ASR"),
      ).toBe("https://api.openai.com/v1/audio/transcriptions");
    });

    it("keeps full path if URL already ends with /audio/transcriptions", () => {
      expect(
        normalizeOpenAiCompatibleUrl(
          "https://api.openai.com/v1/audio/transcriptions",
          audio,
          "ASR",
        ),
      ).toBe("https://api.openai.com/v1/audio/transcriptions");
    });

    it("appends endpoint when URL ends with /v1", () => {
      expect(
        normalizeOpenAiCompatibleUrl("https://api.openai.com/v1", audio, "ASR"),
      ).toBe("https://api.openai.com/v1/audio/transcriptions");
    });
  });

  describe("error cases", () => {
    it("throws on empty string", () => {
      expect(() => normalizeOpenAiCompatibleUrl("", chat, "LLM")).toThrow(
        "地址格式无效",
      );
    });

    it("throws on invalid URL", () => {
      expect(() =>
        normalizeOpenAiCompatibleUrl("not-a-url", chat, "LLM"),
      ).toThrow("地址格式无效");
    });

    it("throws on non-http protocol", () => {
      expect(() =>
        normalizeOpenAiCompatibleUrl("ftp://example.com", chat, "LLM"),
      ).toThrow("仅支持 http/https");
    });

    it("throws on file protocol", () => {
      expect(() =>
        normalizeOpenAiCompatibleUrl("file:///etc/passwd", chat, "LLM"),
      ).toThrow("仅支持 http/https");
    });
  });

  describe("edge cases", () => {
    it("strips hash fragment", () => {
      const result = normalizeOpenAiCompatibleUrl(
        "https://api.openai.com/v1#foo",
        chat,
        "LLM",
      );
      expect(result).not.toContain("#");
    });

    it("preserves query parameters", () => {
      const result = normalizeOpenAiCompatibleUrl(
        "https://api.openai.com/v1?key=val",
        chat,
        "LLM",
      );
      expect(result).toContain("?key=val");
    });

    it("handles case-insensitive path matching", () => {
      expect(
        normalizeOpenAiCompatibleUrl(
          "https://api.openai.com/V1/Chat/Completions",
          chat,
          "LLM",
        ),
      ).toBe("https://api.openai.com/v1/chat/completions");
    });
  });
});
