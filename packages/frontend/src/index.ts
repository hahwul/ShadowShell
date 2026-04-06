import type { Caido } from "@caido/sdk-frontend";
import type { API } from "shadowshell-backend";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { type Preset, getAllPresets } from "./presets";

import "@xterm/xterm/css/xterm.css";
import "./styles/style.css";

type CaidoSDK = Caido<API>;

const PAGE_PATH = "/shadowshell" as const;
const Commands = {
  newTab: "shadowshell.new-tab",
  closeTab: "shadowshell.close-tab",
  togglePanel: "shadowshell.toggle",
} as const;

const THEME = {
  background: "#1a1a2e",
  foreground: "#e0e0e0",
  cursor: "#e0e0e0",
  cursorAccent: "#1a1a2e",
  selectionBackground: "#3a3a5e",
  selectionForeground: "#ffffff",
  black: "#1a1a2e",
  red: "#ff6b6b",
  green: "#51cf66",
  yellow: "#ffd43b",
  blue: "#5c7cfa",
  magenta: "#cc5de8",
  cyan: "#22b8cf",
  white: "#e0e0e0",
  brightBlack: "#495057",
  brightRed: "#ff8787",
  brightGreen: "#69db7c",
  brightYellow: "#ffe066",
  brightBlue: "#748ffc",
  brightMagenta: "#da77f2",
  brightCyan: "#3bc9db",
  brightWhite: "#f8f9fa",
};

// --- State ---

interface Tab {
  id: string;
  backendId: string | null;
  name: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  container: HTMLDivElement;
  presetId?: string;
}

const tabs: Tab[] = [];
let activeTabId: string | null = null;
let tabCounter = 0;
let sdkRef: CaidoSDK;

let tabBar: HTMLDivElement;
let terminalArea: HTMLDivElement;
let statusBar: HTMLDivElement;
let presetBar: HTMLDivElement;

// --- Tab Management ---

function generateTabId(): string {
  return `tab-${++tabCounter}`;
}

async function createTab(
  sdk: CaidoSDK,
  name?: string,
  preset?: Preset
): Promise<Tab> {
  const id = generateTabId();
  const tabName = name || preset?.name || `Shell ${tabCounter}`;

  // Hide existing tabs
  for (const t of tabs) {
    t.container.style.display = "none";
  }

  // Create visible container
  const container = document.createElement("div");
  container.className = "ss-terminal-container";
  container.id = `ss-term-${id}`;
  terminalArea.appendChild(container);

  const terminal = new Terminal({
    fontSize: 13,
    fontFamily:
      "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
    theme: THEME,
    cursorBlink: true,
    cursorStyle: "bar",
    scrollback: 5000,
    allowTransparency: true,
  });

  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);

  container.addEventListener("mousedown", () => terminal.focus());

  try {
    fitAddon.fit();
  } catch {
    // ignore
  }

  // Create backend terminal (returns terminal ID string)
  let backendId: string | null = null;
  try {
    backendId = await sdk.backend.createTerminal(
      "",
      preset?.command || "",
      preset?.name || ""
    );
  } catch (err) {
    terminal.writeln(
      `\x1b[31m[ShadowShell] Failed to create terminal: ${err}\x1b[0m`
    );
  }

  const tab: Tab = {
    id,
    backendId,
    name: tabName,
    terminal,
    fitAddon,
    container,
    presetId: preset?.id,
  };

  // Wire keyboard input -> backend RPC
  terminal.onData((data) => {
    if (tab.backendId) {
      sdk.backend.writeTerminal(tab.backendId, data);
    }
  });

  tabs.push(tab);
  activeTabId = id;
  renderTabBar(sdk);
  updateStatusBar(sdk);

  setTimeout(() => {
    try {
      fitAddon.fit();
      terminal.focus();
      if (tab.backendId) {
        sdk.backend.resizeTerminal(
          tab.backendId,
          terminal.cols,
          terminal.rows
        );
      }
    } catch {
      // ignore
    }
  }, 200);

  return tab;
}

