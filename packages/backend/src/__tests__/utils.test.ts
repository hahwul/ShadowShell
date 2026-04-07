import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import {
  pathExists,
  loadSettings,
  saveSettings,
  findPython3,
  getDefaultShell,
  generateId,
  frameSend,
  nextPortInRange,
} from "../utils";

// --- Temporary directory for file-based tests ---
const TEST_DIR = join(tmpdir(), `shadowshell-test-${process.pid}`);
const TEST_SETTINGS_DIR = join(TEST_DIR, "config");
const TEST_SETTINGS_FILE = join(TEST_SETTINGS_DIR, "settings.json");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});

describe("pathExists", () => {
  it("should return true for existing path", () => {
    expect(pathExists(__filename)).toBe(true);
  });

  it("should return true for existing directory", () => {
    expect(pathExists(__dirname)).toBe(true);
  });

  it("should return false for non-existent path", () => {
    expect(pathExists("/nonexistent/path/file.txt")).toBe(false);
  });

  it("should return false for empty string", () => {
    expect(pathExists("")).toBe(false);
  });
});

describe("loadSettings", () => {
  it("should return empty object when file does not exist", () => {
    expect(loadSettings("/nonexistent/settings.json")).toEqual({});
  });

  it("should parse valid JSON settings file", () => {
    mkdirSync(TEST_SETTINGS_DIR, { recursive: true });
    writeFileSync(TEST_SETTINGS_FILE, JSON.stringify({ pythonPath: "/usr/bin/python3" }));
    expect(loadSettings(TEST_SETTINGS_FILE)).toEqual({ pythonPath: "/usr/bin/python3" });
  });

  it("should return empty object for invalid JSON", () => {
    mkdirSync(TEST_SETTINGS_DIR, { recursive: true });
    writeFileSync(TEST_SETTINGS_FILE, "not valid json{{{");
    expect(loadSettings(TEST_SETTINGS_FILE)).toEqual({});
  });

  it("should return empty object for empty file", () => {
    mkdirSync(TEST_SETTINGS_DIR, { recursive: true });
    writeFileSync(TEST_SETTINGS_FILE, "");
    expect(loadSettings(TEST_SETTINGS_FILE)).toEqual({});
  });
});

describe("saveSettings", () => {
  it("should create directory and write settings file", () => {
    const dir = join(TEST_DIR, "newsettings");
    const file = join(dir, "settings.json");
    saveSettings(dir, file, { pythonPath: "/usr/bin/python3" });
    const result = loadSettings(file);
    expect(result).toEqual({ pythonPath: "/usr/bin/python3" });
  });

  it("should overwrite existing settings", () => {
    mkdirSync(TEST_SETTINGS_DIR, { recursive: true });
    writeFileSync(TEST_SETTINGS_FILE, JSON.stringify({ pythonPath: "/old" }));
    saveSettings(TEST_SETTINGS_DIR, TEST_SETTINGS_FILE, { pythonPath: "/new" });
    expect(loadSettings(TEST_SETTINGS_FILE)).toEqual({ pythonPath: "/new" });
  });

  it("should write pretty-printed JSON", () => {
    const dir = join(TEST_DIR, "pretty");
    const file = join(dir, "settings.json");
    saveSettings(dir, file, { key: "value" });
    const { readFileSync } = require("fs");
    const content = readFileSync(file, "utf-8");
    expect(content).toContain("\n"); // pretty printed
    expect(content).toContain("  "); // indented
  });
});

describe("findPython3", () => {
  it("should return cached path when provided", () => {
    expect(findPython3("/cached/python3", "/nonexistent/settings.json")).toBe("/cached/python3");
  });

  it("should try settings file when no cached path", () => {
    mkdirSync(TEST_SETTINGS_DIR, { recursive: true });
    // Point settings to a path that exists (use this test file as a stand-in)
    writeFileSync(TEST_SETTINGS_FILE, JSON.stringify({ pythonPath: __filename }));
    const result = findPython3(null, TEST_SETTINGS_FILE);
    expect(result).toBe(__filename);
  });

  it("should fall back to known python paths or default", () => {
    const result = findPython3(null, "/nonexistent/settings.json");
    // On macOS, one of the standard paths should exist, or falls back to /usr/bin/python3
    expect(result).toMatch(/python3/);
  });
});

