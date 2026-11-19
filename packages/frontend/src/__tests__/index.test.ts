/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted before imports) ---

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("../styles/style.css", () => ({}));

// Every xterm instance the module creates, newest last.
const xterms = vi.hoisted(
  () =>
    [] as Array<{
      type(data: string): void;
      writeln: ReturnType<typeof vi.fn>;
    }>,
);

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    constructor() {
      xterms.push(this as any);
    }
    private dataHandler: (data: string) => void = () => {};
    type(data: string) {
      this.dataHandler(data);
    }
    options: Record<string, unknown> = {};
    cols = 80;
    rows = 24;
    element: HTMLElement | undefined;
    textarea = document.createElement("textarea");
    open(parent: HTMLElement) {
      this.element = document.createElement("div");
      this.element.appendChild(this.textarea);
      parent.appendChild(this.element);
    }
    focus() {
      this.textarea.focus();
    }
    blur() {
      this.textarea.blur();
    }
    loadAddon() {}
    onData(handler: (data: string) => void) {
      this.dataHandler = handler;
    }
    write() {}
    writeln = vi.fn();
    clear() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class {
    findNext() {}
    findPrevious() {}
  },
}));

// --- Helpers ---

function createMockSdk() {
  let terminalCounter = 0;
  return {
    backend: {
      createTerminal: vi.fn(async () => `term-${++terminalCounter}`),
      writeTerminal: vi.fn(async () => true),
      resizeTerminal: vi.fn(async () => true),
      destroyTerminal: vi.fn(async () => true),
      getDefaultDirectory: vi.fn(async () => ""),
      validateDirectory: vi.fn(async (_path: string) => true),
      onEvent: vi.fn(),
    },
    navigation: { addPage: vi.fn(), goTo: vi.fn() },
    sidebar: { registerItem: vi.fn() },
    commands: { register: vi.fn() },
    commandPalette: { register: vi.fn() },
    shortcuts: { register: vi.fn() },
  };
}

// --- Tests ---

