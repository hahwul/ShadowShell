import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Module mocks (hoisted before imports) ---

vi.mock("caido:plugin", () => ({}));

vi.mock("../utils", () => ({
  pathExists: vi.fn(),
  isDirectory: vi.fn(),
  loadSettings: vi.fn(),
  saveSettings: vi.fn(),
  findPython3: vi.fn(),
  getDefaultShell: vi.fn(),
  frameSend: vi.fn(),
}));

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("net", () => ({
  connect: vi.fn(),
}));

vi.mock("fs", () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("os", () => ({
  homedir: vi.fn(() => "/home/testuser"),
  platform: vi.fn(() => "darwin"),
  tmpdir: vi.fn(() => "/tmp"),
}));

// --- Imports ---

import { init } from "../index";
import {
  pathExists,
  isDirectory,
  loadSettings,
  saveSettings,
  findPython3,
  getDefaultShell,
  frameSend,
} from "../utils";
import { spawn } from "child_process";

// --- Helpers ---

type Handler = (...args: any[]) => any;

function createMockSdk() {
  const handlers = new Map<string, Handler>();
  return {
    api: {
      register: vi.fn((name: string, fn: Handler) => {
        handlers.set(name, fn);
      }),
      send: vi.fn(),
    },
    console: { log: vi.fn() },
    _handlers: handlers,
  };
}

function createMockProcess() {
  return {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn(),
    kill: vi.fn(),
    pid: 12345,
  };
}

// --- Tests ---

describe("Backend API handlers", () => {
  let sdk: ReturnType<typeof createMockSdk>;
  let handlers: Map<string, Handler>;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(pathExists).mockReturnValue(true);
    vi.mocked(isDirectory).mockReturnValue(true);
    vi.mocked(loadSettings).mockReturnValue({});
    vi.mocked(findPython3).mockReturnValue("/usr/bin/python3");
    vi.mocked(getDefaultShell).mockReturnValue("/bin/zsh");
    vi.mocked(frameSend).mockReturnValue(true);
    vi.mocked(spawn).mockImplementation((() => createMockProcess()) as any);

    sdk = createMockSdk();
    init(sdk as any);
    handlers = sdk._handlers;
  });

  afterEach(() => {
    handlers.get("destroyAllTerminals")!(sdk);
    handlers.get("setPythonPath")!(sdk, "");
  });

  describe("init", () => {
    it("should register all 12 API handlers", () => {
      const expected = [
        "createTerminal",
        "writeTerminal",
        "resizeTerminal",
        "destroyTerminal",
        "destroyAllTerminals",
        "listTerminals",
        "getShellInfo",
        "setPythonPath",
        "getPythonPath",
        "setDefaultDirectory",
        "getDefaultDirectory",
        "validateDirectory",
      ];
      for (const name of expected) {
        expect(handlers.has(name), `handler "${name}" should be registered`).toBe(
          true
        );
      }
      expect(sdk.api.register).toHaveBeenCalledTimes(12);
    });

    it("should log initialization message", () => {
      expect(sdk.console.log).toHaveBeenCalledWith(
        "ShadowShell backend initialized"
      );
    });
  });

  describe("getShellInfo", () => {
    it("should return shell, platform, and home directory", () => {
      const result = handlers.get("getShellInfo")!(sdk);
      expect(result).toEqual({
        defaultShell: "/bin/zsh",
        platform: "darwin",
        home: "/home/testuser",
      });
    });
  });

  describe("validateDirectory", () => {
    it("should return true for empty path", () => {
      expect(handlers.get("validateDirectory")!(sdk, "")).toBe(true);
    });

    it("should return true when isDirectory returns true", () => {
      vi.mocked(isDirectory).mockReturnValue(true);
      expect(handlers.get("validateDirectory")!(sdk, "/valid/dir")).toBe(true);
    });

    it("should return false when isDirectory returns false", () => {
      vi.mocked(isDirectory).mockReturnValue(false);
      expect(handlers.get("validateDirectory")!(sdk, "/invalid")).toBe(false);
    });
  });

  describe("getDefaultDirectory", () => {
    it("should return empty string when no setting exists", () => {
      vi.mocked(loadSettings).mockReturnValue({});
      expect(handlers.get("getDefaultDirectory")!(sdk)).toBe("");
    });

    it("should return saved directory from settings", () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultDirectory: "/projects",
      });
      expect(handlers.get("getDefaultDirectory")!(sdk)).toBe("/projects");
    });
  });

  describe("setDefaultDirectory", () => {
    it("should save valid directory path", () => {
      vi.mocked(isDirectory).mockReturnValue(true);
      expect(handlers.get("setDefaultDirectory")!(sdk, "/projects")).toBe(true);
      expect(saveSettings).toHaveBeenCalled();
    });

    it("should reject non-directory path", () => {
      vi.mocked(isDirectory).mockReturnValue(false);
      expect(handlers.get("setDefaultDirectory")!(sdk, "/not/a/dir")).toBe(
        false
      );
      expect(saveSettings).not.toHaveBeenCalled();
    });

    it("should clear directory with empty string", () => {
      expect(handlers.get("setDefaultDirectory")!(sdk, "")).toBe(true);
      expect(saveSettings).toHaveBeenCalled();
    });

    it("should persist defaultDirectory in settings", () => {
      vi.mocked(isDirectory).mockReturnValue(true);
      handlers.get("setDefaultDirectory")!(sdk, "/test/dir");

      const savedSettings = vi.mocked(saveSettings).mock.calls[0]?.[2];
      expect(savedSettings).toEqual(
        expect.objectContaining({ defaultDirectory: "/test/dir" })
      );
    });

    it("should remove defaultDirectory when clearing", () => {
      vi.mocked(loadSettings).mockReturnValue({
        defaultDirectory: "/old",
      });
      handlers.get("setDefaultDirectory")!(sdk, "");

      const savedSettings = vi.mocked(saveSettings).mock.calls[0]?.[2];
      expect(savedSettings).not.toHaveProperty("defaultDirectory");
    });
  });

  describe("setPythonPath", () => {
    it("should save valid python path", () => {
      vi.mocked(pathExists).mockReturnValue(true);
      expect(
        handlers.get("setPythonPath")!(sdk, "/usr/local/bin/python3")
      ).toBe(true);
      expect(saveSettings).toHaveBeenCalled();
    });

    it("should reject non-existent path", () => {
      vi.mocked(pathExists).mockReturnValue(false);
      expect(
        handlers.get("setPythonPath")!(sdk, "/nonexistent/python")
      ).toBe(false);
      expect(saveSettings).not.toHaveBeenCalled();
    });

    it("should clear to auto-detect with empty string", () => {
      expect(handlers.get("setPythonPath")!(sdk, "")).toBe(true);
      expect(saveSettings).toHaveBeenCalled();
    });

    it("should cache python path for subsequent getPythonPath calls", () => {
      vi.mocked(pathExists).mockReturnValue(true);
      handlers.get("setPythonPath")!(sdk, "/custom/python3");

      vi.clearAllMocks();
      const result = handlers.get("getPythonPath")!(sdk);
      expect(result).toBe("/custom/python3");
      expect(findPython3).not.toHaveBeenCalled();
    });

    it("should persist pythonPath in settings", () => {
      vi.mocked(pathExists).mockReturnValue(true);
      handlers.get("setPythonPath")!(sdk, "/custom/python3");

      const savedSettings = vi.mocked(saveSettings).mock.calls[0]?.[2];
      expect(savedSettings).toEqual(
        expect.objectContaining({ pythonPath: "/custom/python3" })
      );
    });
  });

  describe("getPythonPath", () => {
    it("should delegate to findPython3 when not cached", () => {
      handlers.get("setPythonPath")!(sdk, "");
      vi.clearAllMocks();

      vi.mocked(findPython3).mockReturnValue("/detected/python3");
      const result = handlers.get("getPythonPath")!(sdk);
      expect(result).toBe("/detected/python3");
    });
  });

  describe("listTerminals", () => {
    it("should return empty array when no terminals exist", () => {
      expect(handlers.get("listTerminals")!(sdk)).toEqual([]);
    });

    it("should list created terminal", () => {
      const id = handlers.get("createTerminal")!(sdk, "/test", "", "shell");
      const list = handlers.get("listTerminals")!(sdk);

      expect(list).toHaveLength(1);
      expect(list[0]).toEqual({
        id,
        cwd: "/test",
        presetName: "shell",
      });
    });

    it("should list multiple terminals", () => {
      handlers.get("createTerminal")!(sdk, "/dir1", "", "preset1");
      handlers.get("createTerminal")!(sdk, "/dir2", "", "preset2");

      expect(handlers.get("listTerminals")!(sdk)).toHaveLength(2);
    });
  });

  describe("createTerminal", () => {
    it("should return a terminal ID matching expected format", () => {
      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      expect(id).toMatch(/^term-\d+-\d+$/);
    });

    it("should spawn a python process with relay script", () => {
      handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      expect(spawn).toHaveBeenCalledWith("/usr/bin/python3", [
        "/tmp/shadowshell/relay.py",
        expect.stringMatching(/^\d+$/),
        "/bin/zsh",
        "/home",
      ]);
    });

    it("should fall back to home directory when no cwd provided", () => {
      handlers.get("createTerminal")!(sdk, "", "", "shell");
      expect(spawn).toHaveBeenCalledWith("/usr/bin/python3", [
        "/tmp/shadowshell/relay.py",
        expect.stringMatching(/^\d+$/),
        "/bin/zsh",
        "/home/testuser",
      ]);
    });

    it("should use provided working directory", () => {
      handlers.get("createTerminal")!(sdk, "/custom/dir", "", "shell");
      expect(spawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(["/custom/dir"])
      );
    });

    it("should store preset name", () => {
      const id = handlers.get("createTerminal")!(sdk, "/home", "", "claude");
      const list = handlers.get("listTerminals")!(sdk);
      expect(list.find((t: any) => t.id === id)?.presetName).toBe("claude");
    });

    it("should assign unique IDs to multiple terminals", () => {
      const id1 = handlers.get("createTerminal")!(sdk, "/a", "", "s");
      const id2 = handlers.get("createTerminal")!(sdk, "/b", "", "s");
      expect(id1).not.toBe(id2);
    });
  });

  describe("writeTerminal", () => {
    it("should return false for non-existent terminal", () => {
      expect(handlers.get("writeTerminal")!(sdk, "nonexistent", "data")).toBe(
        false
      );
    });

    it("should return false when session has no socket", () => {
      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      expect(handlers.get("writeTerminal")!(sdk, id, "data")).toBe(false);
    });
  });

  describe("resizeTerminal", () => {
    it("should return false for non-existent terminal", () => {
      expect(
        handlers.get("resizeTerminal")!(sdk, "nonexistent", 80, 24)
      ).toBe(false);
    });

    it("should return false when session has no socket", () => {
      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      expect(handlers.get("resizeTerminal")!(sdk, id, 120, 40)).toBe(false);
    });
  });

  describe("destroyTerminal", () => {
    it("should return false for non-existent terminal", () => {
      expect(handlers.get("destroyTerminal")!(sdk, "nonexistent")).toBe(false);
    });

    it("should return true and remove terminal from list", () => {
      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      expect(handlers.get("destroyTerminal")!(sdk, id)).toBe(true);
      expect(handlers.get("listTerminals")!(sdk)).toEqual([]);
    });

    it("should kill the process", () => {
      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const mockProc =
        vi.mocked(spawn).mock.results[
          vi.mocked(spawn).mock.results.length - 1
        ]?.value;

      handlers.get("destroyTerminal")!(sdk, id);
      expect(mockProc.kill).toHaveBeenCalled();
    });

    it("should log destruction message", () => {
      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      handlers.get("destroyTerminal")!(sdk, id);
      expect(sdk.console.log).toHaveBeenCalledWith(
        `Terminal destroyed: ${id}`
      );
    });
  });

  describe("destroyAllTerminals", () => {
    it("should handle empty state without error", () => {
      expect(() =>
        handlers.get("destroyAllTerminals")!(sdk)
      ).not.toThrow();
    });

    it("should clear all terminals", () => {
      handlers.get("createTerminal")!(sdk, "/a", "", "p1");
      handlers.get("createTerminal")!(sdk, "/b", "", "p2");
      handlers.get("createTerminal")!(sdk, "/c", "", "p3");

      handlers.get("destroyAllTerminals")!(sdk);
      expect(handlers.get("listTerminals")!(sdk)).toEqual([]);
    });

    it("should kill all processes", () => {
      handlers.get("createTerminal")!(sdk, "/a", "", "p1");
      handlers.get("createTerminal")!(sdk, "/b", "", "p2");

      const procs = vi.mocked(spawn).mock.results.map((r) => r.value);

      handlers.get("destroyAllTerminals")!(sdk);
      for (const proc of procs) {
        expect(proc.kill).toHaveBeenCalled();
      }
    });
  });
});
