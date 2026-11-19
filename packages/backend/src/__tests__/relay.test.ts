import { execFileSync } from "child_process";
import { rmSync, writeFileSync } from "fs";
import type * as OsModule from "os";
import { homedir, userInfo } from "os";
import { join } from "path";

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

// The relay starts the user's $SHELL; pin it so these tests always run sh.
process.env.SHELL = "/bin/sh";

const python = findPython3(null, "/nonexistent/settings.json");
const hasPython = pathExists(python);

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

async function run(
  command: string,
  timeout = 10000,
): Promise<{ code: number; output: string }> {
  const id = handlers.get("createTerminal")!(sdk, homedir(), command, "");
  const events = (wanted: string) =>
    sdk.api.send.mock.calls.filter(
      ([name, ev]) => name === wanted && ev.terminalId === id,
    );
  await vi.waitFor(() => expect(events("terminalExit")).toHaveLength(1), {
    timeout,
    interval: 50,
  });
  return {
    code: events("terminalExit")[0]![1].code,
    output: events("terminalOutput")
      .map(([, ev]) => ev.data)
      .join(""),
  };
}

async function exitCodeOf(command: string, timeout?: number): Promise<number> {
  return (await run(command, timeout)).code;
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

describe.skipIf(!hasPython)("relay shell choice", () => {
  it.skipIf(!pathExists("/bin/bash"))(
    "runs the user's $SHELL rather than the first shell the backend found",
    async () => {
      process.env.SHELL = "/bin/bash";
      try {
        // The echoed command line still reads "$0"; only its output names it.
        expect((await run('echo "ran=$0"; exit')).output).toContain(
          "ran=/bin/bash",
        );
      } finally {
        process.env.SHELL = "/bin/sh";
      }
    },
    15000,
  );

  it("only takes a $SHELL that is an absolute path to an executable real shell", () => {
    // Writes the relay script; the terminal itself is not needed.
    handlers.get("destroyTerminal")!(
      sdk,
      handlers.get("createTerminal")!(sdk, homedir(), "", ""),
    );
    const script = join(homedir(), ".config", "shadowshell", "relay.py");
    const pick = (shell?: string) => {
      const env = { ...process.env };
      if (shell === undefined) delete env.SHELL;
      else env.SHELL = shell;
      return execFileSync(
        python,
        [
          "-c",
          "import runpy, sys; print(runpy.run_path(sys.argv[1])['pick_shell'](sys.argv[2]))",
          script,
          "/fallback",
        ],
        { env, cwd: homedir() },
      )
        .toString()
        .trim();
    };
    const file = (name: string, mode: number) => {
      const path = join(homedir(), name);
      writeFileSync(path, "", { mode });
      return path;
    };

    expect(pick(file("myshell", 0o755))).toBe(join(homedir(), "myshell"));

    // Without $SHELL: the account's login shell (a usable one on dev and CI
    // machines), not what the backend passed.
    const withoutShell = pick();
    expect(withoutShell).toBe(userInfo().shell);
    for (const unusable of [
      "myshell", // relative: exists here, but depends on the cwd
      join(homedir(), "missing"),
      homedir(), // a directory
      file("data", 0o644),
      file("nologin", 0o755),
      file("false", 0o755),
      file("tcsh", 0o755), // rejects the "-i -l" the relay passes
    ]) {
      expect(pick(unusable), unusable).toBe(withoutShell);
    }
  });
});

describe("relay start failure", () => {
  it("reports what an interpreter that cannot run the relay printed", async () => {
    // Stands in for the macOS /usr/bin/python3 stub without developer tools.
    const fake = join(homedir(), "python3");
    writeFileSync(fake, "#!/bin/sh\necho 'no developer tools' >&2\nexit 1\n", {
      mode: 0o755,
    });
    handlers.get("setPythonPath")!(sdk, fake);
    try {
      const id = handlers.get("createTerminal")!(sdk, homedir(), "", "");
      await vi.waitFor(
        () =>
          expect(sdk.api.send).toHaveBeenCalledWith("terminalExit", {
            terminalId: id,
            code: 1,
            error: `${fake}: no developer tools`,
          }),
        { timeout: 10000, interval: 50 },
      );
    } finally {
      handlers.get("setPythonPath")!(sdk, "");
    }
  }, 15000);
});

describe.skipIf(!hasPython)("relay final drain", () => {
  it("delivers the rest of the output when the backend is busy as the shell exits", async () => {
    // Less than the relay's buffer cap, so the shell is long gone and all of
    // this sits in the relay while the backend is not reading.
    const total = 4 * 1024 * 1024;
    let received = 0;
    let stalled = false;
    sdk.api.send.mockImplementation((name, ev) => {
      if (name !== "terminalOutput") return;
      received += ev.data.length;
      if (stalled || received < 64 * 1024) return;
      stalled = true;
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