describe("Frontend UI", () => {
  const resizeObservers: Array<() => void> = [];
  let sdk: ReturnType<typeof createMockSdk>;
  let page: HTMLElement;

  const run = (command: string) =>
    sdk.commands.register.mock.calls.find(([id]) => id === command)![1].run();
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
    document.querySelector(selector) as T;

  const emit = (name: string, event: unknown) =>
    sdk.backend.onEvent.mock.calls
      .filter(([n]) => n === name)
      .forEach(([, handler]) => handler(event));

  beforeEach(async () => {
    xterms.length = 0;
    sessionStorage.clear();
    vi.useFakeTimers();
    vi.resetModules(); // index.ts keeps tabs and the quick terminal in module state
    document.body.innerHTML = "";
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    resizeObservers.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(notify: () => void) {
          resizeObservers.push(notify);
        }
        observe() {}
      },
    );

    sdk = createMockSdk();
    (await import("../index")).init(sdk as any);
    page = sdk.navigation.addPage.mock.calls[0]![1].body;
    document.body.appendChild(page);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  describe("quick terminal", () => {
    const hasFocus = () => $(".ss-dropup").contains(document.activeElement);

    it("should release keyboard focus when hidden", () => {
      run("shadowshell.toggle-dropup");
      vi.advanceTimersByTime(200);
      expect(hasFocus()).toBe(true);

      run("shadowshell.toggle-dropup");
      expect($(".ss-dropup").classList.contains("ss-dropup--visible")).toBe(
        false,
      );
      expect(hasFocus()).toBe(false);
    });

    it("should not take focus if hidden again before it finished opening", () => {
      run("shadowshell.toggle-dropup");
      run("shadowshell.toggle-dropup");
      vi.advanceTimersByTime(200);
      expect(hasFocus()).toBe(false);
    });
  });

  describe("preset editor", () => {
    function openNewPresetEditor() {
      $(".ss-preset-btn--add").click();
      $<HTMLInputElement>("[data-field=name]").value = "Mine";
      $<HTMLInputElement>("[data-field=defaultDirectory]").value = "/work";
    }
    const savedPresets = () =>
      JSON.parse(localStorage.getItem("shadowshell-custom-presets") ?? "[]");

    it("should save once when Save is clicked again while the directory is validated", async () => {
      let resolve!: (valid: boolean) => void;
      sdk.backend.validateDirectory.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      openNewPresetEditor();
      $("[data-action=save]").click();
      $("[data-action=save]").click();
      resolve(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(savedPresets()).toHaveLength(1);
    });

    it("should not save if cancelled while the directory is validated", async () => {
      let resolve!: (valid: boolean) => void;
      sdk.backend.validateDirectory.mockReturnValue(
        new Promise((r) => {
          resolve = r;
        }),
      );
      openNewPresetEditor();
      $("[data-action=save]").click();
      $("[data-action=cancel]").click();
      resolve(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(savedPresets()).toHaveLength(0);
    });
  });

  describe("tabs", () => {
    it("should restore a tab's active pane when switching back to it", async () => {
      await run("shadowshell.new-tab");
      await run("shadowshell.split-vertical");
      const panes = page.querySelectorAll(".ss-terminal-container .ss-pane");
      expect(panes).toHaveLength(2);
      expect(panes[1]!.classList.contains("ss-pane--active")).toBe(true);

      await run("shadowshell.new-tab");
      page.querySelector<HTMLElement>(".ss-tab")!.click();

      expect(panes[1]!.classList.contains("ss-pane--active")).toBe(true);
      expect(panes[0]!.classList.contains("ss-pane--active")).toBe(false);
    });
  });

  describe("terminal sessions", () => {
    const owned = () =>
      JSON.parse(sessionStorage.getItem("shadowshell.terminals") ?? "[]");

    it("should send input in order, one backend call at a time", async () => {
      await run("shadowshell.new-tab");
      const done: Array<() => void> = [];
      sdk.backend.writeTerminal.mockImplementation(
        () => new Promise<boolean>((resolve) => done.push(() => resolve(true))),
      );

      const term = xterms.at(-1)!;
      term.type("a");
      term.type("b");
      term.type("c");
      // Parallel calls could reach the shell as "bac"; only "a" is out so far.
      expect(sdk.backend.writeTerminal.mock.calls).toEqual([["term-1", "a"]]);

      done[0]!();
      await vi.advanceTimersByTimeAsync(0);
      expect(sdk.backend.writeTerminal.mock.calls).toEqual([
        ["term-1", "a"],
        ["term-1", "bc"],
      ]);
    });

    it("should stop this window's shells on unload, and finish the job after a reload", async () => {
      await run("shadowshell.new-tab");
      await run("shadowshell.new-tab");
      await run("shadowshell.new-tab");
      emit("terminalExit", { terminalId: "term-2", code: 0 });
      await run("shadowshell.close-tab"); // the active one: term-3
      sdk.backend.destroyTerminal.mockClear();

      window.dispatchEvent(new Event("pagehide"));
      expect(sdk.backend.destroyTerminal.mock.calls).toEqual([["term-1"]]);

      // Reload: module state is gone; the backend and sessionStorage are not,
      // and the request made while unloading may never have left.
      vi.resetModules();
      const reloaded = createMockSdk();
      (await import("../index")).init(reloaded as any);

      expect(reloaded.backend.destroyTerminal.mock.calls).toEqual([["term-1"]]);
      expect(owned()).toEqual([]);
    });

    it("should not touch another live tab's shells when the browser tab is duplicated", async () => {
      await run("shadowshell.new-tab");

      // A duplicate copies sessionStorage while this page is still alive.
      vi.resetModules();
      const duplicate = createMockSdk();
      (await import("../index")).init(duplicate as any);

      expect(duplicate.backend.destroyTerminal).not.toHaveBeenCalled();
    });

    it("should keep sending input after a call fails or never settles", async () => {
      await run("shadowshell.new-tab");
      sdk.backend.writeTerminal
        .mockRejectedValueOnce(new Error("backend reloading"))
        .mockReturnValueOnce(new Promise(() => {}));

      const term = xterms.at(-1)!;
      term.type("a");
      await vi.advanceTimersByTimeAsync(0);
      term.type("b"); // this call hangs
      term.type("c");
      await vi.advanceTimersByTimeAsync(10_000);

      expect(sdk.backend.writeTerminal.mock.calls).toEqual([
        ["term-1", "a"],
        ["term-1", "b"],
        ["term-1", "c"],
      ]);
    });

    it("should send what was typed while the quick terminal was starting, in one ordered call", async () => {
      let reply!: (id: string) => void;
      sdk.backend.createTerminal.mockReturnValue(
        new Promise((r) => {
          reply = r;
        }),
      );
      run("shadowshell.toggle-dropup");
      await vi.advanceTimersByTimeAsync(0);

      const term = xterms.at(-1)!;
      term.type("l");
      term.type("s");
      reply("term-7");
      await vi.advanceTimersByTimeAsync(0);

      expect(sdk.backend.writeTerminal.mock.calls).toEqual([["term-7", "ls"]]);
    });

    it("should send resizes one at a time and finish on the latest size", async () => {
      vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(
        800,
      );
      vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(
        600,
      );
      await run("shadowshell.new-tab");
      await vi.advanceTimersByTimeAsync(100);
      sdk.backend.resizeTerminal.mockClear();
      const done: Array<() => void> = [];
      sdk.backend.resizeTerminal.mockImplementation(
        () => new Promise<boolean>((resolve) => done.push(() => resolve(true))),
      );

      const term = xterms.at(-1)! as any;
      for (const cols of [100, 110, 120]) {
        term.cols = cols;
        resizeObservers.forEach((notify) => notify());
      }
      // 110 overtaking 120 would leave the PTY at the wrong width for good.
      expect(sdk.backend.resizeTerminal.mock.calls).toEqual([
        ["term-1", 100, 24],
      ]);

      done[0]!();
      await vi.advanceTimersByTimeAsync(0);
      expect(sdk.backend.resizeTerminal.mock.calls).toEqual([
        ["term-1", 100, 24],
        ["term-1", 120, 24],
      ]);
      vi.restoreAllMocks();
    });

    it("should report an exit that arrives before the terminal id is known", async () => {
      let reply!: (id: string) => void;
      sdk.backend.createTerminal.mockReturnValue(
        new Promise((r) => {
          reply = r;
        }),
      );
      const opening = run("shadowshell.new-tab");
      await vi.advanceTimersByTimeAsync(0);

      // e.g. python3 is missing: the relay dies before createTerminal returns
      emit("terminalExit", { terminalId: "term-9", code: -1 });
      reply("term-9");
      await opening;

      expect(xterms.at(-1)!.writeln).toHaveBeenCalledWith(
        expect.stringContaining("exited with code -1"),
      );
      xterms.at(-1)!.type("x");
      expect(sdk.backend.writeTerminal).not.toHaveBeenCalled();
      // Not ours to stop on unload either: it is already gone.
      window.dispatchEvent(new Event("pagehide"));
      expect(sdk.backend.destroyTerminal).not.toHaveBeenCalled();
    });
  });
});
