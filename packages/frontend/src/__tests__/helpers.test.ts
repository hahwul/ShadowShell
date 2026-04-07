/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import { escapeHtml, escapeAttr, sanitizeColor, sanitizeSvgIcon } from "../helpers";
import { ICONS } from "../presets";

describe("escapeHtml", () => {
  it("should escape HTML entities", () => {
    expect(escapeHtml("<script>alert('xss')</script>")).toBe(
      "&lt;script&gt;alert('xss')&lt;/script&gt;"
    );
  });

  it("should escape ampersands", () => {
    expect(escapeHtml("foo & bar")).toBe("foo &amp; bar");
  });

  it("should escape double quotes in content", () => {
    expect(escapeHtml('"hello"')).toBe('"hello"');
  });

  it("should return empty string for empty input", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("should pass through safe strings unchanged", () => {
    expect(escapeHtml("Hello World 123")).toBe("Hello World 123");
  });

  it("should handle nested HTML tags", () => {
    const input = '<div onclick="alert(1)">test</div>';
    const result = escapeHtml(input);
    expect(result).not.toContain("<div");
    expect(result).toContain("&lt;div");
  });
});

describe("escapeAttr", () => {
  it("should escape ampersand", () => {
    expect(escapeAttr("a&b")).toBe("a&amp;b");
  });

  it("should escape double quotes", () => {
    expect(escapeAttr('a"b')).toBe("a&quot;b");
  });

  it("should escape single quotes", () => {
    expect(escapeAttr("a'b")).toBe("a&#39;b");
  });

  it("should escape angle brackets", () => {
    expect(escapeAttr("<script>")).toBe("&lt;script&gt;");
  });

  it("should escape all special chars in one string", () => {
    expect(escapeAttr(`<"&'>`)).toBe("&lt;&quot;&amp;&#39;&gt;");
  });

  it("should return empty string for empty input", () => {
    expect(escapeAttr("")).toBe("");
  });

  it("should pass through safe strings unchanged", () => {
    expect(escapeAttr("hello-world_123")).toBe("hello-world_123");
  });
});

describe("sanitizeColor", () => {
  it("should accept valid 3-char hex color", () => {
    expect(sanitizeColor("#abc")).toBe("#abc");
  });

  it("should accept valid 6-char hex color", () => {
    expect(sanitizeColor("#ff00ff")).toBe("#ff00ff");
  });

  it("should accept valid 8-char hex color (with alpha)", () => {
    expect(sanitizeColor("#ff00ff80")).toBe("#ff00ff80");
  });

  it("should accept uppercase hex color", () => {
    expect(sanitizeColor("#AABBCC")).toBe("#AABBCC");
  });

  it("should reject color without hash", () => {
    expect(sanitizeColor("ff0000")).toBe("#6b7280");
  });

  it("should reject rgb() notation", () => {
    expect(sanitizeColor("rgb(255,0,0)")).toBe("#6b7280");
  });

  it("should reject named colors", () => {
    expect(sanitizeColor("red")).toBe("#6b7280");
  });

  it("should reject empty string", () => {
    expect(sanitizeColor("")).toBe("#6b7280");
  });

  it("should reject color with invalid hex chars", () => {
    expect(sanitizeColor("#gggggg")).toBe("#6b7280");
  });

  it("should reject XSS in color", () => {
    expect(sanitizeColor("javascript:alert(1)")).toBe("#6b7280");
  });

  it("should reject too-long hex", () => {
    expect(sanitizeColor("#aabbccdde")).toBe("#6b7280");
  });
});

describe("sanitizeSvgIcon", () => {
  it("should accept valid SVG icon", () => {
    const svg = '<svg width="14" height="14"><circle cx="7" cy="7" r="5"/></svg>';
    expect(sanitizeSvgIcon(svg)).toBe(svg);
  });

  it("should return ICONS.custom for empty string", () => {
    expect(sanitizeSvgIcon("")).toBe(ICONS.custom);
  });

  it("should return ICONS.custom for non-SVG HTML", () => {
    expect(sanitizeSvgIcon("<div>not svg</div>")).toBe(ICONS.custom);
  });

  it("should reject SVG with onclick handler", () => {
    const malicious = '<svg onclick="alert(1)"><circle/></svg>';
    expect(sanitizeSvgIcon(malicious)).toBe(ICONS.custom);
  });

  it("should reject SVG with onload handler", () => {
    const malicious = '<svg onload="alert(1)"><circle/></svg>';
    expect(sanitizeSvgIcon(malicious)).toBe(ICONS.custom);
  });

  it("should reject SVG with onerror handler", () => {
    const malicious = '<svg onerror="alert(1)"><circle/></svg>';
    expect(sanitizeSvgIcon(malicious)).toBe(ICONS.custom);
  });

  it("should reject content with script tags", () => {
    const malicious = '<svg><script>alert(1)</script></svg>';
    expect(sanitizeSvgIcon(malicious)).toBe(ICONS.custom);
  });

  it("should reject javascript: URLs", () => {
    const malicious = '<svg><a href="javascript:alert(1)"><circle/></a></svg>';
    expect(sanitizeSvgIcon(malicious)).toBe(ICONS.custom);
  });

  it("should reject case-insensitive event handlers", () => {
    const malicious = '<svg ONCLICK="alert(1)"><circle/></svg>';
    expect(sanitizeSvgIcon(malicious)).toBe(ICONS.custom);
  });

  it("should accept built-in ICONS", () => {
    for (const [, icon] of Object.entries(ICONS)) {
      expect(sanitizeSvgIcon(icon)).toBe(icon);
    }
  });
});
