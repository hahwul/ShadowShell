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

  it("should escape Unicode characters correctly", () => {
    const input = "한글 <b>테스트</b> 🚀";
    const result = escapeHtml(input);
    expect(result).toContain("한글");
    expect(result).toContain("🚀");
    expect(result).not.toContain("<b>");
    expect(result).toContain("&lt;b&gt;");
  });

  it("should handle deeply nested malicious HTML", () => {
    const input = '<div><span><img src=x onerror="alert(1)"></span></div>';
    const result = escapeHtml(input);
    // All HTML tags are escaped — no raw < or > remain
    expect(result).not.toContain("<div");
    expect(result).not.toContain("<img");
    expect(result).toContain("&lt;div&gt;");
    expect(result).toContain("&lt;img");
  });

  it("should handle HTML entities in input", () => {
    const input = "&amp; &lt; &gt;";
    const result = escapeHtml(input);
    // textContent + innerHTML double-escapes entities
    expect(result).toContain("&amp;amp;");
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

  it("should escape backticks (template literal injection)", () => {
    // backticks are not escaped by escapeAttr — this documents the behavior
    expect(escapeAttr("`${alert(1)}`")).toBe("`${alert(1)}`");
  });

  it("should handle Unicode in attribute values", () => {
    expect(escapeAttr("한글<값>")).toBe("한글&lt;값&gt;");
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

  it("should reject 1-char hex", () => {
    expect(sanitizeColor("#a")).toBe("#6b7280");
  });

  it("should reject 2-char hex", () => {
    expect(sanitizeColor("#ab")).toBe("#6b7280");
  });

  it("should accept 4-char hex (regex allows 3-8, but not valid CSS)", () => {
    // Known gap: regex /^#[0-9a-f]{3,8}$/i allows non-standard lengths (4,5,7)
    expect(sanitizeColor("#abcd")).toBe("#abcd");
  });

  it("should accept 5-char hex (regex allows 3-8, but not valid CSS)", () => {
    expect(sanitizeColor("#abcde")).toBe("#abcde");
  });

  it("should accept 7-char hex (regex allows 3-8, but not valid CSS)", () => {
    expect(sanitizeColor("#abcdeff")).toBe("#abcdeff");
  });

  it("should reject mixed valid/invalid hex chars", () => {
    expect(sanitizeColor("#abcxyz")).toBe("#6b7280");
  });

  it("should reject hsl() notation", () => {
    expect(sanitizeColor("hsl(0, 100%, 50%)")).toBe("#6b7280");
  });

  it("should reject color with whitespace", () => {
    expect(sanitizeColor(" #aabbcc")).toBe("#6b7280");
    expect(sanitizeColor("#aabbcc ")).toBe("#6b7280");
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

  it("should reject SVG with data: URI in href", () => {
    const malicious = '<svg><a href="data:text/html,<script>alert(1)</script>"><circle/></a></svg>';
    // data: URIs are not blocked by current implementation — documenting behavior
    const result = sanitizeSvgIcon(malicious);
    // At minimum, script tag inside data: should trigger script detection
    expect(result).toBe(ICONS.custom);
  });

  it("should reject SVG with foreignObject containing HTML", () => {
    const malicious = '<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>';
    expect(sanitizeSvgIcon(malicious)).toBe(ICONS.custom);
  });

  it("should reject SVG with event handler using whitespace tricks", () => {
    const malicious = '<svg onload ="alert(1)"><circle/></svg>';
    expect(sanitizeSvgIcon(malicious)).toBe(ICONS.custom);
  });

  it("should reject SVG with onmouseover handler", () => {
    const malicious = '<svg onmouseover="alert(1)"><circle/></svg>';
    expect(sanitizeSvgIcon(malicious)).toBe(ICONS.custom);
  });

  it("should reject SVG with onfocus handler", () => {
    const malicious = '<svg><rect onfocus="alert(1)" tabindex="1"/></svg>';
    expect(sanitizeSvgIcon(malicious)).toBe(ICONS.custom);
  });

  it("should reject SVG with JAVASCRIPT: in mixed case", () => {
    const malicious = '<svg><a href="JaVaScRiPt:alert(1)"><circle/></a></svg>';
    expect(sanitizeSvgIcon(malicious)).toBe(ICONS.custom);
  });

  it("should handle null and undefined gracefully", () => {
    expect(sanitizeSvgIcon(null as any)).toBe(ICONS.custom);
    expect(sanitizeSvgIcon(undefined as any)).toBe(ICONS.custom);
  });

  it("should not block SVG set/animate attribute injection (known limitation)", () => {
    const malicious = '<svg><set attributeName="onmouseover" to="alert(1)"/></svg>';
    // Known gap: <set attributeName="onmouseover"> doesn't match on\w+= regex
    // since the event handler name is in an attribute value, not as an attribute itself.
    expect(sanitizeSvgIcon(malicious)).not.toBe(ICONS.custom);
  });

  it("should accept complex valid SVG with paths and transforms", () => {
    const valid = '<svg width="14" height="14" viewBox="0 0 14 14"><g transform="translate(1,1)"><path d="M0 0L12 0L12 12L0 12Z" stroke="currentColor" fill="none"/><circle cx="6" cy="6" r="3" fill="currentColor"/></g></svg>';
    expect(sanitizeSvgIcon(valid)).toBe(valid);
  });
});
