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
  if (!pathExists(settingsDir)) mkdirSync(settingsDir, { recursive: true });
  // Atomic write: write to a temp file, then rename. Avoids a torn settings.json
  // if the process crashes or is killed mid-write.
  const tmp = `${settingsFile}.tmp-${process.pid}-${Date.now()}`;
  try {
    writeFileSync(tmp, JSON.stringify(settings, null, 2));
    renameSync(tmp, settingsFile);
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

export function nextPortInRange(current: number, max: number, min: number): number {
  return current > max ? min : current;
}

// Pick the next port in [min, max] that is not in `used`, starting from `current`.
// `next` is the value to assign back to the rolling counter so the following
// allocation continues sequentially. If every port in range is in use, returns
// the requested port anyway (caller will see a bind failure rather than us
// silently looping forever).
export function allocatePort(
  current: number,
  min: number,
  max: number,
  used: Set<number>
): { port: number; next: number } {
  const span = max - min + 1;
  let p = current;
  if (p < min || p > max) p = min;
  for (let i = 0; i < span; i++) {
    if (!used.has(p)) {
      const next = p + 1 > max ? min : p + 1;
      return { port: p, next };
    }
    p = p + 1 > max ? min : p + 1;
  }
  return { port: p, next: p + 1 > max ? min : p + 1 };
}
