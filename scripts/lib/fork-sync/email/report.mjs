/**
 * Locale-aware HTML report + email subject for fork-sync.
 */

import { escapeHtml, hasStatus, countStatus, runUrl, redact } from "../util.mjs";
import {
  th,
  td,
  stat,
  badge,
  sectionTable,
  repoLink,
  prLink,
  shortSha,
  dataTable,
} from "./html.mjs";

/**
 * @param {object} report
 * @param {object[]} report.results
 * @param {string} report.login
 * @param {string} report.startedAt
 * @param {boolean} report.dryRun
 * @param {object[]} [report.recentRuns]
 * @param {object} locale locale object from getLocale()
 * @returns {string}
 */
export function buildHtmlReport(report, locale) {
  const { results, login, startedAt, dryRun, recentRuns = [] } = report;
  const scanned = results.length;
  const merged = countStatus(results, "merged");
  const conflicts = countStatus(results, "conflict");
  const prOpen = countStatus(results, "pr_open");
  const upstreamCreated = countStatus(results, "upstream_created");
  const upToDate = countStatus(results, "up_to_date");
  const errors = countStatus(results, "error");
  const skipped = countStatus(results, "skipped");

  const upstreamRows = results.filter((r) => hasStatus(r, "upstream_created"));
  const conflictRows = results.filter(
    (r) => hasStatus(r, "conflict") || hasStatus(r, "pr_open"),
  );
  const mergedRows = results.filter((r) => hasStatus(r, "merged"));
  const errorRows = results.filter(
    (r) => hasStatus(r, "error") || hasStatus(r, "skipped"),
  );

  const workflow = runUrl();
  const when = new Date(startedAt)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d+Z$/, " UTC");

  const c = locale.columns;

  // Section A — Upstream created (full detail)
  let upstreamHtml = "";
  if (upstreamRows.length) {
    const head = [
      c.repository,
      c.parent,
      c.forkParentDefault,
      c.statuses,
      c.sha,
      c.note,
      c.pr,
    ]
      .map(th)
      .join("");
    const body = upstreamRows
      .map((r) => {
        const branches = `${escapeHtml(r.defaultBranch || "—")} / ${escapeHtml(r.parentDefaultBranch || "—")}`;
        const cells = [
          repoLink(r),
          escapeHtml(r.parentFullName || "—"),
          branches,
          escapeHtml((r.statuses || []).join(", ")),
          `<code style="font-size:12px;background:#f6f8fa;padding:1px 4px;border-radius:4px;">${shortSha(r.upstreamSha)}</code>`,
          // Defense in depth: messages may carry vendor error text; never put tokens in email.
          escapeHtml(redact(r.message || "")),
          prLink(r),
        ];
        return `<tr>${cells.map(td).join("")}</tr>`;
      })
      .join("");
    upstreamHtml = dataTable(head, body);
  }

  // Sections B/C/D — standard detail tables
  const detailTable = (rows) => {
    if (!rows.length) return "";
    const head = [
      c.repository,
      c.parent,
      c.branches,
      c.compare,
      c.pr,
      c.statuses,
      c.note,
    ]
      .map(th)
      .join("");
    const body = rows
      .map((r) => {
        const branches = `${escapeHtml(r.defaultBranch || "—")} ← ${escapeHtml(r.parentDefaultBranch || "—")}`;
        // compareStatus is a GitHub enum (ahead/behind/…); parentAhead is numeric — no HTML needed.
        const cmp =
          r.compareStatus != null
            ? `${r.compareStatus}${typeof r.parentAhead === "number" ? ` (+${r.parentAhead})` : ""}`
            : "—";
        const cells = [
          repoLink(r),
          escapeHtml(r.parentFullName || "—"),
          branches,
          escapeHtml(cmp),
          prLink(r),
          escapeHtml((r.statuses || []).join(", ")),
          escapeHtml(redact(r.message || "")),
        ];
        return `<tr>${cells.map(td).join("")}</tr>`;
      })
      .join("");
    return dataTable(head, body);
  };

  // Section E — last 24h workflow runs
  let runsHtml = "";
  if (recentRuns.length) {
    const head = [c.whenUtc, c.title, c.status, c.conclusion, c.link]
      .map(th)
      .join("");
    const body = recentRuns
      .map((w) => {
        const whenRun = new Date(w.created_at)
          .toISOString()
          .replace("T", " ")
          .replace(/\.\d+Z$/, "Z");
        const statusBadge =
          w.conclusion === "success"
            ? badge(w.conclusion, "#dafbe1", "#1a7f37")
            : w.conclusion === "failure"
              ? badge(w.conclusion, "#ffebe9", "#cf222e")
              : w.conclusion
                ? badge(w.conclusion, "#fff8c5", "#9a6700")
                : badge(w.status, "#ddf4ff", "#0969da");
        const cells = [
          escapeHtml(whenRun),
          escapeHtml(w.display_title),
          escapeHtml(w.status),
          statusBadge,
          `<a href="${escapeHtml(w.html_url)}" style="color:#0969da;text-decoration:none;">#${w.id}</a>`,
        ];
        return `<tr>${cells.map(td).join("")}</tr>`;
      })
      .join("");
    runsHtml = dataTable(head, body);
  } else {
    runsHtml = `<div style="font-size:13px;color:#656d76;padding:8px 0;">${escapeHtml(locale.noRuns)}</div>`;
  }

  const hasDetail =
    upstreamRows.length ||
    conflictRows.length ||
    mergedRows.length ||
    errorRows.length;

  const s = locale.stats;
  const sec = locale.sections;
  const drySuffix = dryRun ? locale.dryRunSuffix : "";
  const titleEsc = escapeHtml(locale.title);
  const lang = escapeHtml(locale.lang || "zh-CN");

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <title>${titleEsc}</title>
</head>
<body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2328;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fa;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-collapse:collapse;">
        <!-- Header -->
        <tr><td style="padding:20px 24px;background:#24292f;border-radius:10px 10px 0 0;">
          <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">${titleEsc}${escapeHtml(drySuffix)}</div>
          <div style="font-size:12px;color:#8b949e;margin-top:8px;line-height:1.5;">
            ${escapeHtml(when)}
            <span style="color:#484f58;"> · </span>@${escapeHtml(login)}
            <span style="color:#484f58;"> · </span>${escapeHtml(locale.scannedUnit(scanned))}
          </div>
        </td></tr>

        <!-- Stats -->
        <tr><td style="background:#ffffff;padding:20px 20px 8px 20px;border-left:1px solid #d0d7de;border-right:1px solid #d0d7de;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              ${stat(escapeHtml(s.scanned), scanned, "#1f2328")}
              ${stat(escapeHtml(s.merged), merged, "#1a7f37")}
              ${stat(escapeHtml(s.conflicts), conflicts + prOpen, "#cf222e")}
            </tr>
            <tr>
              ${stat(escapeHtml(s.upstreamCreated), upstreamCreated, "#0969da")}
              ${stat(escapeHtml(s.upToDate), upToDate, "#656d76")}
              ${stat(escapeHtml(s.errorsSkipped), errors + skipped, "#bf8700")}
            </tr>
          </table>
        </td></tr>

        <!-- Sections -->
        <tr><td style="background:#ffffff;padding:4px 20px 24px 20px;border:1px solid #d0d7de;border-top:0;border-radius:0 0 10px 10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${sectionTable(escapeHtml(sec.upstream), "#0969da", "#0969da", upstreamHtml, upstreamRows.length)}
            ${sectionTable(escapeHtml(sec.conflicts), "#cf222e", "#cf222e", detailTable(conflictRows), conflictRows.length)}
            ${sectionTable(escapeHtml(sec.merged), "#1a7f37", "#1a7f37", detailTable(mergedRows), mergedRows.length)}
            ${sectionTable(escapeHtml(sec.errors), "#bf8700", "#bf8700", detailTable(errorRows), errorRows.length)}
            ${sectionTable(escapeHtml(sec.runs), "#57606a", "#d0d7de", runsHtml, recentRuns.length)}
            ${
              !hasDetail
                ? `<tr><td style="padding:20px 0 8px 0;font-size:14px;color:#656d76;line-height:1.5;">${escapeHtml(locale.allUpToDate(scanned))}</td></tr>`
                : ""
            }
          </table>
          <div style="margin-top:20px;font-size:11px;color:#8b949e;border-top:1px solid #eaeef2;padding-top:14px;line-height:1.5;">
            ${escapeHtml(locale.footer)}
            ${workflow ? ` · <a href="${escapeHtml(workflow)}" style="color:#0969da;text-decoration:none;">${escapeHtml(locale.currentRun)}</a>` : ""}
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * @param {object[]} results
 * @param {string} startedAt
 * @param {object} locale
 * @returns {string}
 */
export function buildSubject(results, startedAt, locale) {
  const day = new Date(startedAt).toISOString().slice(0, 10);
  const merged = countStatus(results, "merged");
  const conflicts =
    countStatus(results, "conflict") + countStatus(results, "pr_open");
  const errors = countStatus(results, "error");
  const n = results.length;
  if (errors && !merged && !conflicts) {
    return locale.subject.failed(day, errors, n);
  }
  if (merged === 0 && conflicts === 0 && errors === 0) {
    return locale.subject.allClean(day, n);
  }
  return locale.subject.summary(day, merged, conflicts, errors);
}
