export interface Preset {
  id: string;
  name: string;
  icon: string;
  command: string;
  description: string;
  color: string;
}

// SVG icon helpers (14x14, stroke-based)
const svgIcon = (path: string) =>
  `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">${path}</svg>`;

const ICONS = {
  claude: svgIcon(
    `<path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>` +
    `<circle cx="7" cy="7" r="5.5" stroke="currentColor" stroke-width="1.2"/>`
  ),
  gemini: svgIcon(
    `<path d="M7 1l2.5 4.5L14 7l-4.5 1.5L7 13l-2.5-4.5L0 7l4.5-1.5z" fill="currentColor" opacity="0.8"/>`
  ),
  bolt: svgIcon(
    `<path d="M8 1L3 8h4l-1 5 5-7H7l1-5z" fill="currentColor" opacity="0.85"/>`
  ),
  circle: svgIcon(
    `<circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.5"/>`
  ),
  gear: svgIcon(
    `<circle cx="7" cy="7" r="2" stroke="currentColor" stroke-width="1.2"/>` +
    `<path d="M7 1v2M7 11v2M1 7h2M11 7h2M2.8 2.8l1.4 1.4M9.8 9.8l1.4 1.4M11.2 2.8l-1.4 1.4M4.2 9.8l-1.4 1.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`
  ),
  terminal: svgIcon(
    `<rect x="1" y="2.5" width="12" height="9" rx="1.5" stroke="currentColor" stroke-width="1.2"/>` +
    `<path d="M3.5 6l2 1.5-2 1.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<line x1="7" y1="9" x2="10" y2="9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>`
  ),
};

export const DEFAULT_PRESETS: Preset[] = [
  {
    id: "claude",
    name: "Claude",
    icon: ICONS.claude,
    command: "claude",
    description: "Anthropic Claude Code CLI",
    color: "#d97706",
  },
  {
    id: "gemini",
    name: "Gemini",
    icon: ICONS.gemini,
    command: "gemini",
    description: "Google Gemini CLI",
    color: "#4285f4",
  },
  {
    id: "gemini-yolo",
    name: "Gemini YOLO",
    icon: ICONS.bolt,
    command: "gemini --yolo",
    description: "Gemini with auto-approve",
    color: "#ea4335",
  },
  {
    id: "codex",
    name: "Codex",
    icon: ICONS.circle,
    command: "codex",
    description: "OpenAI Codex CLI",
    color: "#10a37f",
  },
  {
    id: "aider",
    name: "Aider",
    icon: ICONS.gear,
    command: "aider",
    description: "AI pair programming",
    color: "#8b5cf6",
  },
  {
    id: "shell",
    name: "Shell",
    icon: ICONS.terminal,
    command: "",
    description: "Default shell",
    color: "#6b7280",
  },
];

const STORAGE_KEY = "shadowshell-custom-presets";

export function loadCustomPresets(): Preset[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveCustomPresets(presets: Preset[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

export function getAllPresets(): Preset[] {
  return [...DEFAULT_PRESETS, ...loadCustomPresets()];
}
