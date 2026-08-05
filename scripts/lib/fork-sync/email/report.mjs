/**
 * Locale-aware HTML report + email subject for fork-sync.
 * Visual style: LogShare / AdminHub design system (Happy-TTS).
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
 * @param {object} locale Chinese locale object (zh)
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
          `<code style="font-size:12px;background:#f1f5f9;color:#334155;padding:2px 6px;border-radius:6px;">${shortSha(r.upstreamSha)}</code>`,
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
        const t = new Date(w.created_at);
        const utc = t
          .toISOString()
          .replace("T", " ")
          .replace(/\.\d+Z$/, "");
        // Asia/Shanghai is fixed UTC+8 (no DST); keep the same YYYY-MM-DD HH:MM:SS shape as UTC.
        const shanghai = new Date(t.getTime() + 8 * 60 * 60 * 1000)
          .toISOString()
          .replace("T", " ")
          .replace(/\.\d+Z$/, "");
        const statusBadge =
          w.conclusion === "success"
            ? badge(w.conclusion, "#ecfdf5", "#047857")
            : w.conclusion === "failure"
              ? badge(w.conclusion, "#fff1f2", "#be123c")
              : w.status === "in_progress" || w.status === "queued"
                ? badge(w.status, "#fffbeb", "#b45309")
                : badge(w.conclusion || w.status || "unknown", "#f1f5f9", "#475569");
        const cells = [
          `<div>${escapeHtml(utc)}Z</div><div style="color:#64748b;font-size:12px;margin-top:2px;">${escapeHtml(shanghai)} 上海</div>`,
          escapeHtml(w.display_title),
          escapeHtml(w.status),
          statusBadge,
          `<a href="${escapeHtml(w.html_url)}" style="color:#4f46e5;text-decoration:none;font-weight:600;">#${w.id}</a>`,
        ];
        return `<tr>${cells.map(td).join("")}</tr>`;
      })
      .join("");
    runsHtml = dataTable(head, body);
  } else {
    runsHtml = `<div style="font-size:13px;color:#64748b;line-height:1.6;">${escapeHtml(locale.noRuns)}</div>`;
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

  // Tone colors for stat icons
  const statColor = {
    scanned: "#64748b",
    merged: "#059669",
    conflicts: "#f43f5e",
    upstreamCreated: "#4f46e5",
    upToDate: "#64748b",
    errorsSkipped: "#b45309",
  };

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <title>${titleEsc}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#0f172a;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;border-collapse:collapse;">

        <!-- Hero — InfoQueryHero / logShareHeroClass -->
        <tr><td style="padding:0 0 12px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:separate;background:#ffffff;border:1px solid #e2e8f0;border-radius:34px;box-shadow:0 28px 110px rgba(15,23,42,0.10);">
            <tr><td style="padding:28px;">

              <span style="display:inline-block;padding:4px 12px;border-radius:999px;border:1px solid #e2e8f0;background:#f1f5f9;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.28em;color:#64748b;">FORK SYNC BOT</span>

              <div style="margin-top:18px;font-size:30px;font-weight:600;color:#0f172a;line-height:1.25;letter-spacing:-0.02em;">${titleEsc}${escapeHtml(drySuffix)}</div>

              <div style="margin-top:12px;font-size:14px;line-height:1.75;color:#475569;">${escapeHtml(when)}<span style="color:#94a3b8;"> · </span>@${escapeHtml(login)}<span style="color:#94a3b8;"> · </span>${escapeHtml(locale.scannedUnit(scanned))}</div>

              <div style="margin-top:18px;">
                <span style="display:inline-block;padding:4px 10px;border-radius:999px;border:1px solid #e2e8f0;background:#f1f5f9;font-size:12px;font-weight:600;color:#475569;">@${escapeHtml(login)}</span>
                <span style="display:inline-block;padding:4px 10px;margin-left:6px;border-radius:999px;border:1px solid #e2e8f0;background:#f1f5f9;font-size:12px;font-weight:600;color:#475569;">${escapeHtml(locale.scannedCount(scanned))}</span>
                ${dryRun ? `<span style="display:inline-block;padding:4px 10px;margin-left:6px;border-radius:999px;border:1px solid #fde68a;background:#fffbeb;font-size:12px;font-weight:600;color:#b45309;">${escapeHtml(locale.dryRunBadge)}</span>` : ""}
              </div>

            </td></tr>
          </table>
        </td></tr>

        <!-- Stats — InfoMetricCard grid (2 rows × 3 tiles) -->
        <tr><td style="padding:6px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              ${stat(escapeHtml(s.scanned), scanned, statColor.scanned)}
              ${stat(escapeHtml(s.merged), merged, statColor.merged)}
              ${stat(escapeHtml(s.conflicts), conflicts + prOpen, statColor.conflicts)}
            </tr>
            <tr>
              ${stat(escapeHtml(s.upstreamCreated), upstreamCreated, statColor.upstreamCreated)}
              ${stat(escapeHtml(s.upToDate), upToDate, statColor.upToDate)}
              ${stat(escapeHtml(s.errorsSkipped), errors + skipped, statColor.errorsSkipped)}
            </tr>
          </table>
        </td></tr>

        <!-- Sections A–E — InfoPanel -->
        <tr><td style="padding:6px 0 0 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${sectionTable(escapeHtml(sec.upstream), statColor.upstreamCreated, "#e2e8f0", upstreamHtml, upstreamRows.length)}
            ${sectionTable(escapeHtml(sec.conflicts), statColor.conflicts, "#e2e8f0", detailTable(conflictRows), conflictRows.length)}
            ${sectionTable(escapeHtml(sec.merged), statColor.merged, "#e2e8f0", detailTable(mergedRows), mergedRows.length)}
            ${sectionTable(escapeHtml(sec.errors), statColor.errorsSkipped, "#e2e8f0", detailTable(errorRows), errorRows.length)}
            ${sectionTable(escapeHtml(sec.runs), "#64748b", "#e2e8f0", runsHtml, recentRuns.length)}
            ${
              !hasDetail
                ? `<tr><td style="padding:16px 4px 4px 4px;">
<div style="font-size:14px;color:#475569;line-height:1.6;padding:18px 20px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:26px;">${escapeHtml(locale.allUpToDate(scanned))}</div>
</td></tr>`
                : ""
            }
          </table>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:18px 4px 0 4px;">
          <div style="border-top:1px solid #e2e8f0;padding-top:14px;font-size:11px;color:#94a3b8;line-height:1.5;">
            ${escapeHtml(locale.footer)}
            ${workflow ? ` · <a href="${escapeHtml(workflow)}" style="color:#4f46e5;text-decoration:none;font-weight:600;">${escapeHtml(locale.currentRun)}</a>` : ""}
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