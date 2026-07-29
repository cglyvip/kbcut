import { mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeAsrApiUrl, onlineAsr } from "../src/main/services/asr-online";

let testDir = "";

afterEach(async () => {
  vi.unstubAllGlobals();
  if (testDir) await rm(testDir, { recursive: true, force: true });
  testDir = "";
});

describe("online ASR", () => {
  it("supports complete and versioned transcription endpoints", () => {
    expect(normalizeAsrApiUrl("https://api.openai.com")).toBe(
      "https://api.openai.com/v1/audio/transcriptions",
    );
    expect(normalizeAsrApiUrl("https://asr.example.com/api/v3")).toBe(
      "https://asr.example.com/api/v3/audio/transcriptions",
    );
    expect(
      normalizeAsrApiUrl(
        "https://asr.example.com/v1/audio/transcriptions?lang=zh",
      ),
    ).toBe("https://asr.example.com/v1/audio/transcriptions?lang=zh");
  });

  it("normalizes API paths and repairs missing timestamp ends", async () => {
    testDir = await mkdtemp(join(tmpdir(), "kbcut-asr-test-"));
    const audioPath = join(testDir, "speech.mp3");
    await writeFile(audioPath, Buffer.from("fake-mp3"));

    const fetchMock = vi.fn(
      async (_url: string | URL | Request) =>
        new Response(
          JSON.stringify({
            text: "第一句第二句",
            language: "zh",
            duration: 2,
            words: [
              { start: 0, end: null, word: "第一句" },
              { start: 1, end: 2, word: "第二句" },
            ],
            segments: [
              { start: 0, end: null, text: "第一句" },
              { start: 1, end: 2, text: "第二句" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await onlineAsr(audioPath, {
      apiKey: "test-key",
      baseUrl: "https://asr.example.com/V1/",
      model: "whisper-1",
    });

    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://asr.example.com/v1/audio/transcriptions",
    );
    expect(result.segments).toHaveLength(2);
    expect(
      result.segments.every((segment) => segment.end > segment.start),
    ).toBe(true);
    expect(result.segments[0]!.end).toBe(1);
  });

  it("retries without word timestamp parameters for compatible services", async () => {
    testDir = await mkdtemp(join(tmpdir(), "kbcut-asr-test-"));
    const audioPath = join(testDir, "speech.mp3");
    await writeFile(audioPath, Buffer.from("fake-mp3"));

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("unknown parameter timestamp_granularities", {
          status: 400,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            text: "兼容识别成功",
            duration: 1,
            segments: [{ start: 0, end: 1, text: "兼容识别成功" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await onlineAsr(audioPath, {
      apiKey: "test-key",
      baseUrl: "https://asr.example.com",
      model: "whisper-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.fullText).toBe("兼容识别成功");
  });
});
