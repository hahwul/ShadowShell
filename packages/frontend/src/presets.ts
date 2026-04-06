export interface Preset {
  id: string;
  name: string;
  icon: string;
  command: string;
  description: string;
  color: string;
  builtin?: boolean;
}

// SVG icon helpers (14x14, stroke-based)
const svgIcon = (path: string) =>
  `<svg width="14" height="14" viewBox="0 0 14 14" fill="none">${path}</svg>`;

export const ICONS = {
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
  custom: svgIcon(
    `<path d="M7 2l1.5 3H12l-2.5 2 1 3L7 8.5 3.5 10l1-3L2 5h3.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`
  ),
};

export const BUILTIN_PRESETS: Preset[] = [
  {
    id: "claude",
    name: "Claude",
    icon: ICONS.claude,
    command: "claude",
    description: "Anthropic Claude Code CLI",
    color: "#d97706",
    builtin: true,
  },
  {
    id: "gemini",
    name: "Gemini",
    icon: ICONS.gemini,
    command: "gemini",
    description: "Google Gemini CLI",
    color: "#4285f4",
    builtin: true,
  },
  {
    id: "codex",
    name: "Codex",
    icon: ICONS.circle,
    command: "codex",
    description: "OpenAI Codex CLI",
    color: "#10a37f",
    builtin: true,
  },
  {
    id: "shell",
    name: "Shell",
    icon: ICONS.terminal,
    command: "",
    description: "Default shell",
    color: "#6b7280",
    builtin: true,
  },
];

const OVERRIDES_KEY = "shadowshell-preset-overrides";
const CUSTOM_KEY = "shadowshell-custom-presets";

// Overrides: { [builtinId]: { command?, name?, description? } }
export function loadOverrides(): Record<string, Partial<Preset>> {
  try {
    const stored = localStorage.getItem(OVERRIDES_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

export function saveOverrides(overrides: Record<string, Partial<Preset>>): void {
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
}

export function loadCustomPresets(): Preset[] {
  try {
    const stored = localStorage.getItem(CUSTOM_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function saveCustomPresets(presets: Preset[]): void {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(presets));
}

export function getAllPresets(): Preset[] {
  const overrides = loadOverrides();
  const builtins = BUILTIN_PRESETS.map((p) => {
    const ov = overrides[p.id];
    if (!ov) return p;
    return { ...p, ...ov, id: p.id, icon: p.icon, builtin: true };
  });
  const customs = loadCustomPresets().map((p) => ({
    ...p,
    icon: p.icon || ICONS.custom,
    builtin: false,
  }));
  return [...builtins, ...customs];
}

export function updatePreset(id: string, changes: Partial<Preset>): void {
  const builtin = BUILTIN_PRESETS.find((p) => p.id === id);
  if (builtin) {
    const overrides = loadOverrides();
    overrides[id] = { ...overrides[id], ...changes };
    saveOverrides(overrides);
  } else {
    const customs = loadCustomPresets();
    const idx = customs.findIndex((p) => p.id === id);
    if (idx >= 0) {
      customs[idx] = { ...customs[idx]!, ...changes };
      saveCustomPresets(customs);
    }
  }
}

export function resetPreset(id: string): void {
  const overrides = loadOverrides();
  delete overrides[id];
  saveOverrides(overrides);
}

export function addCustomPreset(preset: Omit<Preset, "id" | "builtin">): Preset {
  const customs = loadCustomPresets();
  const newPreset: Preset = {
    ...preset,
    id: `custom-${Date.now()}`,
    builtin: false,
  };
  customs.push(newPreset);
  saveCustomPresets(customs);
  return newPreset;
}

export function deleteCustomPreset(id: string): void {
  const customs = loadCustomPresets().filter((p) => p.id !== id);
  saveCustomPresets(customs);
}
