import { readFileSync, writeFileSync, mkdirSync, statSync } from "fs";
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

export function loadSettings(settingsFile: string): { pythonPath?: string; defaultDirectory?: string } {
  try {
    const data = readFileSync(settingsFile, "utf-8");
    return JSON.parse(data);
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
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
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
