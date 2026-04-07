import { ICONS } from "./presets";

export function escapeHtml(str: string): string {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

export function escapeAttr(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sanitizeColor(color: string): string {
  return /^#[0-9a-f]{3,8}$/i.test(color) ? color : "#6b7280";
}

export function sanitizeSvgIcon(icon: string): string {
  if (!icon || typeof icon !== "string") return ICONS.custom;
  // Only allow SVG tags, reject anything with event handlers or scripts
  if (/on\w+\s*=/i.test(icon) || /<script/i.test(icon) || /javascript:/i.test(icon)) {
    return ICONS.custom;
  }
  const div = document.createElement("div");
  div.innerHTML = icon;
  if (!div.querySelector("svg")) return ICONS.custom;
  return icon;
}