function switchToTab(sdk: CaidoSDK, tabId: string): void {
  const target = tabs.find((t) => t.id === tabId);
  if (!target) return;

  for (const tab of tabs) {
    tab.container.style.display = "none";
  }

  target.container.style.display = "block";
  activeTabId = tabId;

  renderTabBar(sdk);
  updateStatusBar(sdk);

  requestAnimationFrame(() => {
    try {
      target.fitAddon.fit();
    } catch {
      // ignore
    }
    target.terminal.focus();
    if (target.backendId) {
      sdk.backend.resizeTerminal(
        target.backendId,
        target.terminal.cols,
        target.terminal.rows
      );
    }
  });
}

async function closeTab(sdk: CaidoSDK, tabId: string): Promise<void> {
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;

  const tab = tabs[idx]!;

  if (tab.backendId) {
    try {
      await sdk.backend.destroyTerminal(tab.backendId);
    } catch {
      // ignore
    }
  }

  tab.terminal.dispose();
  tab.container.remove();
  tabs.splice(idx, 1);

  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      const newIdx = Math.min(idx, tabs.length - 1);
      switchToTab(sdk, tabs[newIdx]!.id);
    } else {
      activeTabId = null;
      updateStatusBar(sdk);
    }
  }

  renderTabBar(sdk);
}

// --- UI ---

