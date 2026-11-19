/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- Module mocks (hoisted before imports) ---

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("../styles/style.css", () => ({}));

// Every xterm instance the module creates, newest last.
const xterms = vi.hoisted(() => [] as Array<{ type(data: string): void; writeln: ReturnType<typeof vi.fn> }>);

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    constructor() { xterms.push(this as any); }
    private dataHandler: (data: string) => void = () => {};
    type(data: string) { this.dataHandler(data); }
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
    focus() { this.textarea.focus(); }
    blur() { this.textarea.blur(); }
    loadAddon() {}
    onData(handler: (data: string) => void) { this.dataHandler = handler; }
    write() {}
    writeln = vi.fn();
    clear() {}
    dispose() {}
  },
}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-search", () => ({
  SearchAddon: class { findNext() {} findPrevious() {} },
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
    vi.stubGlobal("ResizeObserver", class { observe() {} });

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
      expect($(".ss-dropup").classList.contains("ss-dropup--visible")).toBe(false);
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
      sdk.backend.validateDirectory.mockReturnValue(new Promise((r) => { resolve = r; }));
      openNewPresetEditor();
      $("[data-action=save]").click();
      $("[data-action=save]").click();
      resolve(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(savedPresets()).toHaveLength(1);
    });

    it("should not save if cancelled while the directory is validated", async () => {
      let resolve!: (valid: boolean) => void;
      sdk.backend.validateDirectory.mockReturnValue(new Promise((r) => { resolve = r; }));
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
    const owned = () => JSON.parse(sessionStorage.getItem("shadowshell.terminals") ?? "[]");

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
      expect(sdk.backend.writeTerminal.mock.calls).toEqual([["term-1", "a"], ["term-1", "bc"]]);
    });

    it("should stop the shells left over from this window's previous load", async () => {
      await run("shadowshell.new-tab");
      await run("shadowshell.new-tab");
      expect(owned()).toEqual(["term-1", "term-2"]);
      emit("terminalExit", { terminalId: "term-2", code: 0 });
      expect(owned()).toEqual(["term-1"]);

      // Reload: the module state is gone, the backend and sessionStorage are not.
      vi.resetModules();
      const reloaded = createMockSdk();
      (await import("../index")).init(reloaded as any);

      expect(reloaded.backend.destroyTerminal.mock.calls).toEqual([["term-1"]]);
      expect(owned()).toEqual([]);
    });

    it("should report an exit that arrives before the terminal id is known", async () => {
      let reply!: (id: string) => void;
      sdk.backend.createTerminal.mockReturnValue(new Promise((r) => { reply = r; }));
      const opening = run("shadowshell.new-tab");
      await vi.advanceTimersByTimeAsync(0);

      // e.g. python3 is missing: the relay dies before createTerminal returns
      emit("terminalExit", { terminalId: "term-9", code: -1 });
      reply("term-9");
      await opening;

      expect(xterms.at(-1)!.writeln).toHaveBeenCalledWith(expect.stringContaining("exited with code -1"));
      xterms.at(-1)!.type("x");
      expect(sdk.backend.writeTerminal).not.toHaveBeenCalled();
      expect(owned()).toEqual([]);
    });
  });
});
