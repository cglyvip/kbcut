import { isAbsolute, normalize, resolve, sep } from "path";

export function requireFsPath(
  value: unknown,
  label: string,
  maxLength = 32768,
): string {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label}不能为空`);
  if (text.length > maxLength) throw new Error(`${label}过长`);
  if (text.includes("\0")) throw new Error(`${label}包含非法字符`);
  if (/^(file|https?|data|javascript):/i.test(text)) {
    throw new Error(`${label}必须是本地文件路径`);
  }
  // Windows drive / UNC, or POSIX absolute
  if (
    !isAbsolute(text) &&
    !/^[A-Za-z]:[\\/]/.test(text) &&
    !text.startsWith("\\\\")
  ) {
    throw new Error(`${label}必须是绝对路径`);
  }
  const normalized = normalize(text);
  // Reject path escape tricks that normalize oddly on some platforms
  if (
    normalized.includes(`..${sep}`) ||
    normalized.endsWith(`${sep}..`) ||
    normalized === ".."
  ) {
    throw new Error(`${label}非法`);
  }
  return resolve(normalized);
}

export function requireHttpUrlPublic(value: unknown, label: string): string {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label}不能为空`);
  if (text.length > 2048) throw new Error(`${label}过长`);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${label}格式无效`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label}仅支持 http/https`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`${label}不允许携带账号密码`);
  }
  return parsed.toString();
}
