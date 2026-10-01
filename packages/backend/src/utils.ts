import { readFileSync, writeFileSync, mkdirSync, statSync, renameSync, unlinkSync } from "fs";
import { platform } from "os";
import type { Socket } from "net";

export function pathExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function loadSettings(settingsFile: string): { pythonPath?: string; defaultDirectory?: string } {
  try {
    const data = readFileSync(settingsFile, "utf-8");
    const parsed = JSON.parse(data);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

export function saveSettings(
  settingsDir: string,
  settingsFile: string,
  settings: Record<string, unknown>
): void {
  if (!pathExists(settingsDir)) mkdirSync(settingsDir, { recursive: true, mode: 0o700 });
  writeFileAtomic(settingsFile, JSON.stringify(settings, null, 2));
}

// Atomic write: write to a temp file, then rename. Avoids a torn file if the
// process crashes mid-write, and readers never observe a truncated file.
export function writeFileAtomic(file: string, content: string, mode = 0o600): void {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, content, { mode });
    renameSync(tmp, file);
  } catch (err) {
    try { unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

export function findPython3(
  cachedPath: string | null,
  settingsFile: string
): string {
  if (cachedPath) return cachedPath;
  const saved = loadSettings(settingsFile).pythonPath;
  if (saved && pathExists(saved)) return saved;
  for (const p of [
    "/usr/bin/python3",
    "/usr/local/bin/python3",
    "/opt/homebrew/bin/python3",
  ]) {
    if (pathExists(p)) return p;
  }
  return "/usr/bin/python3";
}

export function getDefaultShell(): string {
  if (platform() === "win32") return "powershell.exe";
  for (const s of ["/bin/zsh", "/bin/bash", "/bin/sh"]) {
    if (pathExists(s)) return s;
  }
  return "/bin/sh";
}

export function generateId(counter: number): string {
  return `term-${counter}-${Date.now()}`;
}

export function frameSend(
  sock: Socket,
  obj: Record<string, unknown>
): boolean {
  try {
    const payload = Buffer.from(JSON.stringify(obj), "utf-8");
    const header = Buffer.alloc(4);
    header.writeUInt32BE(payload.length, 0);
    sock.write(Buffer.concat([header, payload]));
    return true;
  } catch {
    return false;
  }
}

// Splits `buf` into a prefix that ends on a UTF-8 character boundary and the
// trailing bytes of an incomplete multi-byte sequence. Callers carry the tail
// over to the next chunk so characters straddling TCP reads are not decoded
// as U+FFFD.
export function splitUtf8Tail(buf: Buffer): [Buffer, Buffer] {
  const start = Math.max(0, buf.length - 3);
  for (let i = buf.length - 1; i >= start; i--) {
    const b = buf[i]!;
    if ((b & 0xc0) === 0x80) continue; // continuation byte
    const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
    if (i + need > buf.length) return [buf.subarray(0, i), buf.subarray(i)];
    break;
  }
  return [buf, buf.subarray(buf.length)];
}
