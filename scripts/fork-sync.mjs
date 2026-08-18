#!/usr/bin/env node
/**
 * Scan authenticated user's forks:
 * - Ensure branch `upstream` exists and force-points at parent default tip
 * - If parent default is ahead of fork default, open/reuse PR and auto-merge when clean
 * - Email HTML summary via Happy-TTS outemail API
 *
 * Env:
 *   GH_PAT / USER_PAT   (required) GitHub PAT with repo + PR access
 *   OUTEMAIL_API_KEY    (required unless DRY_RUN=1)
 *   OUTEMAIL_BASE_URL   (optional, default https://tts.chloemlla.com)
 *   REPORT_TO           (optional, default happyclovo@gmail.com)
 *   DRY_RUN             (optional, "1" = no writes / no email)
 *   MERGE_METHOD        (optional: merge | squash | rebase, default merge)
 */

import { getRuntimeConfig } from "./lib/fork-sync/config.mjs";
import { log, logError, redact, countStatus } from "./lib/fork-sync/util.mjs";
import { createOctokit } from "./lib/fork-sync/github/client.mjs";
import { listForks } from "./lib/fork-sync/github/forks.mjs";
import { fetchRecentWorkflowRuns } from "./lib/fork-sync/github/workflow-runs.mjs";
import { processFork } from "./lib/fork-sync/process-fork.mjs";
import { zh } from "./lib/fork-sync/email/locales/index.mjs";
import { buildHtmlReport, buildSubject } from "./lib/fork-sync/email/report.mjs";
import { sendEmail } from "./lib/fork-sync/email/send.mjs";

async function main() {
  const cfg = getRuntimeConfig();
  const { dryRun, ghPat, outemailKey, outemailBase, reportTo, mergeMethod } =
    cfg;

  if (!ghPat) {
    logError("Missing GH_PAT / USER_PAT (or GITHUB_TOKEN) environment variable");
    process.exit(1);
  }

  if (!["merge", "squash", "rebase"].includes(mergeMethod)) {
    logError(`Invalid MERGE_METHOD=${mergeMethod}`);
    process.exit(1);
  }

  if (!dryRun && !outemailKey) {
    logError("Missing OUTEMAIL_API_KEY (or set DRY_RUN=1)");
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  log(
    `fork-sync start dryRun=${dryRun} mergeMethod=${mergeMethod}`,
  );

  const octokit = createOctokit(ghPat);
  const { data: me } = await octokit.rest.users.getAuthenticated();
  log(`authenticated as @${me.login}`);

  const forks = await listForks(octokit);
  log(`found ${forks.length} fork(s)`);

  /** @type {import('./lib/fork-sync/config.mjs').ForkResult[]} */
  const results = [];
  for (const repo of forks) {
    log(`→ ${repo.full_name}`);
    const r = await processFork(octokit, repo, { dryRun, mergeMethod });
    results.push(r);
    log(`  statuses=${r.statuses.join(",")} ${redact(r.message || "")} ${r.prUrl || ""}`);
  }

  const recentRuns = await fetchRecentWorkflowRuns(octokit);
  log(`recent workflow runs (24h): ${recentRuns.length}`);

  const locale = zh;
  const html = buildHtmlReport(
    {
      results,
      login: me.login,
      startedAt,
      dryRun,
      recentRuns,
    },
    locale,
  );
  const subject = buildSubject(results, startedAt, locale);

  let emailSent = false;
  let webhookSent = false;
  if (dryRun) {
    log(`[DRY_RUN] skip email subject=${subject}`);
    log(`[DRY_RUN] html length=${html.length}`);
  } else {
    log(`sending email to ${reportTo} subject=${subject}`);
    try {
      const sent = await sendEmail({
        baseUrl: outemailBase,
        apiKey: outemailKey,
        to: reportTo,
        subject,
        content: html,
      });
      emailSent = true;
      log(`email sent messageId=${sent.messageId || "ok"}`);
    } catch (err) {
      // Outemail auth/API failures must not fail the Action — fork scan already
      // succeeded. Match "keep Action green after report" (missing-parent soft errors).
      logError(
        "email send failed:",
        redact(err?.stack || err?.message || String(err)),
      );
      logError(
        "fork-sync completed but email failed (job still green; check OUTEMAIL credentials/API)",
      );
    }

    // POST HTML report to Janus automation webhook
    log("sending webhook report to Janus");
    try {
      const janusSecret = cfg.janusWebhookSecret;
      if (janusSecret) {
        const res = await fetch(
          "https://janus.chloemlla.com/api/v1/automation/webhook",
          {
            method: "POST",
            headers: {
              "X-Janus-Webhook-Secret": janusSecret,
              "Content-Type": "text/html",
            },
            body: html,
          },
        );
        if (!res.ok) {
          logError(`webhook POST failed HTTP ${res.status}`);
        } else {
          webhookSent = true;
          log("webhook report sent");
        }
      } else {
        logError("skip webhook: JANUS_WEBHOOK_SECRET not set");
      }
    } catch (err) {
      logError("webhook POST error:", redact(err?.message || String(err)));
    }
  }

  // Per-fork errors are included in the email report. Do not fail the Action
  // solely because some parents are gone — only fatal main() failures exit 1.
  const hardErrors = countStatus(results, "error");
  if (hardErrors > 0) {
    logError(
      `completed with ${hardErrors} per-fork error(s) (reported in email; job still green)`,
    );
  } else {
    log("completed successfully");
  }

  // Machine-readable summary for Actions
  const summary = {
    login: me.login,
    scanned: results.length,
    merged: countStatus(results, "merged"),
    conflicts: countStatus(results, "conflict"),
    prOpen: countStatus(results, "pr_open"),
    upstreamCreated: countStatus(results, "upstream_created"),
    upToDate: countStatus(results, "up_to_date"),
    errors: hardErrors,
    dryRun,
    emailSent,
    webhookSent,
    subject,
  };
  log(`SUMMARY ${JSON.stringify(summary)}`);
}

main().catch((err) => {
  logError("fatal:", redact(err?.stack || err?.message || String(err)));
  process.exit(1);
});
