import { describe, expect, it } from "vitest";
import { buildEditableWords } from "../src/renderer/src/stores/useAsrStore";

describe("ASR timestamp normalization", () => {
  it("repairs invalid word ranges before editing and export", () => {
    const words = buildEditableWords(2, 4, "测试", [
      { start: Number.NaN, end: Number.NaN, text: "测" },
      { start: 3, end: 2, text: "试" },
    ]);

    expect(words).toHaveLength(2);
    expect(
      words.every(
        (word) => Number.isFinite(word.start) && word.end > word.start,
      ),
    ).toBe(true);
  });
});
