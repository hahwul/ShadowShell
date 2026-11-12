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
      (name: string, ev: { terminalId: string; code: number }) => void
    >(),
  },
  console: { log: () => {} },
};
init(sdk as unknown as Parameters<typeof init>[0]);

async function exitCodeOf(command: string): Promise<number> {
  const id = handlers.get("createTerminal")!(sdk, homedir(), command, "");
  const exitEvent = () =>
    sdk.api.send.mock.calls.find(
      ([name, ev]) => name === "terminalExit" && ev.terminalId === id,
    );
  await vi.waitFor(() => expect(exitEvent()).toBeDefined(), {
    timeout: 10000,
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
