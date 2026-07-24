import { en } from "./en.mjs";
import { zh } from "./zh.mjs";

/**
 * Resolve report locale. Chinese is first-class default.
 * Accepts 'zh' | 'en' | 'zh-CN' | 'en-US' | 'cn' (case-insensitive).
 * @param {string | undefined} code
 * @returns {typeof zh}
 */
export function getLocale(code) {
  const v = String(code ?? "zh").trim().toLowerCase();
  if (v === "en" || v === "en-us") return en;
  if (v === "zh" || v === "zh-cn" || v === "cn") return zh;
  return zh;
}

export { en, zh };
