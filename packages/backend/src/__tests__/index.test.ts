import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Module mocks (hoisted before imports) ---

vi.mock("caido:plugin", () => ({}));

vi.mock("../utils", async () => {
  const actual = await vi.importActual<typeof import("../utils")>("../utils");
  return {
    pathExists: vi.fn(),
    isDirectory: vi.fn(),
    loadSettings: vi.fn(),
    saveSettings: vi.fn(),
    findPython3: vi.fn(),
    getDefaultShell: vi.fn(),
    frameSend: vi.fn(),
    writeFileAtomic: vi.fn(),
    splitUtf8Tail: actual.splitUtf8Tail,
  };
});

vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

vi.mock("net", () => ({
  connect: vi.fn(),
}));

vi.mock("fs", () => ({
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
  writeFileAtomic,
} from "../utils";
import { spawn } from "child_process";
import { connect } from "net";

// --- Helpers ---

const TOKEN = "deadbeef";
const READY = `READY:18500:${TOKEN}\n`;

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
        "/home/testuser/.config/shadowshell/relay.py",
        "/bin/zsh",
        "/home",
      ]);
    });

    it("should fall back to home directory when no cwd provided", () => {
      handlers.get("createTerminal")!(sdk, "", "", "shell");
      expect(spawn).toHaveBeenCalledWith("/usr/bin/python3", [
        "/home/testuser/.config/shadowshell/relay.py",
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

    it("should queue input while the relay is still connecting", () => {
      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      expect(handlers.get("writeTerminal")!(sdk, id, "data")).toBe(true);
      expect(frameSend).not.toHaveBeenCalled();
    });
  });

  describe("resizeTerminal", () => {
    it("should return false for non-existent terminal", () => {
      expect(
        handlers.get("resizeTerminal")!(sdk, "nonexistent", 80, 24)
      ).toBe(false);
    });

    it("should remember the size while the relay is still connecting", () => {
      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      expect(handlers.get("resizeTerminal")!(sdk, id, 120, 40)).toBe(true);
      expect(frameSend).not.toHaveBeenCalled();
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

  // --- Helpers for lifecycle tests ---
  function lastSpawnedProc() {
    const results = vi.mocked(spawn).mock.results;
    return results[results.length - 1]?.value;
  }

  function getProcHandler(proc: any, event: string) {
    return proc.on.mock.calls.find(
      ([e]: [string]) => e === event
    )?.[1];
  }

  function getStdoutHandler(proc: any) {
    return proc.stdout.on.mock.calls.find(
      ([e]: [string]) => e === "data"
    )?.[1];
  }

  function getStderrHandler(proc: any) {
    return proc.stderr.on.mock.calls.find(
      ([e]: [string]) => e === "data"
    )?.[1];
  }

  function createMockSocket() {
    return {
      on: vi.fn(),
      destroy: vi.fn(),
      setNoDelay: vi.fn(),
    };
  }

  function getSocketHandler(sock: any, event: string) {
    return sock.on.mock.calls.find(
      ([e]: [string]) => e === event
    )?.[1];
  }

  // Sets up `connect()` so that the connect callback is captured rather than
  // fired immediately — calling it inline would hit a TDZ on the `sock` const
  // in the source. Returns a function that fires all pending callbacks AFTER
  // `connect()` has returned and `sock` is initialized.
  function deferredConnect(socket: ReturnType<typeof createMockSocket>) {
    const pending: Array<() => void> = [];
    vi.mocked(connect).mockImplementation(((_port: number, _host: string, cb: () => void) => {
      if (cb) pending.push(cb);
      return socket;
    }) as any);
    return () => {
      while (pending.length) pending.shift()!();
    };
  }

  describe("process lifecycle events", () => {
    it("should send terminalExit event when process exits with code", () => {
      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const exitHandler = getProcHandler(proc, "exit");
      expect(exitHandler).toBeDefined();

      exitHandler!(0);
      expect(sdk.api.send).toHaveBeenCalledWith("terminalExit", {
        terminalId: id,
        code: 0,
      });
    });

    it("should remove terminal from registry on exit", () => {
      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const exitHandler = getProcHandler(proc, "exit");

      exitHandler!(0);
      expect(handlers.get("listTerminals")!(sdk).find((t: any) => t.id === id)).toBeUndefined();
    });

    it("should use -1 as exit code when null is passed", () => {
      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const exitHandler = getProcHandler(proc, "exit");

      exitHandler!(null);
      expect(sdk.api.send).toHaveBeenCalledWith("terminalExit", {
        terminalId: id,
        code: -1,
      });
    });

    it("should propagate non-zero exit codes", () => {
      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const exitHandler = getProcHandler(proc, "exit");

      exitHandler!(137);
      expect(sdk.api.send).toHaveBeenCalledWith("terminalExit", {
        terminalId: id,
        code: 137,
      });
    });

    it("should remove terminal when process emits error", () => {
      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const errorHandler = getProcHandler(proc, "error");
      expect(errorHandler).toBeDefined();

      errorHandler!(new Error("spawn failed"));
      expect(handlers.get("listTerminals")!(sdk).find((t: any) => t.id === id)).toBeUndefined();
    });

    it("should log relay error message via console.log", () => {
      handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const errorHandler = getProcHandler(proc, "error");

      errorHandler!(new Error("ENOENT"));
      expect(sdk.console.log).toHaveBeenCalledWith(
        expect.stringContaining("[relay error] ENOENT")
      );
    });

    it("should log stderr output via console.log", () => {
      handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const stderrHandler = getStderrHandler(proc);
      expect(stderrHandler).toBeDefined();

      stderrHandler!(Buffer.from("python traceback"));
      expect(sdk.console.log).toHaveBeenCalledWith(
        expect.stringContaining("[relay stderr] python traceback")
      );
    });
  });

  describe("READY signal and socket connection", () => {
    it("should connect via TCP when stdout emits READY", () => {
      const mockSocket = createMockSocket();
      vi.mocked(connect).mockImplementation(((..._args: any[]) => mockSocket) as any);

      handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const stdoutHandler = getStdoutHandler(proc);

      stdoutHandler!(Buffer.from(READY));
      expect(connect).toHaveBeenCalledWith(
        expect.any(Number),
        "127.0.0.1",
        expect.any(Function)
      );
    });

    it("should not connect when READY token is absent", () => {
      handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const stdoutHandler = getStdoutHandler(proc);

      stdoutHandler!(Buffer.from("starting up..."));
      expect(connect).not.toHaveBeenCalled();
    });

    it("should buffer stdout chunks until READY arrives", () => {
      const mockSocket = createMockSocket();
      vi.mocked(connect).mockImplementation(((..._args: any[]) => mockSocket) as any);

      handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const stdoutHandler = getStdoutHandler(proc);

      stdoutHandler!(Buffer.from("REA"));
      expect(connect).not.toHaveBeenCalled();
      stdoutHandler!(Buffer.from(`DY:18500:${TOKEN}\n`));
      expect(connect).toHaveBeenCalledOnce();
    });

    it("should not reconnect on subsequent stdout chunks after READY", () => {
      // Regression: stdoutBuf.includes("READY:") used to stay true forever once
      // the token arrived, so any additional stdout chunk would re-trigger
      // connect() and leak sockets. Guard with the `connected` flag.
      const mockSocket = createMockSocket();
      vi.mocked(connect).mockImplementation(((..._args: any[]) => mockSocket) as any);

      handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const stdoutHandler = getStdoutHandler(proc);

      stdoutHandler!(Buffer.from(READY));
      expect(connect).toHaveBeenCalledOnce();

      // Simulate further stdout from the relay (e.g., diagnostic prints).
      stdoutHandler!(Buffer.from("some later output\n"));
      stdoutHandler!(Buffer.from("more output\n"));
      expect(connect).toHaveBeenCalledOnce();
    });

    it("should send initial resize frame on socket connect", () => {
      const mockSocket = createMockSocket();
      const flush = deferredConnect(mockSocket);

      handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const stdoutHandler = getStdoutHandler(proc);

      stdoutHandler!(Buffer.from(READY));
      flush();
      expect(frameSend).toHaveBeenCalledWith(
        mockSocket,
        expect.objectContaining({ type: "resize", cols: 80, rows: 24 })
      );
    });

    it("should send preset command after delay when command is provided", () => {
      vi.useFakeTimers();
      try {
        const mockSocket = createMockSocket();
        const flush = deferredConnect(mockSocket);

        handlers.get("createTerminal")!(sdk, "/home", "claude", "claude");
        const proc = lastSpawnedProc();
        const stdoutHandler = getStdoutHandler(proc);

        stdoutHandler!(Buffer.from(READY));
        flush();
        // Initial resize was sent, but command frame is deferred
        const callsBefore = vi.mocked(frameSend).mock.calls.length;
        vi.advanceTimersByTime(600);
        const callsAfter = vi.mocked(frameSend).mock.calls.length;
        expect(callsAfter).toBeGreaterThan(callsBefore);

        const lastCall = vi.mocked(frameSend).mock.calls.at(-1);
        expect(lastCall?.[1]).toEqual({ type: "input", data: "claude\n" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("should not send preset command if terminal is destroyed before delay fires", () => {
      vi.useFakeTimers();
      try {
        const mockSocket = createMockSocket();
        const flush = deferredConnect(mockSocket);

        const id = handlers.get("createTerminal")!(sdk, "/home", "claude", "claude");
        const proc = lastSpawnedProc();
        const stdoutHandler = getStdoutHandler(proc);

        stdoutHandler!(Buffer.from(READY));
        flush();
        const callsAfterReady = vi.mocked(frameSend).mock.calls.length;

        // Destroy before the deferred command fires
        handlers.get("destroyTerminal")!(sdk, id);
        vi.advanceTimersByTime(1000);

        // No new frameSend calls beyond what happened on connect
        expect(vi.mocked(frameSend).mock.calls.length).toBe(callsAfterReady);
      } finally {
        vi.useRealTimers();
      }
    });

    it("should forward socket data as terminalOutput events", () => {
      const mockSocket = createMockSocket();
      const flush = deferredConnect(mockSocket);

      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const stdoutHandler = getStdoutHandler(proc);
      stdoutHandler!(Buffer.from(READY));
      flush();

      const dataHandler = getSocketHandler(mockSocket, "data");
      expect(dataHandler).toBeDefined();
      dataHandler!(Buffer.from("hello world"));

      expect(sdk.api.send).toHaveBeenCalledWith("terminalOutput", {
        terminalId: id,
        data: "hello world",
      });
    });

    it("should clear session.socket on close event", () => {
      const mockSocket = createMockSocket();
      const flush = deferredConnect(mockSocket);

      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const stdoutHandler = getStdoutHandler(proc);
      stdoutHandler!(Buffer.from(READY));
      flush();

      // Sanity: after connect, writeTerminal succeeds
      expect(handlers.get("writeTerminal")!(sdk, id, "x")).toBe(true);

      const closeHandler = getSocketHandler(mockSocket, "close");
      closeHandler!();

      // After close, the socket is null again so write fails
      expect(handlers.get("writeTerminal")!(sdk, id, "x")).toBe(false);
    });

    it("should handle socket error by clearing session.socket and logging", () => {
      const mockSocket = createMockSocket();
      const flush = deferredConnect(mockSocket);

      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const stdoutHandler = getStdoutHandler(proc);
      stdoutHandler!(Buffer.from(READY));
      flush();

      const errorHandler = getSocketHandler(mockSocket, "error");
      errorHandler!(new Error("ECONNRESET"));

      expect(sdk.console.log).toHaveBeenCalledWith(
        expect.stringContaining("[relay] socket error: ECONNRESET")
      );
      expect(handlers.get("writeTerminal")!(sdk, id, "x")).toBe(false);
    });

    it("should destroy late-arriving socket if terminal was already terminated", () => {
      const mockSocket = createMockSocket();
      const flush = deferredConnect(mockSocket);

      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const stdoutHandler = getStdoutHandler(proc);
      stdoutHandler!(Buffer.from(READY));

      // Terminal destroyed before the connect callback fires
      handlers.get("destroyTerminal")!(sdk, id);
      flush();

      expect(mockSocket.destroy).toHaveBeenCalled();
    });

    it("should ignore READY when session is already terminating", () => {
      const mockSocket = createMockSocket();
      vi.mocked(connect).mockImplementation(((..._args: any[]) => mockSocket) as any);

      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      handlers.get("destroyTerminal")!(sdk, id);

      const proc = lastSpawnedProc();
      const stdoutHandler = getStdoutHandler(proc);
      stdoutHandler!(Buffer.from(READY));

      expect(connect).not.toHaveBeenCalled();
    });
  });

  describe("writeTerminal / resizeTerminal with connected socket", () => {
    function createConnectedTerminal(): { id: string; socket: ReturnType<typeof createMockSocket> } {
      const mockSocket = createMockSocket();
      const flush = deferredConnect(mockSocket);

      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      const stdoutHandler = getStdoutHandler(proc);
      stdoutHandler!(Buffer.from(READY));
      flush();
      return { id, socket: mockSocket };
    }

    it("writeTerminal should send input frame and return true", () => {
      const { id, socket } = createConnectedTerminal();
      vi.mocked(frameSend).mockClear();

      expect(handlers.get("writeTerminal")!(sdk, id, "ls\n")).toBe(true);
      expect(frameSend).toHaveBeenCalledWith(socket, {
        type: "input",
        data: "ls\n",
      });
    });

    it("resizeTerminal should send resize frame and return true", () => {
      const { id, socket } = createConnectedTerminal();
      vi.mocked(frameSend).mockClear();

      expect(handlers.get("resizeTerminal")!(sdk, id, 120, 40)).toBe(true);
      expect(frameSend).toHaveBeenCalledWith(socket, {
        type: "resize",
        cols: 120,
        rows: 40,
      });
    });

    it("destroyTerminal should call socket.destroy on the connected socket", () => {
      const { id, socket } = createConnectedTerminal();
      handlers.get("destroyTerminal")!(sdk, id);
      expect(socket.destroy).toHaveBeenCalled();
    });

    it("destroyAllTerminals should destroy all connected sockets", () => {
      const t1 = createConnectedTerminal();
      const t2 = createConnectedTerminal();
      handlers.get("destroyAllTerminals")!(sdk);
      expect(t1.socket.destroy).toHaveBeenCalled();
      expect(t2.socket.destroy).toHaveBeenCalled();
    });

    it("writeTerminal should propagate frameSend failure", () => {
      // Regression: writeTerminal previously returned true unconditionally,
      // hiding socket write failures from callers.
      const { id } = createConnectedTerminal();
      vi.mocked(frameSend).mockReturnValueOnce(false);
      expect(handlers.get("writeTerminal")!(sdk, id, "data")).toBe(false);
    });

    it("resizeTerminal should propagate frameSend failure", () => {
      const { id } = createConnectedTerminal();
      vi.mocked(frameSend).mockReturnValueOnce(false);
      expect(handlers.get("resizeTerminal")!(sdk, id, 80, 24)).toBe(false);
    });

    it("resizeTerminal should reject non-positive or non-finite dimensions", () => {
      const { id } = createConnectedTerminal();
      vi.mocked(frameSend).mockClear();
      expect(handlers.get("resizeTerminal")!(sdk, id, 0, 24)).toBe(false);
      expect(handlers.get("resizeTerminal")!(sdk, id, 80, 0)).toBe(false);
      expect(handlers.get("resizeTerminal")!(sdk, id, -1, 24)).toBe(false);
      expect(handlers.get("resizeTerminal")!(sdk, id, Number.NaN, 24)).toBe(false);
      expect(handlers.get("resizeTerminal")!(sdk, id, Infinity, 24)).toBe(false);
      expect(frameSend).not.toHaveBeenCalled();
    });

    it("writeTerminal should return false once destroyTerminal is called", () => {
      const { id } = createConnectedTerminal();
      handlers.get("destroyTerminal")!(sdk, id);
      // Even if some stale code path retained a session reference, the
      // isTerminating guard prevents further writes.
      expect(handlers.get("writeTerminal")!(sdk, id, "x")).toBe(false);
    });
  });

  describe("relay handshake and pre-connect buffering", () => {
    function startTerminal(command = "") {
      const mockSocket = createMockSocket();
      const flush = deferredConnect(mockSocket);
      const id = handlers.get("createTerminal")!(sdk, "/home", command, "shell");
      const stdoutHandler = getStdoutHandler(lastSpawnedProc());
      return { id, mockSocket, flush, stdoutHandler };
    }

    it("should connect to the port reported by the relay", () => {
      const { stdoutHandler } = startTerminal();
      stdoutHandler!(Buffer.from(`READY:41234:${TOKEN}\n`));
      expect(connect).toHaveBeenCalledWith(41234, "127.0.0.1", expect.any(Function));
    });

    it("should not connect until the full READY line (with token) has arrived", () => {
      const { stdoutHandler } = startTerminal();
      stdoutHandler!(Buffer.from("READY:41234:dead"));
      expect(connect).not.toHaveBeenCalled();
      stdoutHandler!(Buffer.from("beef\n"));
      expect(connect).toHaveBeenCalledOnce();
    });

    it("should send the auth frame before anything else", () => {
      const { stdoutHandler, flush, mockSocket } = startTerminal();
      stdoutHandler!(Buffer.from(READY));
      flush();
      expect(vi.mocked(frameSend).mock.calls[0]).toEqual([
        mockSocket,
        { type: "auth", token: TOKEN },
      ]);
    });

    it("should apply a resize requested before the socket connected", () => {
      const { id, stdoutHandler, flush, mockSocket } = startTerminal();
      handlers.get("resizeTerminal")!(sdk, id, 132, 43);
      stdoutHandler!(Buffer.from(READY));
      flush();
      expect(frameSend).toHaveBeenCalledWith(mockSocket, { type: "resize", cols: 132, rows: 43 });
      expect(frameSend).not.toHaveBeenCalledWith(
        mockSocket,
        expect.objectContaining({ type: "resize", cols: 80, rows: 24 })
      );
    });

    it("should flush input typed before the socket connected, in order", () => {
      const { id, stdoutHandler, flush, mockSocket } = startTerminal();
      handlers.get("writeTerminal")!(sdk, id, "l");
      handlers.get("writeTerminal")!(sdk, id, "s\r");
      stdoutHandler!(Buffer.from(READY));
      flush();
      const inputs = vi.mocked(frameSend).mock.calls
        .filter(([sock, msg]) => (sock as unknown) === mockSocket && msg.type === "input")
        .map(([, msg]) => msg.data);
      expect(inputs).toEqual(["l", "s\r"]);
    });

    it("should not queue unbounded input before connecting", () => {
      const { id } = startTerminal();
      const big = "x".repeat(1024 * 1024);
      expect(handlers.get("writeTerminal")!(sdk, id, big)).toBe(true);
      expect(handlers.get("writeTerminal")!(sdk, id, "y")).toBe(false);
    });

    it("should reassemble UTF-8 characters split across socket chunks", () => {
      const { id, stdoutHandler, flush, mockSocket } = startTerminal();
      stdoutHandler!(Buffer.from(READY));
      flush();
      const dataHandler = getSocketHandler(mockSocket, "data")!;
      const bytes = Buffer.from("한글✓", "utf-8");
      dataHandler(bytes.subarray(0, 4));
      dataHandler(bytes.subarray(4, 8));
      dataHandler(bytes.subarray(8));
      const text = vi.mocked(sdk.api.send).mock.calls
        .filter(([name, ev]) => name === "terminalOutput" && ev.terminalId === id)
        .map(([, ev]) => ev.data)
        .join("");
      expect(text).toBe("한글✓");
    });

    it("should report terminalExit when the relay fails to spawn (error without exit)", () => {
      const id = handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      getProcHandler(proc, "error")!(new Error("ENOENT"));
      expect(sdk.api.send).toHaveBeenCalledWith("terminalExit", { terminalId: id, code: -1 });
    });

    it("should report terminalExit only once when both error and exit fire", () => {
      handlers.get("createTerminal")!(sdk, "/home", "", "shell");
      const proc = lastSpawnedProc();
      getProcHandler(proc, "error")!(new Error("boom"));
      getProcHandler(proc, "exit")!(1);
      const exits = vi.mocked(sdk.api.send).mock.calls.filter(([name]) => name === "terminalExit");
      expect(exits).toHaveLength(1);
    });

    it("should write the relay script exactly once, atomically", async () => {
      // relayScriptPath is module state; load a fresh copy of the module.
      vi.resetModules();
      const fresh = await import("../index");
      const freshSdk = createMockSdk();
      fresh.init(freshSdk as any);
      vi.mocked(writeFileAtomic).mockClear();
      const create = freshSdk._handlers.get("createTerminal")!;
      create(freshSdk, "/a", "", "s");
      create(freshSdk, "/b", "", "s");
      expect(writeFileAtomic).toHaveBeenCalledTimes(1);
      expect(writeFileAtomic).toHaveBeenCalledWith(
        "/home/testuser/.config/shadowshell/relay.py",
        expect.stringContaining("ShadowShell PTY relay")
      );
      freshSdk._handlers.get("destroyAllTerminals")!(freshSdk);
    });

    it("should fall back to the temp directory when the config dir is unwritable", async () => {
      vi.resetModules();
      const fresh = await import("../index");
      const freshSdk = createMockSdk();
      fresh.init(freshSdk as any);
      vi.mocked(writeFileAtomic).mockReset();
      vi.mocked(writeFileAtomic).mockImplementationOnce(() => {
        throw new Error("EACCES");
      });
      freshSdk._handlers.get("createTerminal")!(freshSdk, "/a", "", "s");
      expect(spawn).toHaveBeenLastCalledWith("/usr/bin/python3", [
        "/tmp/shadowshell/relay.py",
        "/bin/zsh",
        "/a",
      ]);
      freshSdk._handlers.get("destroyAllTerminals")!(freshSdk);
    });

    it("should stop the relay immediately on socket error", () => {
      const { stdoutHandler, flush, mockSocket } = startTerminal();
      const proc = lastSpawnedProc();
      stdoutHandler!(Buffer.from(READY));
      flush();
      getSocketHandler(mockSocket, "error")!(new Error("ECONNREFUSED"));
      expect(proc.kill).toHaveBeenCalled();
    });

    it("should stop the relay after socket close only if it does not exit on its own", () => {
      vi.useFakeTimers();
      try {
        for (const exitsOnItsOwn of [true, false]) {
          const { stdoutHandler, flush, mockSocket } = startTerminal();
          const proc = lastSpawnedProc();
          stdoutHandler!(Buffer.from(READY));
          flush();
          getSocketHandler(mockSocket, "close")!();
          expect(proc.kill).not.toHaveBeenCalled();
          if (exitsOnItsOwn) getProcHandler(proc, "exit")!(0);
          vi.advanceTimersByTime(2500);
          expect(proc.kill).toHaveBeenCalledTimes(exitsOnItsOwn ? 0 : 1);
        }
      } finally {
        vi.useRealTimers();
      }
    });

    it("should emit a dangling partial UTF-8 sequence when the socket closes", () => {
      const { id, stdoutHandler, flush, mockSocket } = startTerminal();
      stdoutHandler!(Buffer.from(READY));
      flush();
      getSocketHandler(mockSocket, "data")!(Buffer.from([0x61, 0xe2]));
      getSocketHandler(mockSocket, "close")!();
      const text = vi.mocked(sdk.api.send).mock.calls
        .filter(([name, ev]) => name === "terminalOutput" && ev.terminalId === id)
        .map(([, ev]) => ev.data)
        .join("");
      expect(text).toBe("a\uFFFD");
    });

    it("should reject sizes that floor to zero", () => {
      const { id } = startTerminal();
      expect(handlers.get("resizeTerminal")!(sdk, id, 0.5, 40)).toBe(false);
      expect(handlers.get("resizeTerminal")!(sdk, id, 80, 0.9)).toBe(false);
      expect(handlers.get("resizeTerminal")!(sdk, id, 80.7, 24.2)).toBe(true);
    });
  });
});