function renderTabBar(sdk: CaidoSDK): void {
  const existingTabs = tabBar.querySelectorAll(".ss-tab");
  existingTabs.forEach((el) => el.remove());

  const addBtn = tabBar.querySelector(".ss-tab-add")!;

  for (const tab of tabs) {
    const tabEl = document.createElement("div");
    tabEl.className = `ss-tab ${tab.id === activeTabId ? "ss-tab--active" : ""}`;

    const preset = tab.presetId
      ? getAllPresets().find((p) => p.id === tab.presetId)
      : null;

    const icon =
      preset?.icon ||
      `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3l3 2-3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    tabEl.innerHTML = `
      <span class="ss-tab__icon">${icon}</span>
      <span class="ss-tab__name">${escapeHtml(tab.name)}</span>
      <button class="ss-tab__close" title="Close tab"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
    `;

    tabEl.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).closest(".ss-tab__close")) {
        switchToTab(sdk, tab.id);
      }
    });

    tabEl.querySelector(".ss-tab__close")!.addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(sdk, tab.id);
    });

    const nameEl = tabEl.querySelector(".ss-tab__name")!;
    nameEl.addEventListener("dblclick", () => {
      const input = document.createElement("input");
      input.className = "ss-tab__rename-input";
      input.value = tab.name;
      input.addEventListener("blur", () => {
        tab.name = input.value || tab.name;
        renderTabBar(sdk);
      });
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") input.blur();
        if (ev.key === "Escape") {
          input.value = tab.name;
          input.blur();
        }
      });
      nameEl.replaceWith(input);
      input.focus();
      input.select();
    });

    tabBar.insertBefore(tabEl, addBtn);
  }
}

function updateStatusBar(sdk: CaidoSDK): void {
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) {
    statusBar.innerHTML = `<span class="ss-status__text">No active terminal</span>`;
    return;
  }

  const preset = tab.presetId
    ? getAllPresets().find((p) => p.id === tab.presetId)
    : null;

  statusBar.innerHTML = `
    <span class="ss-status__item">
      <span class="ss-status__label">Terminal:</span>
      <span class="ss-status__value">${escapeHtml(tab.name)}</span>
    </span>
    ${
      preset
        ? `<span class="ss-status__item">
            <span class="ss-status__label">Preset:</span>
            <span class="ss-status__value" style="color:${preset.color}">${escapeHtml(preset.name)}</span>
          </span>`
        : ""
    }
    <span class="ss-status__item">
      <span class="ss-status__label">Tabs:</span>
      <span class="ss-status__value">${tabs.length}</span>
    </span>
  `;
}

function renderPresetBar(sdk: CaidoSDK): void {
  presetBar.innerHTML = "";
  for (const preset of getAllPresets()) {
    const btn = document.createElement("button");
    btn.className = "ss-preset-btn";
    btn.title = preset.description;
    btn.innerHTML = `<span class="ss-preset-btn__icon">${preset.icon}</span><span class="ss-preset-btn__name">${escapeHtml(preset.name)}</span>`;
    btn.style.setProperty("--preset-color", preset.color);
    btn.addEventListener("click", () => createTab(sdk, undefined, preset));
    presetBar.appendChild(btn);
  }
}

function buildUI(sdk: CaidoSDK): HTMLDivElement {
  const root = document.createElement("div");
  root.className = "ss-root";

  const header = document.createElement("div");
  header.className = "ss-header";

  const logo = document.createElement("div");
  logo.className = "ss-logo";
  logo.innerHTML = `<span class="ss-logo__icon"><svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="3" width="14" height="11" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M4 8l2.5 2L4 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><line x1="8" y1="12" x2="12" y2="12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></span><span class="ss-logo__text">ShadowShell</span>`;

  presetBar = document.createElement("div");
  presetBar.className = "ss-preset-bar";

  header.appendChild(logo);
  header.appendChild(presetBar);

  tabBar = document.createElement("div");
  tabBar.className = "ss-tab-bar";

  const addTabBtn = document.createElement("button");
  addTabBtn.className = "ss-tab-add";
  addTabBtn.title = "New terminal tab";
  addTabBtn.textContent = "+";
  addTabBtn.addEventListener("click", () => createTab(sdk));
  tabBar.appendChild(addTabBtn);

  terminalArea = document.createElement("div");
  terminalArea.className = "ss-terminal-area";

  statusBar = document.createElement("div");
  statusBar.className = "ss-status-bar";

  root.appendChild(header);
  root.appendChild(tabBar);
  root.appendChild(terminalArea);
  root.appendChild(statusBar);

  return root;
}

// --- Events ---

function setupEvents(sdk: CaidoSDK): void {
  sdk.backend.onEvent("terminalOutput", (event) => {
    const tab = tabs.find((t) => t.backendId === event.terminalId);
    if (tab) {
      tab.terminal.write(event.data);
    }
  });

  sdk.backend.onEvent("terminalExit", (event) => {
    const tab = tabs.find((t) => t.backendId === event.terminalId);
    if (tab) {
      tab.terminal.writeln(
        `\r\n\x1b[90m[Process exited with code ${event.code}]\x1b[0m`
      );
      tab.backendId = null;
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    try {
      tab.fitAddon.fit();
      if (tab.backendId) {
        sdk.backend.resizeTerminal(
          tab.backendId,
          tab.terminal.cols,
          tab.terminal.rows
        );
      }
    } catch {
      // ignore
    }
  });

  if (terminalArea) {
    resizeObserver.observe(terminalArea);
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// --- Init ---

export const init = (sdk: CaidoSDK) => {
  sdkRef = sdk;
  const body = buildUI(sdk);
  renderPresetBar(sdk);

  sdk.navigation.addPage(PAGE_PATH, { body });
  sdk.sidebar.registerItem("ShadowShell", PAGE_PATH, {
    icon: "fas fa-terminal",
  });

  sdk.commands.register(Commands.newTab, {
    name: "ShadowShell: New Terminal Tab",
    run: () => createTab(sdk),
  });
  sdk.commands.register(Commands.closeTab, {
    name: "ShadowShell: Close Current Tab",
    run: () => {
      if (activeTabId) closeTab(sdk, activeTabId);
    },
  });
  sdk.commands.register(Commands.togglePanel, {
    name: "ShadowShell: Toggle Panel",
    run: () => sdk.navigation.goTo(PAGE_PATH),
  });

  sdk.commandPalette.register(Commands.newTab);
  sdk.commandPalette.register(Commands.closeTab);
  sdk.commandPalette.register(Commands.togglePanel);

  setupEvents(sdk);

  setTimeout(() => createTab(sdk), 300);
};
