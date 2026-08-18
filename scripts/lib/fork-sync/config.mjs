/**
 * Fork-sync constants and runtime config.
 *
 * Env:
 *   GH_PAT / USER_PAT   (required) GitHub PAT with repo + PR access
 *   OUTEMAIL_API_KEY    (required unless DRY_RUN=1)
 *   OUTEMAIL_BASE_URL   (optional, default https://tts.chloemlla.com)
 *   REPORT_TO           (optional, default happyclovo@gmail.com)
 *   DRY_RUN             (optional, "1" = no writes / no email)
 *   MERGE_METHOD        (optional: merge | squash | rebase, default merge)
 *   JANUS_WEBHOOK_SECRET (optional) webhook secret for Janus report endpoint
 */

export const PR_TITLE = "chore(sync): merge upstream";
export const PR_MARKER = "<!-- fork-sync-bot -->";
export const UPSTREAM_BRANCH = "upstream";
export const MERGEABLE_RETRIES = 6;
export const MERGEABLE_DELAY_MS = 2000;

/** @typedef {'upstream_created'|'upstream_refreshed'|'up_to_date'|'merged'|'conflict'|'pr_open'|'skipped'|'error'} Status */

/**
 * @typedef {object} ForkResult
 * @property {string} fullName
 * @property {string} htmlUrl
 * @property {string[]} statuses
 * @property {string} [parentFullName]
 * @property {string} [defaultBranch]
 * @property {string} [parentDefaultBranch]
 * @property {number} [prNumber]
 * @property {string} [prUrl]
 * @property {string} [message]
 * @property {boolean} [upstreamCreated]
 * @property {boolean} [upstreamRefreshed]
 * @property {string} [compareStatus]
 * @property {number} [parentAhead]
 * @property {string} [upstreamSha]
 */

/**
 * @typedef {object} WorkflowRunSummary
 * @property {number} id
 * @property {string|null} conclusion
 * @property {string} status
 * @property {string} html_url
 * @property {string} created_at
 * @property {string} display_title
 */

export function env(name, fallback = undefined) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v;
}

export function isDryRun() {
  return env("DRY_RUN", "0") === "1" || process.argv.includes("--dry-run");
}

/**
 * @returns {{
 *   dryRun: boolean,
 *   ghPat: string | undefined,
 *   outemailKey: string | undefined,
 *   outemailBase: string,
 *   reportTo: string,
 *   mergeMethod: string,
 *   janusWebhookSecret: string | undefined,
 * }}
 */
export function getRuntimeConfig() {
  return {
    dryRun: isDryRun(),
    ghPat: env("GH_PAT") || env("USER_PAT") || env("GITHUB_TOKEN"),
    outemailKey: env("OUTEMAIL_API_KEY"),
    outemailBase: env("OUTEMAIL_BASE_URL", "https://tts.chloemlla.com"),
    reportTo: env("REPORT_TO", "happyclovo@gmail.com"),
    mergeMethod: env("MERGE_METHOD", "merge"),
    janusWebhookSecret: env("JANUS_WEBHOOK_SECRET"),
  };
}
