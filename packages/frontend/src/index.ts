import type { Caido } from "@caido/sdk-frontend";
import type { API } from "backend";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import {
  type Preset,
  getAllPresets,
  updatePreset,
  resetPreset,
  addCustomPreset,
  deleteCustomPreset,
  ICONS,
} from "./presets";

import "@xterm/xterm/css/xterm.css";
import "./styles/style.css";

type CaidoSDK = Caido<API>;

const PAGE_PATH = "/shadowshell" as const;
const Commands = {
  newTab: "shadowshell.new-tab",
  closeTab: "shadowshell.close-tab",
  togglePanel: "shadowshell.toggle",
  splitVertical: "shadowshell.split-vertical",
  splitHorizontal: "shadowshell.split-horizontal",
  closePane: "shadowshell.close-pane",
  search: "shadowshell.search",
} as const;

const DARK_THEME = {
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

const LIGHT_THEME = {
  background: "#fafafa",
  foreground: "#1a1a2e",
  cursor: "#1a1a2e",
  cursorAccent: "#fafafa",
  selectionBackground: "#c8d6fa",
  selectionForeground: "#1a1a2e",
  black: "#1a1a2e",
  red: "#e03131",
  green: "#2f9e44",
  yellow: "#e67700",
  blue: "#3b5bdb",
  magenta: "#ae3ec9",
  cyan: "#0c8599",
  white: "#f8f9fa",
  brightBlack: "#868e96",
  brightRed: "#ff6b6b",
  brightGreen: "#51cf66",
  brightYellow: "#ffd43b",
  brightBlue: "#5c7cfa",
  brightMagenta: "#cc5de8",
  brightCyan: "#22b8cf",
  brightWhite: "#ffffff",
};

function isDarkMode(): boolean {
  return document.documentElement.getAttribute("data-mode") === "dark";
}

function getTheme() {
  return isDarkMode() ? DARK_THEME : LIGHT_THEME;
}

let fontSize = 13;

// --- Pane Tree ---

interface Pane {
  id: string;
  backendId: string | null;
  terminal: Terminal;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  element: HTMLDivElement; // wrapper with border
}

interface LeafNode {
  type: "leaf";
  pane: Pane;
}

interface SplitNode {
  type: "split";
  direction: "horizontal" | "vertical"; // horizontal = side-by-side, vertical = top-bottom
  ratio: number;
  first: PaneNode;
  second: PaneNode;
  element: HTMLDivElement;
}

type PaneNode = LeafNode | SplitNode;

interface Tab {
  id: string;
  name: string;
  root: PaneNode;
  container: HTMLDivElement;
  presetId?: string;
}

// --- State ---

const tabs: Tab[] = [];
let activeTabId: string | null = null;
let activePaneId: string | null = null;
let tabCounter = 0;
let paneCounter = 0;
let sdkRef: CaidoSDK;

let tabBar: HTMLDivElement;
let terminalArea: HTMLDivElement;
let statusBar: HTMLDivElement;
let presetBar: HTMLDivElement;
let toolbar: HTMLDivElement;
let searchBar: HTMLDivElement;

// --- Pane Helpers ---

function generatePaneId(): string {
  return `pane-${++paneCounter}`;
}

async function createPane(sdk: CaidoSDK, command?: string, presetName?: string): Promise<Pane> {
  const id = generatePaneId();

  const element = document.createElement("div");
  element.className = "ss-pane";
  element.dataset.paneId = id;

  const terminal = new Terminal({
    fontSize,
    fontFamily:
      "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, Monaco, 'Courier New', monospace",
    theme: getTheme(),
    cursorBlink: true,
    cursorStyle: "bar",
    scrollback: 5000,
    allowTransparency: true,
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  terminal.loadAddon(fitAddon);
  terminal.loadAddon(searchAddon);
  terminal.open(element);

  element.addEventListener("mousedown", () => {
    setActivePane(id);
    terminal.focus();
  });

  let backendId: string | null = null;
  try {
    backendId = await sdk.backend.createTerminal(
      "",
      command || "",
      presetName || ""
    );
  } catch (err) {
    terminal.writeln(`\x1b[31m[ShadowShell] Failed to create terminal: ${err}\x1b[0m`);
  }

  const pane: Pane = { id, backendId, terminal, fitAddon, searchAddon, element };

  terminal.onData((data) => {
    if (pane.backendId) {
      sdk.backend.writeTerminal(pane.backendId, data);
    }
  });

  return pane;
}

function setActivePane(paneId: string): void {
  activePaneId = paneId;
  // Update active pane border
  document.querySelectorAll(".ss-pane").forEach((el) => {
    el.classList.toggle("ss-pane--active", el.getAttribute("data-pane-id") === paneId);
  });
  updateStatusBar(sdkRef);
}

function getActivePane(): Pane | null {
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return null;
  return findPaneById(tab.root, activePaneId);
}

function findPaneById(node: PaneNode, id: string | null): Pane | null {
  if (!id) return null;
  if (node.type === "leaf") {
    return node.pane.id === id ? node.pane : null;
  }
  return findPaneById(node.first, id) || findPaneById(node.second, id);
}

function getAllPanes(node: PaneNode): Pane[] {
  if (node.type === "leaf") return [node.pane];
  return [...getAllPanes(node.first), ...getAllPanes(node.second)];
}

function fitAllPanes(node: PaneNode): void {
  for (const pane of getAllPanes(node)) {
    try {
      pane.fitAddon.fit();
      if (pane.backendId) {
        sdkRef.backend.resizeTerminal(pane.backendId, pane.terminal.cols, pane.terminal.rows);
      }
    } catch {
      // ignore
    }
  }
}

// --- Pane Tree Rendering ---

function renderPaneTree(node: PaneNode): HTMLElement {
  if (node.type === "leaf") {
    return node.pane.element;
  }

  const container = document.createElement("div");
  container.className = `ss-split ss-split--${node.direction}`;
  node.element = container;

  const firstEl = renderPaneTree(node.first);
  const secondEl = renderPaneTree(node.second);

  const divider = document.createElement("div");
  divider.className = `ss-divider ss-divider--${node.direction}`;

  const pct = node.ratio * 100;
  if (node.direction === "horizontal") {
    firstEl.style.width = `${pct}%`;
    secondEl.style.width = `${100 - pct}%`;
    firstEl.style.height = "100%";
    secondEl.style.height = "100%";
  } else {
    firstEl.style.height = `${pct}%`;
    secondEl.style.height = `${100 - pct}%`;
    firstEl.style.width = "100%";
    secondEl.style.width = "100%";
  }

  // Drag to resize
  divider.addEventListener("mousedown", (e) => {
    e.preventDefault();
    const rect = container.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      let ratio: number;
      if (node.direction === "horizontal") {
        ratio = (ev.clientX - rect.left) / rect.width;
      } else {
        ratio = (ev.clientY - rect.top) / rect.height;
      }
      node.ratio = Math.max(0.15, Math.min(0.85, ratio));
      const p = node.ratio * 100;
      if (node.direction === "horizontal") {
        firstEl.style.width = `${p}%`;
        secondEl.style.width = `${100 - p}%`;
      } else {
        firstEl.style.height = `${p}%`;
        secondEl.style.height = `${100 - p}%`;
      }
      fitAllPanes(node);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      fitAllPanes(node);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  });

  container.appendChild(firstEl);
  container.appendChild(divider);
  container.appendChild(secondEl);

  return container;
}

// --- Split Operations ---

async function splitPane(
  sdk: CaidoSDK,
  direction: "horizontal" | "vertical"
): Promise<void> {
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return;

  const newPane = await createPane(sdk);

  // Replace the active leaf with a split
  tab.root = replaceLeaf(tab.root, activePaneId, (leaf) => {
    const splitNode: SplitNode = {
      type: "split",
      direction,
      ratio: 0.5,
      first: leaf,
      second: { type: "leaf", pane: newPane },
      element: document.createElement("div"),
    };
    return splitNode;
  });

  // Re-render the tab
  tab.container.innerHTML = "";
  tab.container.appendChild(renderPaneTree(tab.root));

  setActivePane(newPane.id);

  setTimeout(() => {
    fitAllPanes(tab.root);
    newPane.terminal.focus();
    if (newPane.backendId) {
      sdk.backend.resizeTerminal(newPane.backendId, newPane.terminal.cols, newPane.terminal.rows);
    }
  }, 100);
}

function replaceLeaf(
  node: PaneNode,
  targetId: string | null,
  replacer: (leaf: LeafNode) => PaneNode
): PaneNode {
  if (node.type === "leaf") {
    if (node.pane.id === targetId) {
      return replacer(node);
    }
    return node;
  }
  return {
    ...node,
    first: replaceLeaf(node.first, targetId, replacer),
    second: replaceLeaf(node.second, targetId, replacer),
  };
}

async function closePane(sdk: CaidoSDK, paneId?: string): Promise<void> {
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return;

  const targetId = paneId || activePaneId;
  const pane = findPaneById(tab.root, targetId);
  if (!pane) return;

  // Destroy backend
  if (pane.backendId) {
    try {
      await sdk.backend.destroyTerminal(pane.backendId);
    } catch {
      // ignore
    }
  }
  pane.terminal.dispose();

  // If this is the only pane, close the tab
  if (tab.root.type === "leaf") {
    await closeTab(sdk, tab.id);
    return;
  }

  // Remove the pane from the tree, replacing its parent split with the sibling
  tab.root = removePaneFromTree(tab.root, targetId!);

  // Re-render
  tab.container.innerHTML = "";
  tab.container.appendChild(renderPaneTree(tab.root));

  // Set new active pane
  const remaining = getAllPanes(tab.root);
  if (remaining.length > 0) {
    setActivePane(remaining[0]!.id);
    setTimeout(() => {
      fitAllPanes(tab.root);
      remaining[0]!.terminal.focus();
    }, 50);
  }
}

function removePaneFromTree(node: PaneNode, targetId: string): PaneNode {
  if (node.type === "leaf") return node;

  // Check if either child is the target leaf
  if (node.first.type === "leaf" && node.first.pane.id === targetId) {
    return node.second;
  }
  if (node.second.type === "leaf" && node.second.pane.id === targetId) {
    return node.first;
  }

  return {
    ...node,
    first: removePaneFromTree(node.first, targetId),
    second: removePaneFromTree(node.second, targetId),
  };
}

// --- Tab Management ---

function generateTabId(): string {
  return `tab-${++tabCounter}`;
}

async function createTab(sdk: CaidoSDK, name?: string, preset?: Preset): Promise<Tab> {
  const id = generateTabId();
  const tabName = name || preset?.name || `Shell ${tabCounter}`;

  for (const t of tabs) {
    t.container.style.display = "none";
  }

  const container = document.createElement("div");
  container.className = "ss-terminal-container";
  container.id = `ss-term-${id}`;
  terminalArea.appendChild(container);

  const pane = await createPane(sdk, preset?.command, preset?.name);
  const root: LeafNode = { type: "leaf", pane };

  container.appendChild(renderPaneTree(root));

  const tab: Tab = { id, name: tabName, root, container, presetId: preset?.id };

  tabs.push(tab);
  activeTabId = id;
  setActivePane(pane.id);
  renderTabBar(sdk);
  updateStatusBar(sdk);

  setTimeout(() => {
    fitAllPanes(tab.root);
    pane.terminal.focus();
    if (pane.backendId) {
      sdk.backend.resizeTerminal(pane.backendId, pane.terminal.cols, pane.terminal.rows);
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

  const panes = getAllPanes(target.root);
  if (panes.length > 0 && !findPaneById(target.root, activePaneId)) {
    setActivePane(panes[0]!.id);
  }

  renderTabBar(sdk);
  updateStatusBar(sdk);

  requestAnimationFrame(() => {
    fitAllPanes(target.root);
    const active = getActivePane();
    active?.terminal.focus();
  });
}

async function closeTab(sdk: CaidoSDK, tabId: string): Promise<void> {
  const idx = tabs.findIndex((t) => t.id === tabId);
  if (idx === -1) return;

  const tab = tabs[idx]!;

  for (const pane of getAllPanes(tab.root)) {
    if (pane.backendId) {
      try { await sdk.backend.destroyTerminal(pane.backendId); } catch { /* */ }
    }
    pane.terminal.dispose();
  }

  tab.container.remove();
  tabs.splice(idx, 1);

  if (activeTabId === tabId) {
    if (tabs.length > 0) {
      switchToTab(sdk, tabs[Math.min(idx, tabs.length - 1)]!.id);
    } else {
      activeTabId = null;
      activePaneId = null;
      updateStatusBar(sdk);
    }
  }
  renderTabBar(sdk);
}

// --- Search ---

function toggleSearch(): void {
  const isVisible = searchBar.style.display !== "none";
  if (isVisible) {
    searchBar.style.display = "none";
    getActivePane()?.terminal.focus();
  } else {
    searchBar.style.display = "flex";
    const input = searchBar.querySelector("input") as HTMLInputElement;
    input.focus();
    input.select();
  }
}

function doSearch(direction: "next" | "prev"): void {
  const pane = getActivePane();
  if (!pane) return;
  const input = searchBar.querySelector("input") as HTMLInputElement;
  const term = input.value;
  if (!term) return;
  if (direction === "next") {
    pane.searchAddon.findNext(term);
  } else {
    pane.searchAddon.findPrevious(term);
  }
}

// --- Font Size ---

function changeFontSize(delta: number): void {
  fontSize = Math.max(8, Math.min(24, fontSize + delta));
  const tab = tabs.find((t) => t.id === activeTabId);
  if (!tab) return;
  for (const pane of getAllPanes(tab.root)) {
    pane.terminal.options.fontSize = fontSize;
    try {
      pane.fitAddon.fit();
      if (pane.backendId) {
        sdkRef.backend.resizeTerminal(pane.backendId, pane.terminal.cols, pane.terminal.rows);
      }
    } catch { /* */ }
  }
}

// --- UI ---

function renderTabBar(sdk: CaidoSDK): void {
  const existingTabs = tabBar.querySelectorAll(".ss-tab");
  existingTabs.forEach((el) => el.remove());
  const addBtn = tabBar.querySelector(".ss-tab-add")!;

  for (const tab of tabs) {
    const tabEl = document.createElement("div");
    tabEl.className = `ss-tab ${tab.id === activeTabId ? "ss-tab--active" : ""}`;

    const preset = tab.presetId ? getAllPresets().find((p) => p.id === tab.presetId) : null;
    const icon = preset?.icon || `<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 3l3 2-3 2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

    tabEl.innerHTML = `
      <span class="ss-tab__icon">${icon}</span>
      <span class="ss-tab__name">${escapeHtml(tab.name)}</span>
      <button class="ss-tab__close" title="Close tab"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
    `;

    tabEl.addEventListener("click", (e) => {
      if (!(e.target as HTMLElement).closest(".ss-tab__close")) switchToTab(sdk, tab.id);
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
      input.addEventListener("blur", () => { tab.name = input.value || tab.name; renderTabBar(sdk); });
      input.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") input.blur();
        if (ev.key === "Escape") { input.value = tab.name; input.blur(); }
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
  const paneCount = getAllPanes(tab.root).length;
  const preset = tab.presetId ? getAllPresets().find((p) => p.id === tab.presetId) : null;

  statusBar.innerHTML = `
    <span class="ss-status__item">
      <span class="ss-status__label">Tab:</span>
      <span class="ss-status__value">${escapeHtml(tab.name)}</span>
    </span>
    ${preset ? `<span class="ss-status__item"><span class="ss-status__label">Preset:</span><span class="ss-status__value" style="color:${preset.color}">${escapeHtml(preset.name)}</span></span>` : ""}
    <span class="ss-status__item">
      <span class="ss-status__label">Panes:</span>
      <span class="ss-status__value">${paneCount}</span>
    </span>
    <span class="ss-status__item">
      <span class="ss-status__label">Font:</span>
      <span class="ss-status__value">${fontSize}px</span>
    </span>
  `;
}

function renderPresetBar(sdk: CaidoSDK): void {
  presetBar.innerHTML = "";
  for (const preset of getAllPresets()) {
    const btn = document.createElement("button");
    btn.className = "ss-preset-btn";
    btn.title = `${preset.description}\nCommand: ${preset.command || "(default shell)"}\nRight-click to edit`;
    btn.innerHTML = `<span class="ss-preset-btn__icon">${preset.icon}</span><span class="ss-preset-btn__name">${escapeHtml(preset.name)}</span>`;
    btn.style.setProperty("--preset-color", preset.color);
    btn.addEventListener("click", () => createTab(sdk, undefined, preset));
    btn.addEventListener("contextmenu", (e) => { e.preventDefault(); showPresetEditor(sdk, preset); });
    presetBar.appendChild(btn);
  }
  const addBtn = document.createElement("button");
  addBtn.className = "ss-preset-btn ss-preset-btn--add";
  addBtn.title = "Add custom preset";
  addBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v8M2 6h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  addBtn.addEventListener("click", () => showPresetEditor(sdk, null));
  presetBar.appendChild(addBtn);
}

// SVG icons for toolbar
const TB = {
  splitH: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="10" rx="1" stroke="currentColor" stroke-width="1.2"/><line x1="7" y1="2" x2="7" y2="12" stroke="currentColor" stroke-width="1.2"/></svg>`,
  splitV: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="10" rx="1" stroke="currentColor" stroke-width="1.2"/><line x1="1" y1="7" x2="13" y2="7" stroke="currentColor" stroke-width="1.2"/></svg>`,
  search: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4" stroke="currentColor" stroke-width="1.2"/><path d="M9 9l3 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  clear: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 3l8 8M3 11l8-8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  closePane: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="10" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M5 5l4 4M9 5l-4 4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  fontUp: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 11L7 3l5 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><line x1="10" y1="1" x2="10" y2="5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="8" y1="3" x2="12" y2="3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
  fontDown: `<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 11L7 3l5 8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/><line x1="8" y1="3" x2="12" y2="3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`,
};

function buildToolbar(sdk: CaidoSDK): HTMLDivElement {
  const bar = document.createElement("div");
  bar.className = "ss-toolbar";

  const items: Array<{ icon: string; title: string; action: () => void; separator?: boolean }> = [
    { icon: TB.splitH, title: "Split horizontally (side by side)", action: () => splitPane(sdk, "horizontal") },
    { icon: TB.splitV, title: "Split vertically (top / bottom)", action: () => splitPane(sdk, "vertical") },
    { icon: TB.closePane, title: "Close active pane", action: () => closePane(sdk), separator: true },
    { icon: TB.search, title: "Search (Ctrl+Shift+F)", action: toggleSearch, separator: true },
    { icon: TB.fontUp, title: "Increase font size", action: () => changeFontSize(1) },
    { icon: TB.fontDown, title: "Decrease font size", action: () => changeFontSize(-1) },
    { icon: TB.clear, title: "Clear terminal", action: () => { getActivePane()?.terminal.clear(); }, separator: true },
  ];

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "ss-toolbar__sep";
      bar.appendChild(sep);
    }
    const btn = document.createElement("button");
    btn.className = "ss-toolbar__btn";
    btn.title = item.title;
    btn.innerHTML = item.icon;
    btn.addEventListener("click", item.action);
    bar.appendChild(btn);
  }

  return bar;
}

function buildSearchBar(): HTMLDivElement {
  const bar = document.createElement("div");
  bar.className = "ss-search-bar";
  bar.style.display = "none";

  const input = document.createElement("input");
  input.className = "ss-search-bar__input";
  input.placeholder = "Search...";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      doSearch(e.shiftKey ? "prev" : "next");
    }
    if (e.key === "Escape") {
      toggleSearch();
    }
  });

  const prevBtn = document.createElement("button");
  prevBtn.className = "ss-toolbar__btn";
  prevBtn.title = "Previous (Shift+Enter)";
  prevBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 8l4-4 4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  prevBtn.addEventListener("click", () => doSearch("prev"));

  const nextBtn = document.createElement("button");
  nextBtn.className = "ss-toolbar__btn";
  nextBtn.title = "Next (Enter)";
  nextBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 4l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  nextBtn.addEventListener("click", () => doSearch("next"));

  const closeBtn = document.createElement("button");
  closeBtn.className = "ss-toolbar__btn";
  closeBtn.title = "Close search";
  closeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>`;
  closeBtn.addEventListener("click", toggleSearch);

  bar.appendChild(input);
  bar.appendChild(prevBtn);
  bar.appendChild(nextBtn);
  bar.appendChild(closeBtn);

  return bar;
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

  toolbar = buildToolbar(sdk);
  searchBar = buildSearchBar();

  terminalArea = document.createElement("div");
  terminalArea.className = "ss-terminal-area";

  statusBar = document.createElement("div");
  statusBar.className = "ss-status-bar";

  root.appendChild(header);
  root.appendChild(tabBar);
  root.appendChild(toolbar);
  root.appendChild(searchBar);
  root.appendChild(terminalArea);
  root.appendChild(statusBar);

  return root;
}

// --- Events ---

function setupEvents(sdk: CaidoSDK): void {
  sdk.backend.onEvent("terminalOutput", (event) => {
    for (const tab of tabs) {
      const pane = findPaneByBackendId(tab.root, event.terminalId);
      if (pane) { pane.terminal.write(event.data); break; }
    }
  });

  sdk.backend.onEvent("terminalExit", (event) => {
    for (const tab of tabs) {
      const pane = findPaneByBackendId(tab.root, event.terminalId);
      if (pane) {
        pane.terminal.writeln(`\r\n\x1b[90m[Process exited with code ${event.code}]\x1b[0m`);
        pane.backendId = null;
        break;
      }
    }
  });

  const resizeObserver = new ResizeObserver(() => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab) fitAllPanes(tab.root);
  });

  if (terminalArea) {
    resizeObserver.observe(terminalArea);
  }
}

function findPaneByBackendId(node: PaneNode, backendId: string): Pane | null {
  if (node.type === "leaf") {
    return node.pane.backendId === backendId ? node.pane : null;
  }
  return findPaneByBackendId(node.first, backendId) || findPaneByBackendId(node.second, backendId);
}

// --- Preset Editor (unchanged) ---

function showPresetEditor(sdk: CaidoSDK, preset: Preset | null): void {
  const isNew = !preset;
  const isBuiltin = preset?.builtin ?? false;
  document.querySelector(".ss-modal-overlay")?.remove();

  const overlay = document.createElement("div");
  overlay.className = "ss-modal-overlay";
  const modal = document.createElement("div");
  modal.className = "ss-modal";
  const title = isNew ? "New Preset" : `Edit: ${preset!.name}`;

  modal.innerHTML = `
    <div class="ss-modal__header">${escapeHtml(title)}</div>
    <div class="ss-modal__body">
      <label class="ss-modal__field"><span>Name</span><input type="text" class="ss-modal__input" data-field="name" value="${escapeAttr(preset?.name || "")}" placeholder="My Preset" /></label>
      <label class="ss-modal__field"><span>Command</span><input type="text" class="ss-modal__input" data-field="command" value="${escapeAttr(preset?.command || "")}" placeholder="e.g. claude --dangerously-skip-permissions" /></label>
      <label class="ss-modal__field"><span>Description</span><input type="text" class="ss-modal__input" data-field="description" value="${escapeAttr(preset?.description || "")}" placeholder="Short description" /></label>
      <label class="ss-modal__field"><span>Color</span><input type="color" class="ss-modal__input ss-modal__input--color" data-field="color" value="${preset?.color || "#6b7280"}" /></label>
    </div>
    <div class="ss-modal__footer">
      ${isBuiltin ? `<button class="ss-modal__btn ss-modal__btn--reset" data-action="reset">Reset to default</button>` : ""}
      ${!isNew && !isBuiltin ? `<button class="ss-modal__btn ss-modal__btn--delete" data-action="delete">Delete</button>` : ""}
      <div class="ss-modal__spacer"></div>
      <button class="ss-modal__btn" data-action="cancel">Cancel</button>
      <button class="ss-modal__btn ss-modal__btn--primary" data-action="save">Save</button>
    </div>`;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  const firstInput = modal.querySelector("input") as HTMLInputElement;
  firstInput?.focus(); firstInput?.select();

  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
  modal.addEventListener("click", (e) => {
    const action = (e.target as HTMLElement).closest("[data-action]")?.getAttribute("data-action");
    if (!action) return;
    if (action === "cancel") { overlay.remove(); return; }
    if (action === "reset" && preset) { resetPreset(preset.id); overlay.remove(); renderPresetBar(sdk); return; }
    if (action === "delete" && preset) { deleteCustomPreset(preset.id); overlay.remove(); renderPresetBar(sdk); return; }
    if (action === "save") {
      const v = (f: string) => (modal.querySelector(`[data-field=${f}]`) as HTMLInputElement).value.trim();
      const name = v("name");
      if (!name) { (modal.querySelector("[data-field=name]") as HTMLInputElement).focus(); return; }
      if (isNew) { addCustomPreset({ name, command: v("command"), description: v("description"), color: v("color") || "#6b7280", icon: ICONS.custom }); }
      else { updatePreset(preset!.id, { name, command: v("command"), description: v("description"), color: v("color") }); }
      overlay.remove(); renderPresetBar(sdk);
    }
  });
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { overlay.remove(); document.removeEventListener("keydown", onKey); } };
  document.addEventListener("keydown", onKey);
}

// --- Helpers ---

function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

// --- Init ---

export const init = (sdk: CaidoSDK) => {
  sdkRef = sdk;
  const body = buildUI(sdk);
  renderPresetBar(sdk);

  sdk.navigation.addPage(PAGE_PATH, { body });
  sdk.sidebar.registerItem("ShadowShell", PAGE_PATH, { icon: "fas fa-terminal" });

  sdk.commands.register(Commands.newTab, { name: "ShadowShell: New Tab", run: () => createTab(sdk) });
  sdk.commands.register(Commands.closeTab, { name: "ShadowShell: Close Tab", run: () => { if (activeTabId) closeTab(sdk, activeTabId); } });
  sdk.commands.register(Commands.togglePanel, { name: "ShadowShell: Toggle", run: () => sdk.navigation.goTo(PAGE_PATH) });
  sdk.commands.register(Commands.splitVertical, { name: "ShadowShell: Split Right", run: () => splitPane(sdk, "horizontal") });
  sdk.commands.register(Commands.splitHorizontal, { name: "ShadowShell: Split Down", run: () => splitPane(sdk, "vertical") });
  sdk.commands.register(Commands.closePane, { name: "ShadowShell: Close Pane", run: () => closePane(sdk) });
  sdk.commands.register(Commands.search, { name: "ShadowShell: Search", run: toggleSearch });

  sdk.commandPalette.register(Commands.newTab);
  sdk.commandPalette.register(Commands.closeTab);
  sdk.commandPalette.register(Commands.splitVertical);
  sdk.commandPalette.register(Commands.splitHorizontal);
  sdk.commandPalette.register(Commands.closePane);
  sdk.commandPalette.register(Commands.search);

  // Keyboard shortcuts
  sdk.shortcuts.register(Commands.togglePanel, ["Ctrl", "J"]);

  setupEvents(sdk);
  setTimeout(() => createTab(sdk), 300);

  // Watch for Caido dark/light mode changes (update xterm terminal theme)
  const observer = new MutationObserver(() => {
    const theme = getTheme();
    for (const tab of tabs.values()) {
      const applyToNode = (node: PaneNode) => {
        if (node.type === "leaf") {
          node.pane.terminal.options.theme = theme;
        } else {
          applyToNode(node.first);
          applyToNode(node.second);
        }
      };
      applyToNode(tab.root);
    }
  });
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-mode"],
  });
};
