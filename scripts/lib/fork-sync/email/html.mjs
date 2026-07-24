/**
 * Pure HTML email helpers (table layout + inline styles).
 * No locale or business logic — only structure primitives.
 */

import { escapeHtml } from "../util.mjs";

/**
 * @param {string} label already localized (caller may pass raw locale text)
 */
export function th(label) {
  return `<th style="text-align:left;padding:8px 10px;border-bottom:1px solid #d0d7de;color:#656d76;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.02em;">${label}</th>`;
}

/**
 * @param {string} html cell inner HTML (may include links; caller escapes dynamic text)
 */
export function td(html) {
  return `<td style="padding:8px 10px;border-bottom:1px solid #eaeef2;font-size:13px;vertical-align:top;color:#1f2328;">${html}</td>`;
}

/**
 * @param {string} label
 * @param {string|number} value
 * @param {string} color
 */
export function stat(label, value, color) {
  return `
    <td width="33%" style="padding:4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;">
        <tr><td style="padding:14px 10px;text-align:center;">
          <div style="font-size:24px;font-weight:700;color:${color};line-height:1.2;">${value}</div>
          <div style="font-size:11px;color:#656d76;margin-top:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;">${label}</div>
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
  return `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${bg};color:${fg};font-size:11px;font-weight:600;line-height:1.4;">${escapeHtml(text)}</span>`;
}

/**
 * @param {string} title
 * @param {string} accent
 * @param {string} borderColor
 * @param {string} bodyHtml
 * @param {number} count
 */
export function sectionTable(title, accent, borderColor, bodyHtml, count) {
  if (!bodyHtml) return "";
  return `
      <tr><td style="padding:18px 0 4px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border-left:4px solid ${borderColor};background:#ffffff;">
          <tr><td style="padding:0 0 0 12px;">
            <div style="font-size:14px;font-weight:700;color:${accent};margin-bottom:10px;">${title} <span style="color:#656d76;font-weight:500;">(${count})</span></div>
            ${bodyHtml}
          </td></tr>
        </table>
      </td></tr>`;
}

/**
 * @param {{ htmlUrl: string, fullName: string }} r
 */
export function repoLink(r) {
  return `<a href="${escapeHtml(r.htmlUrl)}" style="color:#0969da;text-decoration:none;font-weight:600;">${escapeHtml(r.fullName)}</a>`;
}

/**
 * @param {{ prUrl?: string, prNumber?: number }} r
 */
export function prLink(r) {
  return r.prUrl
    ? `<a href="${escapeHtml(r.prUrl)}" style="color:#0969da;text-decoration:none;">#${r.prNumber}</a>`
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
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #d0d7de;border-radius:8px;overflow:hidden;">
      <thead><tr style="background:#f6f8fa;">${headHtml}</tr></thead>
      <tbody>${bodyHtml}</tbody>
    </table>`;
}
