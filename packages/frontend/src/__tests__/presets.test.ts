import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  type Preset,
  BUILTIN_PRESETS,
  ICONS,
  getAllPresets,
  updatePreset,
  resetPreset,
  addCustomPreset,
  deleteCustomPreset,
  loadOverrides,
  saveOverrides,
  loadCustomPresets,
  saveCustomPresets,
} from "../presets";

// --- localStorage mock ---
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    store[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete store[key];
  }),
  clear: vi.fn(() => {
    for (const key in store) delete store[key];
  }),
  get length() {
    return Object.keys(store).length;
  },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
};
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

function clearStore() {
  for (const key in store) delete store[key];
  vi.clearAllMocks();
}

// --- Tests ---

describe("presets", () => {
  beforeEach(clearStore);

  describe("BUILTIN_PRESETS", () => {
    it("should have 4 built-in presets", () => {
      expect(BUILTIN_PRESETS).toHaveLength(4);
    });

    it("should include claude, gemini, codex, shell", () => {
      const ids = BUILTIN_PRESETS.map((p) => p.id);
      expect(ids).toEqual(["claude", "gemini", "codex", "shell"]);
    });

    it("should all be marked as builtin", () => {
      for (const p of BUILTIN_PRESETS) {
        expect(p.builtin).toBe(true);
      }
    });

    it("shell preset should have empty command", () => {
      const shell = BUILTIN_PRESETS.find((p) => p.id === "shell");
      expect(shell?.command).toBe("");
    });
  });

  describe("loadOverrides / saveOverrides", () => {
    it("should return empty object when nothing stored", () => {
      expect(loadOverrides()).toEqual({});
    });

    it("should round-trip overrides", () => {
      const overrides = { claude: { command: "claude --verbose" } };
      saveOverrides(overrides);
      expect(loadOverrides()).toEqual(overrides);
    });

    it("should return empty object on invalid JSON", () => {
      store["shadowshell-preset-overrides"] = "not-json{{{";
      expect(loadOverrides()).toEqual({});
    });
  });

  describe("loadCustomPresets / saveCustomPresets", () => {
    it("should return empty array when nothing stored", () => {
      expect(loadCustomPresets()).toEqual([]);
    });

    it("should round-trip custom presets", () => {
      const presets: Preset[] = [
        {
          id: "custom-1",
          name: "Test",
          icon: "<svg></svg>",
          command: "test",
          description: "test preset",
          color: "#ff0000",
          builtin: false,
        },
      ];
      saveCustomPresets(presets);
      expect(loadCustomPresets()).toEqual(presets);
    });

    it("should return empty array on invalid JSON", () => {
      store["shadowshell-custom-presets"] = "{broken";
      expect(loadCustomPresets()).toEqual([]);
    });
  });

  describe("getAllPresets", () => {
    it("should return 4 built-in presets when no overrides or customs", () => {
      const presets = getAllPresets();
      expect(presets).toHaveLength(4);
      expect(presets[0]!.id).toBe("claude");
      expect(presets[3]!.id).toBe("shell");
    });

    it("should apply overrides to built-in presets", () => {
      saveOverrides({ claude: { command: "claude --model opus" } });
      const presets = getAllPresets();
      const claude = presets.find((p) => p.id === "claude");
      expect(claude?.command).toBe("claude --model opus");
      // id and icon should stay unchanged
      expect(claude?.id).toBe("claude");
      expect(claude?.builtin).toBe(true);
    });

    it("should preserve original builtin fields not in override", () => {
      saveOverrides({ gemini: { description: "Updated desc" } });
      const presets = getAllPresets();
      const gemini = presets.find((p) => p.id === "gemini");
      expect(gemini?.description).toBe("Updated desc");
      expect(gemini?.command).toBe("gemini"); // original preserved
      expect(gemini?.name).toBe("Gemini"); // original preserved
    });

    it("should append custom presets after built-ins", () => {
      saveCustomPresets([
        {
          id: "custom-1",
          name: "My Tool",
          icon: "",
          command: "mytool",
          description: "desc",
          color: "#abc",
          builtin: false,
        },
      ]);
      const presets = getAllPresets();
      expect(presets).toHaveLength(5);
      expect(presets[4]!.id).toBe("custom-1");
      expect(presets[4]!.builtin).toBe(false);
    });

    it("should set default icon for custom presets with no icon", () => {
      saveCustomPresets([
        {
          id: "custom-1",
          name: "NoIcon",
          icon: "",
          command: "cmd",
          description: "desc",
          color: "#000",
        } as Preset,
      ]);
      const presets = getAllPresets();
      const custom = presets.find((p) => p.id === "custom-1");
      expect(custom?.icon).toBe(ICONS.custom);
    });

    it("should not allow override to change builtin id", () => {
      saveOverrides({ claude: { id: "hacked" } as any });
      const presets = getAllPresets();
      const claude = presets.find((p) => p.name === "Claude");
      expect(claude?.id).toBe("claude");
    });

    it("should not allow override to change builtin flag", () => {
      saveOverrides({ claude: { builtin: false } as any });
      const presets = getAllPresets();
      const claude = presets.find((p) => p.id === "claude");
      expect(claude?.builtin).toBe(true);
    });

    it("should not allow override to change builtin icon", () => {
      const originalIcon = BUILTIN_PRESETS.find((p) => p.id === "claude")!.icon;
      saveOverrides({ claude: { icon: "<svg>hacked</svg>" } as any });
      const presets = getAllPresets();
      const claude = presets.find((p) => p.id === "claude");
      expect(claude?.icon).toBe(originalIcon);
    });

    it("should return consistent results across multiple calls", () => {
      saveOverrides({ gemini: { command: "gemini --fast" } });
      saveCustomPresets([
        { id: "custom-1", name: "C1", icon: "", command: "c1", description: "", color: "#000", builtin: false },
      ]);
      const first = getAllPresets();
      const second = getAllPresets();
      expect(first).toEqual(second);
      expect(first).toHaveLength(5);
    });

    it("should mark all custom presets as builtin: false", () => {
      saveCustomPresets([
        { id: "custom-1", name: "C1", icon: "", command: "c1", description: "", color: "#000", builtin: true as any },
      ]);
      const presets = getAllPresets();
      const custom = presets.find((p) => p.id === "custom-1");
      expect(custom?.builtin).toBe(false);
    });
  });

  describe("updatePreset", () => {
    it("should create override for builtin preset", () => {
      updatePreset("claude", { command: "claude --fast" });
      const overrides = loadOverrides();
      expect(overrides["claude"]?.command).toBe("claude --fast");
    });

    it("should merge with existing override", () => {
      updatePreset("claude", { command: "claude --fast" });
      updatePreset("claude", { description: "Fast mode" });
      const overrides = loadOverrides();
      expect(overrides["claude"]?.command).toBe("claude --fast");
      expect(overrides["claude"]?.description).toBe("Fast mode");
    });

    it("should update custom preset", () => {
      saveCustomPresets([
        {
          id: "custom-1",
          name: "Old",
          icon: "",
          command: "old",
          description: "old desc",
          color: "#000",
          builtin: false,
        },
      ]);
      updatePreset("custom-1", { name: "New", command: "new" });
      const customs = loadCustomPresets();
      expect(customs[0]!.name).toBe("New");
      expect(customs[0]!.command).toBe("new");
    });

    it("should do nothing for non-existent preset id", () => {
      updatePreset("nonexistent", { command: "anything" });
      expect(loadOverrides()).toEqual({});
      expect(loadCustomPresets()).toEqual([]);
    });

    it("should handle empty changes object for builtin", () => {
      updatePreset("claude", {});
      const overrides = loadOverrides();
      expect(overrides["claude"]).toEqual({});
    });

    it("should handle empty changes object for custom", () => {
      saveCustomPresets([
        { id: "custom-1", name: "Old", icon: "", command: "old", description: "d", color: "#000", builtin: false },
      ]);
      updatePreset("custom-1", {});
      const customs = loadCustomPresets();
      expect(customs[0]!.name).toBe("Old");
      expect(customs[0]!.command).toBe("old");
    });

    it("should not affect customs when updating a builtin", () => {
      saveCustomPresets([
        { id: "custom-1", name: "C1", icon: "", command: "c1", description: "", color: "#000", builtin: false },
      ]);
      updatePreset("claude", { command: "claude --fast" });
      const customs = loadCustomPresets();
      expect(customs[0]!.command).toBe("c1");
    });

    it("should handle special characters in preset fields", () => {
      saveCustomPresets([
        { id: "custom-1", name: "Test", icon: "", command: "test", description: "d", color: "#000", builtin: false },
      ]);
      updatePreset("custom-1", {
        name: "이름 <script>alert(1)</script>",
        command: 'cmd "with quotes" & pipes | etc',
        description: "desc\nwith\nnewlines",
      });
      const customs = loadCustomPresets();
      expect(customs[0]!.name).toBe("이름 <script>alert(1)</script>");
      expect(customs[0]!.command).toBe('cmd "with quotes" & pipes | etc');
      expect(customs[0]!.description).toContain("\n");
    });
  });

  describe("resetPreset", () => {
    it("should remove override for builtin preset", () => {
      saveOverrides({ claude: { command: "modified" }, gemini: { command: "modified" } });
      resetPreset("claude");
      const overrides = loadOverrides();
      expect(overrides["claude"]).toBeUndefined();
      expect(overrides["gemini"]?.command).toBe("modified"); // other untouched
    });

    it("should handle resetting a preset with no override", () => {
      resetPreset("shell"); // no error expected
      expect(loadOverrides()).toEqual({});
    });

    it("should restore original values after reset", () => {
      const original = BUILTIN_PRESETS.find((p) => p.id === "claude")!;
      updatePreset("claude", { command: "claude --modified", description: "Changed" });
      resetPreset("claude");
      const presets = getAllPresets();
      const claude = presets.find((p) => p.id === "claude");
      expect(claude?.command).toBe(original.command);
      expect(claude?.description).toBe(original.description);
    });
  });

  describe("addCustomPreset", () => {
    it("should create a custom preset with generated id", () => {
      const result = addCustomPreset({
        name: "New Tool",
        icon: "<svg></svg>",
        command: "newtool",
        description: "A new tool",
        color: "#ff00ff",
      });
      expect(result.id).toMatch(/^custom-\d+$/);
      expect(result.name).toBe("New Tool");
      expect(result.builtin).toBe(false);
    });

    it("should append to existing custom presets", () => {
      addCustomPreset({ name: "First", icon: "", command: "first", description: "", color: "#000" });
      addCustomPreset({ name: "Second", icon: "", command: "second", description: "", color: "#111" });
      const customs = loadCustomPresets();
      expect(customs).toHaveLength(2);
      expect(customs[0]!.name).toBe("First");
      expect(customs[1]!.name).toBe("Second");
    });

    it("should use Date.now() for id generation (may collide within same ms)", () => {
      const r1 = addCustomPreset({ name: "A", icon: "", command: "a", description: "", color: "#000" });
      const r2 = addCustomPreset({ name: "B", icon: "", command: "b", description: "", color: "#111" });
      // Both use Date.now() — ids may collide within same millisecond
      expect(r1.id).toMatch(/^custom-\d+$/);
      expect(r2.id).toMatch(/^custom-\d+$/);
      // All presets are still saved correctly regardless of id collision
      const customs = loadCustomPresets();
      expect(customs).toHaveLength(2);
    });

    it("should set builtin to false regardless of input", () => {
      const result = addCustomPreset({ name: "X", icon: "", command: "x", description: "", color: "#000" });
      expect(result.builtin).toBe(false);
    });

    it("should preserve special characters in custom preset fields", () => {
      const result = addCustomPreset({
        name: "한글 프리셋",
        icon: '<svg width="14" height="14"><circle/></svg>',
        command: "echo '한글'",
        description: "Description with <html> & \"quotes\"",
        color: "#ff00ff",
      });
      const customs = loadCustomPresets();
      const saved = customs.find((p) => p.id === result.id);
      expect(saved?.name).toBe("한글 프리셋");
      expect(saved?.command).toBe("echo '한글'");
      expect(saved?.description).toContain("<html>");
    });
  });

  describe("deleteCustomPreset", () => {
    it("should remove the custom preset by id", () => {
      saveCustomPresets([
        { id: "custom-1", name: "A", icon: "", command: "a", description: "", color: "#000", builtin: false },
        { id: "custom-2", name: "B", icon: "", command: "b", description: "", color: "#111", builtin: false },
      ]);
      deleteCustomPreset("custom-1");
      const customs = loadCustomPresets();
      expect(customs).toHaveLength(1);
      expect(customs[0]!.id).toBe("custom-2");
    });

    it("should handle deleting non-existent id gracefully", () => {
      saveCustomPresets([
        { id: "custom-1", name: "A", icon: "", command: "a", description: "", color: "#000", builtin: false },
      ]);
      deleteCustomPreset("nonexistent");
      expect(loadCustomPresets()).toHaveLength(1);
    });

    it("should handle deleting all custom presets one by one", () => {
      saveCustomPresets([
        { id: "custom-1", name: "A", icon: "", command: "a", description: "", color: "#000", builtin: false },
        { id: "custom-2", name: "B", icon: "", command: "b", description: "", color: "#111", builtin: false },
        { id: "custom-3", name: "C", icon: "", command: "c", description: "", color: "#222", builtin: false },
      ]);
      deleteCustomPreset("custom-1");
      deleteCustomPreset("custom-2");
      deleteCustomPreset("custom-3");
      expect(loadCustomPresets()).toEqual([]);
    });

    it("should not affect builtins when deleting custom preset", () => {
      saveCustomPresets([
        { id: "custom-1", name: "A", icon: "", command: "a", description: "", color: "#000", builtin: false },
      ]);
      deleteCustomPreset("claude"); // builtin id — should not crash or modify builtins
      expect(loadCustomPresets()).toHaveLength(1);
      expect(getAllPresets().find((p) => p.id === "claude")).toBeTruthy();
    });
  });

  describe("ICONS", () => {
    it("should contain expected icon keys", () => {
      const keys = Object.keys(ICONS);
      expect(keys).toContain("claude");
      expect(keys).toContain("gemini");
      expect(keys).toContain("bolt");
      expect(keys).toContain("terminal");
      expect(keys).toContain("custom");
      expect(keys).toContain("gear");
    });

    it("should contain valid SVG strings", () => {
      for (const [, icon] of Object.entries(ICONS)) {
        expect(icon).toContain("<svg");
        expect(icon).toContain("</svg>");
      }
    });
  });
});
