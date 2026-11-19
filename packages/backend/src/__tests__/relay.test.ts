import { rmSync } from "fs";
import type * as OsModule from "os";
import { homedir } from "os";

import { afterAll, describe, expect, it, vi } from "vitest";

import { init } from "../index";
import type * as UtilsModule from "../utils";
import { findPython3, pathExists } from "../utils";

// End-to-end: runs the real embedded Python relay and a real /bin/sh.

vi.mock("caido:plugin", () => ({}));

// Keep the relay script and its log out of the real ~/.config.
vi.mock("os", async (importOriginal) => {
  const actual = await importOriginal<typeof OsModule>();
  const { mkdtempSync } = await import("fs");
  const { join } = await import("path");
  const home = mkdtempSync(join(actual.tmpdir(), "ss-relay-test-"));
  return { ...actual, homedir: () => home };
});

vi.mock("../utils", async (importOriginal) => {
  const actual = await importOriginal<typeof UtilsModule>();
  return { ...actual, getDefaultShell: () => "/bin/sh" };
});

const hasPython = pathExists(findPython3(null, "/nonexistent/settings.json"));

type Handler = (...args: unknown[]) => unknown;
const handlers = new Map<string, Handler>();
const sdk = {
  api: {
    register: (name: string, fn: Handler) => handlers.set(name, fn),
    send: vi.fn<
      (
        name: string,
        ev: { terminalId: string; code: number; data: string },
      ) => void
    >(),
  },
  console: { log: () => {} },
};
init(sdk as unknown as Parameters<typeof init>[0]);

async function exitCodeOf(command: string, timeout = 10000): Promise<number> {
  const id = handlers.get("createTerminal")!(sdk, homedir(), command, "");
  const exitEvent = () =>
    sdk.api.send.mock.calls.find(
      ([name, ev]) => name === "terminalExit" && ev.terminalId === id,
    );
  await vi.waitFor(() => expect(exitEvent()).toBeDefined(), {
    timeout,
    interval: 50,
  });
  return exitEvent()![1].code;
}

afterAll(() => {
  handlers.get("destroyAllTerminals")!(sdk);
  rmSync(homedir(), { recursive: true, force: true });
});

describe.skipIf(!hasPython)("relay exit status", () => {
  it("reports the shell's exit code instead of the relay's", async () => {
    expect(await exitCodeOf("exit 3")).toBe(3);
  }, 15000);

  it("reports a shell killed by a signal as 128+signal", async () => {
    expect(await exitCodeOf("kill -9 $$")).toBe(137);
  }, 15000);
});

describe.skipIf(!hasPython)("relay flow control", () => {
  it("keeps the shell alive when output outpaces a stalled client", async () => {
    const total = 16 * 1024 * 1024;
    let received = 0;
    let stalled = false;
    sdk.api.send.mockImplementation((name, ev) => {
      if (name !== "terminalOutput") return;
      received += ev.data.length;
      if (stalled || received < 1024 * 1024) return;
      stalled = true;
      // Block the event loop so the backend stops reading the relay socket
      // while the command keeps writing.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000);
    });
    try {
      const code = await exitCodeOf(
        `head -c ${total} /dev/zero | tr '\\0' x; exit 3`,
        30000,
      );
      expect(code).toBe(3);
      await vi.waitFor(() => expect(received).toBeGreaterThanOrEqual(total));
    } finally {
      sdk.api.send.mockReset();
    }
  }, 40000);
});
