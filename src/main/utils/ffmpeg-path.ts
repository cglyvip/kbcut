import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { createRequire } from "module";
import { app } from "electron";

const moduleRequire = createRequire(import.meta.url);

function findSystemBinary(name: string): string | null {
  try {
    const result = execSync(`where ${name}`, {
      encoding: "utf-8",
      windowsHide: true,
    }).trim();
    const first = result
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    return first || null;
  } catch {
    return null;
  }
}

function candidateResourceBins(name: string): string[] {
  const file = process.platform === "win32" ? `${name}.exe` : name;
  const list: string[] = [];
  try {
    // packaged app resources
    list.push(join(process.resourcesPath || "", "bin", file));
  } catch {}
  try {
    // project resources during dev
    list.push(join(app.getAppPath(), "resources", "bin", file));
  } catch {}
  list.push(join(process.cwd(), "resources", "bin", file));
  return list;
}

function findLocalBinary(name: string): string | null {
  for (const p of candidateResourceBins(name)) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

function resolvePackagedBinaryPath(p: string): string | null {
  if (!p) return null;
  if (existsSync(p) && !p.includes("app.asar")) return p;
  const unpacked = p.replace(/app\.asar([\\/])/, "app.asar.unpacked$1");
  if (existsSync(unpacked)) return unpacked;
  return existsSync(p) ? p : null;
}

export function getFfmpegPath(): string {
  const local = findLocalBinary("ffmpeg");
  if (local) return local;

  try {
    const p = moduleRequire("ffmpeg-static") as string;
    const resolved = resolvePackagedBinaryPath(p);
    if (resolved) return resolved;
  } catch {}

  const systemPath = findSystemBinary("ffmpeg");
  if (systemPath) return systemPath;

  throw new Error(
    "未找到 FFmpeg。请安装 FFmpeg（winget install ffmpeg）或将 ffmpeg.exe 放到 resources/bin/",
  );
}

export function getFfprobePath(): string {
  const local = findLocalBinary("ffprobe");
  if (local) return local;

  try {
    const installer = moduleRequire("@ffprobe-installer/ffprobe") as {
      path?: string;
    };
    const resolved = resolvePackagedBinaryPath(String(installer?.path || ""));
    if (resolved) return resolved;
  } catch {}

  const systemPath = findSystemBinary("ffprobe");
  if (systemPath) return systemPath;

  throw new Error(
    "未找到 FFprobe。请安装完整 FFmpeg（包含 ffprobe）或将 ffprobe.exe 放到 resources/bin/",
  );
}