describe("getDefaultShell", () => {
  it("should return a shell path", () => {
    const shell = getDefaultShell();
    expect(shell).toBeTruthy();
    // On macOS/Linux, should return one of the standard shells
    expect(shell).toMatch(/\/(zsh|bash|sh)$|powershell\.exe$/);
  });
});

describe("generateId", () => {
  it("should generate ID with counter and timestamp", () => {
    const id = generateId(1);
    expect(id).toMatch(/^term-1-\d+$/);
  });

  it("should generate different IDs for different counters", () => {
    const id1 = generateId(1);
    const id2 = generateId(2);
    expect(id1).not.toBe(id2);
    expect(id1).toContain("term-1-");
    expect(id2).toContain("term-2-");
  });
});

describe("frameSend", () => {
  it("should write 4-byte header + JSON payload", () => {
    const chunks: Buffer[] = [];
    const mockSocket = {
      write: vi.fn((data: Buffer) => {
        chunks.push(data);
        return true;
      }),
    } as any;

    const result = frameSend(mockSocket, { type: "input", data: "hello" });
    expect(result).toBe(true);
    expect(mockSocket.write).toHaveBeenCalledOnce();

    const written = chunks[0]!;
    // First 4 bytes = length header
    const payloadLength = written.readUInt32BE(0);
    const payload = written.subarray(4).toString("utf-8");
    expect(JSON.parse(payload)).toEqual({ type: "input", data: "hello" });
    expect(payloadLength).toBe(Buffer.byteLength(payload, "utf-8"));
  });

  it("should handle resize messages", () => {
    const chunks: Buffer[] = [];
    const mockSocket = {
      write: vi.fn((data: Buffer) => {
        chunks.push(data);
        return true;
      }),
    } as any;

    frameSend(mockSocket, { type: "resize", cols: 120, rows: 40 });
    const written = chunks[0]!;
    const payload = JSON.parse(written.subarray(4).toString("utf-8"));
    expect(payload).toEqual({ type: "resize", cols: 120, rows: 40 });
  });

  it("should return false when socket.write throws", () => {
    const mockSocket = {
      write: vi.fn(() => {
        throw new Error("socket closed");
      }),
    } as any;

    const result = frameSend(mockSocket, { type: "input", data: "test" });
    expect(result).toBe(false);
  });

  it("should handle UTF-8 data correctly", () => {
    const chunks: Buffer[] = [];
    const mockSocket = {
      write: vi.fn((data: Buffer) => {
        chunks.push(data);
        return true;
      }),
    } as any;

    frameSend(mockSocket, { type: "input", data: "한글 테스트 🚀" });
    const written = chunks[0]!;
    const payloadLength = written.readUInt32BE(0);
    const payload = written.subarray(4);
    expect(payload.length).toBe(payloadLength);
    const parsed = JSON.parse(payload.toString("utf-8"));
    expect(parsed.data).toBe("한글 테스트 🚀");
  });

  it("should handle empty object", () => {
    const mockSocket = { write: vi.fn(() => true) } as any;
    const result = frameSend(mockSocket, {});
    expect(result).toBe(true);
  });
});

describe("nextPortInRange", () => {
  it("should return current port when within range", () => {
    expect(nextPortInRange(18500, 32767, 18500)).toBe(18500);
    expect(nextPortInRange(25000, 32767, 18500)).toBe(25000);
  });

  it("should reset to min when exceeding max", () => {
    expect(nextPortInRange(32768, 32767, 18500)).toBe(18500);
    expect(nextPortInRange(40000, 32767, 18500)).toBe(18500);
  });

  it("should return current when exactly at max", () => {
    expect(nextPortInRange(32767, 32767, 18500)).toBe(32767);
  });
});
