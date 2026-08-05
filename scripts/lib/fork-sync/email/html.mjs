/**
 * Pure HTML email helpers (table layout + inline styles).
 * No locale or business logic — only structure primitives.
 *
 * Visual style follows the LogShare / AdminHub design system
 * (Happy-TTS) translated to email-safe inline CSS:
 *  - slate scale panels/borders, solid #ffffff cards
 *  - indigo-600 #4f46e5 links
 *  - emerald/rose/amber status tones
 */

import { escapeHtml } from "../util.mjs";

/**
 * @param {string} label already localized (caller may pass raw locale text)
 */
export function th(label) {
  return `<th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e2e8f0;color:#64748b;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;">${label}</th>`;
}

/**
 * @param {string} html cell inner HTML (may include links; caller escapes dynamic text)
 */
export function td(html) {
  return `<td style="padding:10px 12px;border-bottom:1px solid #e2e8f0;font-size:13px;vertical-align:top;color:#334155;">${html}</td>`;
}

/**
 * LogShare InfoMetricCard tile (used in the 2-row x 3-col stats grid).
 * @param {string} label
 * @param {string|number} value
 * @param {string} color tone tint for the shield icon chip
 */
export function stat(label, value, color) {
  return `
    <td width="33.33%" style="padding:6px;vertical-align:top;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#ffffff;border:1px solid #e2e8f0;border-radius:22px;box-shadow:0 18px 60px rgba(15,23,42,0.06);">
        <tr><td style="padding:16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td style="vertical-align:top;">
                <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.18em;color:#64748b;">${label}</div>
                <div style="margin-top:6px;font-size:24px;font-weight:600;color:#020617;line-height:1.2;">${value}</div>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td>`;
}

/**
 * @param {string} text
 * @param {string} bg
 * @param {string} fg
 */
export function badge(text, bg, fg) {
  return `<span style="display:inline-block;padding:2px 10px;border-radius:999px;background:${bg};color:${fg};font-size:11px;font-weight:600;line-height:1.5;">${escapeHtml(text)}</span>`;
}

/**
 * LogShare InfoPanel + InfoSectionTitle (eyebrow + title + count).
 * @param {string} title section label, already localized (carries "A · " prefix)
 * @param {string} accent (unused — kept for signature compatibility)
 * @param {string} borderColor (unused — kept for signature compatibility)
 * @param {string} bodyHtml
 * @param {number} count
 */
export function sectionTable(title, accent, borderColor, bodyHtml, count) {
  if (!bodyHtml) return "";
  const heading = title.replace(/^[A-Z] · /, "");
  return `
    <tr><td style="padding:10px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#ffffff;border:1px solid #e2e8f0;border-radius:26px;box-shadow:0 18px 60px rgba(15,23,42,0.06);">
        <tr><td style="padding:20px;">
          <div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.26em;color:#64748b;">${title}</div>
          <div style="margin-top:6px;font-size:20px;font-weight:600;color:#0f172a;line-height:1.3;">${heading} <span style="color:#64748b;font-weight:500;font-size:15px;">(${count})</span></div>
          <div style="margin-top:14px;">${bodyHtml}</div>
        </td></tr>
      </table>
    </td></tr>`;
}

/**
 * @param {{ htmlUrl: string, fullName: string }} r
 */
export function repoLink(r) {
  return `<a href="${escapeHtml(r.htmlUrl)}" style="color:#4f46e5;text-decoration:none;font-weight:600;">${escapeHtml(r.fullName)}</a>`;
}

/**
 * @param {{ prUrl?: string, prNumber?: number }} r
 */
export function prLink(r) {
  return r.prUrl
    ? `<a href="${escapeHtml(r.prUrl)}" style="color:#4f46e5;text-decoration:none;font-weight:600;">#${r.prNumber}</a>`
    : "—";
}

/**
 * @param {string | undefined} sha
 */
export function shortSha(sha) {
  return sha ? escapeHtml(String(sha).slice(0, 7)) : "—";
}

/**
 * Wrap thead + tbody into a bordered table.
 * @param {string} headHtml joined <th> cells
 * @param {string} bodyHtml joined <tr> rows
 */
export function dataTable(headHtml, bodyHtml) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <thead><tr style="background:#f1f5f9;">${headHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>`;
}
