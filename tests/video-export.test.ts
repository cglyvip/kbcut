import { execFile, spawn } from "child_process";
import { mkdtemp, rm, stat } from "fs/promises";
import { tmpdir } from "os";
import { basename, join } from "path";
import { promisify } from "util";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: {
    getAppPath: () => process.cwd(),
  },
}));

import { exportVariants } from "../src/main/services/video-export";
import { getFfmpegPath, getFfprobePath } from "../src/main/utils/ffmpeg-path";

const execFileAsync = promisify(execFile);

let testDir = "";

function runProcess(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else
        reject(new Error(`process failed (${code}): ${stderr.slice(-1000)}`));
    });
  });
}

afterEach(async () => {
  if (testDir) await rm(testDir, { recursive: true, force: true });
  testDir = "";
});

describe("video export", () => {
  it("exports a real serialised variant with video and audio", async () => {
    testDir = await mkdtemp(join(tmpdir(), "kbcut-export-test-"));
    const sourcePath = join(testDir, "source.mp4");
    const outputDir = join(testDir, "output");
    const ffmpegPath = getFfmpegPath();

    await runProcess(ffmpegPath, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:s=320x240:d=1.2",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=1000:duration=1.2",
      "-shortest",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      sourcePath,
    ]);

    const result = await exportVariants({
      videoPath: sourcePath,
      outputDir,
      enableSubtitle: false,
      exportResolution: "source",
      variants: [
        {
          id: 1,
          name: "测试导出",
          strategy: "测试",
          abLabel: "痛点直击-1",
          totalDuration: 0.8,
          segments: [{ start: 0.1, end: 0.9, text: "测试口播", duration: 0.8 }],
        },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.files).toHaveLength(1);
    expect(basename(result.files[0]!)).toContain("痛点直击-1");
    expect((await stat(result.files[0]!)).size).toBeGreaterThan(1000);
  }, 120_000);

  it("keeps portrait orientation, audio, and requested subtitles at 720P", async () => {
    testDir = await mkdtemp(join(tmpdir(), "kbcut-export-test-"));
    const sourcePath = join(testDir, "portrait.mp4");
    const outputDir = join(testDir, "output");
    const ffmpegPath = getFfmpegPath();

    await runProcess(ffmpegPath, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=red:s=180x320:d=0.8",
      "-f",
      "lavfi",
      "-i",
      "sine=frequency=880:duration=0.8",
      "-shortest",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      sourcePath,
    ]);

    const result = await exportVariants({
      videoPath: sourcePath,
      outputDir,
      enableSubtitle: true,
      exportResolution: "720",
      variants: [
        {
          id: 1,
          name: "竖屏测试",
          strategy: "测试",
          totalDuration: 0.6,
          segments: [
            { start: 0.1, end: 0.7, text: "竖屏字幕测试", duration: 0.6 },
          ],
        },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.files).toHaveLength(1);

    const { stdout } = await execFileAsync(
      getFfprobePath(),
      [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,width,height",
        "-of",
        "json",
        result.files[0]!,
      ],
      { windowsHide: true },
    );
    const probe = JSON.parse(stdout);
    const video = probe.streams.find(
      (stream: any) => stream.codec_type === "video",
    );
    const audio = probe.streams.find(
      (stream: any) => stream.codec_type === "audio",
    );

    expect(video.width).toBe(720);
    expect(video.height).toBe(1280);
    expect(audio).toBeTruthy();
  }, 120_000);
});
