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

import { Octokit } from "@octokit/rest";

const PR_TITLE = "chore(sync): merge upstream";
const PR_MARKER = "<!-- fork-sync-bot -->";
const UPSTREAM_BRANCH = "upstream";
const MERGEABLE_RETRIES = 6;
const MERGEABLE_DELAY_MS = 2000;

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

function env(name, fallback = undefined) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  return v;
}

function isDryRun() {
  return env("DRY_RUN", "0") === "1" || process.argv.includes("--dry-run");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function redact(text) {
  if (!text) return "";
  let out = String(text)
    .replace(/ghp_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/github_pat_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/gho_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/ghu_[A-Za-z0-9_]+/g, "[redacted]")
    .replace(/ghs_[A-Za-z0-9_]+/g, "[redacted]");
  // Redact known secret env values if they appear in error text
  for (const key of ["GH_PAT", "USER_PAT", "GITHUB_TOKEN", "OUTEMAIL_API_KEY"]) {
    const val = process.env[key];
    if (val && val.length >= 8) {
      out = out.split(val).join("[redacted]");
    }
  }
  return out;
}

function log(...args) {
  console.log(...args);
}

function logError(...args) {
  console.error(...args);
}

async function withRetry(fn, { retries = 3, label = "op" } = {}) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const status = err?.status ?? err?.response?.status;
      const retryable = status === 403 || status === 429 || status >= 500;
      if (!retryable || i === retries - 1) throw err;
      const wait = 1000 * 2 ** i;
      log(`[retry] ${label} status=${status} wait=${wait}ms`);
      await sleep(wait);
    }
  }
  throw last;
}

function createOctokit(token) {
  return new Octokit({
    auth: token,
    userAgent: "chloemlla-fork-sync/1.0",
    request: { timeout: 60_000 },
  });
}

/**
 * @param {Octokit} octokit
 */
async function listForks(octokit) {
  /** @type {import('@octokit/openapi-types').components['schemas']['repository'][]} */
  const forks = [];
  for await (const res of octokit.paginate.iterator(octokit.rest.repos.listForAuthenticatedUser, {
    type: "owner",
    per_page: 100,
    sort: "full_name",
  })) {
    for (const repo of res.data) {
      if (repo.fork && !repo.archived && !repo.disabled) {
        forks.push(repo);
      }
    }
  }
  return forks;
}

/**
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 */
async function getFullRepo(octokit, owner, repo) {
  const { data } = await withRetry(() => octokit.rest.repos.get({ owner, repo }), {
    label: `repos.get ${owner}/${repo}`,
  });
  return data;
}

/**
 * @param {Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 */
async function getBranchSha(octokit, owner, repo, branch) {
  const { data } = await withRetry(
    () =>
      octokit.rest.git.getRef({
        owner,
        repo,
        ref: `heads/${branch}`,
      }),
    { label: `getRef ${owner}/${repo}/${branch}` },
  );
  return data.object.sha;
}

/**
 * Ensure fork has `upstream` branch pointing at parent default SHA.
 * @returns {{ created: boolean, refreshed: boolean, sha: string }}
 */
async function ensureUpstreamBranch(octokit, forkOwner, forkRepo, parentSha, dryRun) {
  let existingSha = null;
  try {
    existingSha = await getBranchSha(octokit, forkOwner, forkRepo, UPSTREAM_BRANCH);
  } catch (err) {
    if (err?.status !== 404) throw err;
  }

  if (existingSha === parentSha) {
    return { created: false, refreshed: false, sha: parentSha };
  }

  if (dryRun) {
    return {
      created: existingSha === null,
      refreshed: existingSha !== null,
      sha: parentSha,
    };
  }

  if (existingSha === null) {
    await withRetry(
      () =>
        octokit.rest.git.createRef({
          owner: forkOwner,
          repo: forkRepo,
          ref: `refs/heads/${UPSTREAM_BRANCH}`,
          sha: parentSha,
        }),
      { label: `createRef upstream ${forkOwner}/${forkRepo}` },
    );
    return { created: true, refreshed: false, sha: parentSha };
  }

  await withRetry(
    () =>
      octokit.rest.git.updateRef({
        owner: forkOwner,
        repo: forkRepo,
        ref: `heads/${UPSTREAM_BRANCH}`,
        sha: parentSha,
        force: true,
      }),
    { label: `updateRef upstream ${forkOwner}/${forkRepo}` },
  );
  return { created: false, refreshed: true, sha: parentSha };
}

/**
 * Compare fork default ... parent:parentDefault
 * Returns { status, ahead_by, behind_by } from GitHub compare API
 * status: diverged | ahead | behind | identical
 */
async function compareWithParent(octokit, forkOwner, forkRepo, forkDefault, parentOwner, parentDefault) {
  const basehead = `${forkDefault}...${parentOwner}:${parentDefault}`;
  const { data } = await withRetry(
    () =>
      octokit.rest.repos.compareCommitsWithBasehead({
        owner: forkOwner,
        repo: forkRepo,
        basehead,
      }),
    { label: `compare ${forkOwner}/${forkRepo} ${basehead}` },
  );
  return {
    status: data.status,
    aheadBy: data.ahead_by,
    behindBy: data.behind_by,
    totalCommits: data.total_commits,
  };
}

/**
 * Find open sync PR: head parent:default into base default, or title/marker match.
 */
async function findExistingSyncPr(octokit, forkOwner, forkRepo, forkDefault, parentOwner, parentDefault) {
  const { data: prs } = await withRetry(
    () =>
      octokit.rest.pulls.list({
        owner: forkOwner,
        repo: forkRepo,
        state: "open",
        base: forkDefault,
        per_page: 50,
      }),
    { label: `pulls.list ${forkOwner}/${forkRepo}` },
  );

  const headLabel = `${parentOwner}:${parentDefault}`.toLowerCase();
  for (const pr of prs) {
    const label = (pr.head?.label || "").toLowerCase();
    if (label === headLabel) return pr;
    if (pr.title === PR_TITLE) return pr;
    if ((pr.body || "").includes(PR_MARKER)) return pr;
  }
  return null;
}

async function createSyncPr(octokit, forkOwner, forkRepo, forkDefault, parentOwner, parentDefault) {
  const body = [
    PR_MARKER,
    "",
    "Automated upstream sync by **fork-sync**.",
    "",
    `- Parent: \`${parentOwner}\` \`${parentDefault}\``,
    `- Base: \`${forkOwner}/${forkRepo}\` \`${forkDefault}\``,
    "",
    "If this PR has conflicts, please resolve manually. Clean PRs are auto-merged.",
  ].join("\n");

  const { data } = await withRetry(
    () =>
      octokit.rest.pulls.create({
        owner: forkOwner,
        repo: forkRepo,
        title: PR_TITLE,
        head: `${parentOwner}:${parentDefault}`,
        base: forkDefault,
        body,
        maintainer_can_modify: false,
      }),
    { label: `pulls.create ${forkOwner}/${forkRepo}` },
  );
  return data;
}

async function waitForMergeable(octokit, forkOwner, forkRepo, prNumber) {
  for (let i = 0; i < MERGEABLE_RETRIES; i++) {
    const { data } = await withRetry(
      () =>
        octokit.rest.pulls.get({
          owner: forkOwner,
          repo: forkRepo,
          pull_number: prNumber,
        }),
      { label: `pulls.get ${prNumber}` },
    );
    if (data.mergeable !== null && data.mergeable !== undefined) {
      return data;
    }
    await sleep(MERGEABLE_DELAY_MS);
  }
  const { data } = await octokit.rest.pulls.get({
    owner: forkOwner,
    repo: forkRepo,
    pull_number: prNumber,
  });
  return data;
}

async function mergePr(octokit, forkOwner, forkRepo, prNumber, method) {
  const { data } = await withRetry(
    () =>
      octokit.rest.pulls.merge({
        owner: forkOwner,
        repo: forkRepo,
        pull_number: prNumber,
        merge_method: method,
        commit_title: PR_TITLE,
      }),
    { label: `pulls.merge ${prNumber}` },
  );
  return data;
}

/**
 * @param {Octokit} octokit
 * @param {import('@octokit/openapi-types').components['schemas']['repository']} repo
 * @param {{ dryRun: boolean, mergeMethod: string }} opts
 * @returns {Promise<ForkResult>}
 */
async function processFork(octokit, repo, opts) {
  const fullName = repo.full_name;
  const [forkOwner, forkRepo] = fullName.split("/");
  /** @type {ForkResult} */
  const result = {
    fullName,
    htmlUrl: repo.html_url,
    statuses: [],
    defaultBranch: repo.default_branch,
  };

  try {
    const full = await getFullRepo(octokit, forkOwner, forkRepo);
    const parent = full.parent || full.source;
    if (!parent) {
      result.statuses.push("skipped");
      result.message = "No parent repository on fork";
      return result;
    }

    const parentOwner = parent.owner.login;
    const parentRepoName = parent.name;
    result.parentFullName = parent.full_name;

    let parentFull;
    try {
      parentFull = await getFullRepo(octokit, parentOwner, parentRepoName);
    } catch (err) {
      if (err?.status === 404) {
        result.statuses.push("skipped");
        result.message = `Parent not found or inaccessible: ${parent.full_name}`;
        return result;
      }
      throw err;
    }
    const parentDefault = parentFull.default_branch;
    const forkDefault = full.default_branch || repo.default_branch;
    result.defaultBranch = forkDefault;
    result.parentDefaultBranch = parentDefault;

    const parentSha = await getBranchSha(octokit, parentOwner, parentRepoName, parentDefault);

    const upstream = await ensureUpstreamBranch(
      octokit,
      forkOwner,
      forkRepo,
      parentSha,
      opts.dryRun,
    );
    result.upstreamCreated = upstream.created;
    result.upstreamRefreshed = upstream.refreshed;
    result.upstreamSha = upstream.sha;
    if (upstream.created) result.statuses.push("upstream_created");
    else if (upstream.refreshed) result.statuses.push("upstream_refreshed");

    // Gate: only continue sync if upstream exists (created or already present)
    // After ensure, it always exists (or dry-run pretends).
    const cmp = await compareWithParent(
      octokit,
      forkOwner,
      forkRepo,
      forkDefault,
      parentOwner,
      parentDefault,
    );
    result.compareStatus = cmp.status;
    result.parentAhead = cmp.aheadBy;

    // Compare basehead = forkDefault...parent:parentDefault
    // GitHub status is relative to head (parent): "ahead" = parent has commits fork lacks.
    // ahead_by = commits on head not in base (parent tips not in fork).
    const parentHasUpdates =
      cmp.status === "ahead" ||
      cmp.status === "diverged" ||
      (typeof cmp.aheadBy === "number" && cmp.aheadBy > 0);

    if (!parentHasUpdates || cmp.status === "identical") {
      result.statuses.push("up_to_date");
      result.message = `up to date (compare=${cmp.status}, parent_ahead=${cmp.aheadBy})`;
      return result;
    }

    let pr = await findExistingSyncPr(
      octokit,
      forkOwner,
      forkRepo,
      forkDefault,
      parentOwner,
      parentDefault,
    );

    if (!pr) {
      if (opts.dryRun) {
        result.statuses.push("pr_open");
        result.message = `DRY_RUN: would create PR (${cmp.status}, parent commits=${cmp.aheadBy})`;
        return result;
      }
      try {
        pr = await createSyncPr(
          octokit,
          forkOwner,
          forkRepo,
          forkDefault,
          parentOwner,
          parentDefault,
        );
      } catch (err) {
        // Cross-repo PR may fail if parent default already merged or no commits
        const msg = err?.message || String(err);
        if (err?.status === 422) {
          result.statuses.push("skipped");
          result.message = redact(`PR create 422: ${msg}`);
          return result;
        }
        throw err;
      }
    }

    result.prNumber = pr.number;
    result.prUrl = pr.html_url;

    if (opts.dryRun) {
      result.statuses.push("pr_open");
      result.message = "DRY_RUN: existing PR found, skip merge";
      return result;
    }

    const fresh = await waitForMergeable(octokit, forkOwner, forkRepo, pr.number);

    if (fresh.merged) {
      result.statuses.push("merged");
      result.message = "Already merged";
      return result;
    }

    if (fresh.mergeable === true) {
      try {
        await mergePr(octokit, forkOwner, forkRepo, pr.number, opts.mergeMethod);
        result.statuses.push("merged");
        result.message = `Merged via ${opts.mergeMethod}`;
        return result;
      } catch (err) {
        // Race: became unmergeable
        if (err?.status === 405 || err?.status === 409) {
          result.statuses.push("conflict");
          result.message = redact(`Merge rejected: ${err.message}`);
          return result;
        }
        throw err;
      }
    }

    if (fresh.mergeable === false) {
      result.statuses.push("conflict");
      result.message = `mergeable_state=${fresh.mergeable_state || "dirty"}`;
      return result;
    }

    result.statuses.push("pr_open");
    result.message = "mergeable still unknown after retries";
    return result;
  } catch (err) {
    result.statuses.push("error");
    result.message = redact(err?.message || String(err));
    logError(`[error] ${fullName}: ${result.message}`);
    return result;
  }
}

function hasStatus(r, s) {
  return r.statuses.includes(s);
}

function countStatus(results, s) {
  return results.filter((r) => hasStatus(r, s)).length;
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function runUrl() {
  const server = env("GITHUB_SERVER_URL", "https://github.com");
  const repo = env("GITHUB_REPOSITORY");
  const runId = env("GITHUB_RUN_ID");
  if (repo && runId) return `${server}/${repo}/actions/runs/${runId}`;
  return null;
}

/**
 * Fetch Fork Sync workflow runs from the last 24 hours (this repo).
 * Graceful empty when GITHUB_REPOSITORY missing or API fails.
 * @param {Octokit} octokit
 * @returns {Promise<WorkflowRunSummary[]>}
 */
async function fetchRecentWorkflowRuns(octokit) {
  const repoFull = env("GITHUB_REPOSITORY");
  if (!repoFull || !repoFull.includes("/")) {
    return [];
  }
  const [owner, repo] = repoFull.split("/");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  try {
    /** @type {import('@octokit/openapi-types').components['schemas']['workflow-run'][]} */
    let runs = [];

    // Prefer list by workflow file name; fall back to repo-wide filter by name.
    try {
      const { data } = await withRetry(
        () =>
          octokit.rest.actions.listWorkflowRuns({
            owner,
            repo,
            workflow_id: "fork-sync.yml",
            per_page: 30,
            created: `>=${since}`,
          }),
        { label: "listWorkflowRuns fork-sync.yml" },
      );
      runs = data.workflow_runs || [];
    } catch (err) {
      if (err?.status !== 404) throw err;
      const { data } = await withRetry(
        () =>
          octokit.rest.actions.listWorkflowRunsForRepo({
            owner,
            repo,
            per_page: 30,
            created: `>=${since}`,
          }),
        { label: "listWorkflowRunsForRepo" },
      );
      runs = (data.workflow_runs || []).filter(
        (w) =>
          (w.name || "").toLowerCase() === "fork sync" ||
          (w.path || "").endsWith("fork-sync.yml"),
      );
    }

    return runs
      .filter((w) => new Date(w.created_at).getTime() >= Date.now() - 24 * 60 * 60 * 1000)
      .map((w) => ({
        id: w.id,
        conclusion: w.conclusion ?? null,
        status: w.status || "unknown",
        html_url: w.html_url,
        created_at: w.created_at,
        display_title: w.display_title || w.name || `run #${w.id}`,
      }));
  } catch (err) {
    logError(`[warn] fetchRecentWorkflowRuns: ${redact(err?.message || String(err))}`);
    return [];
  }
}

/**
 * @param {object} report
 * @param {ForkResult[]} report.results
 * @param {string} report.login
 * @param {string} report.startedAt
 * @param {boolean} report.dryRun
 * @param {WorkflowRunSummary[]} [report.recentRuns]
 */
function buildHtmlReport(report) {
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
  const conflictRows = results.filter((r) => hasStatus(r, "conflict") || hasStatus(r, "pr_open"));
  const mergedRows = results.filter((r) => hasStatus(r, "merged"));
  const errorRows = results.filter((r) => hasStatus(r, "error") || hasStatus(r, "skipped"));

  const workflow = runUrl();
  const when = new Date(startedAt).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");

  const th = (label) =>
    `<th style="text-align:left;padding:8px 10px;border-bottom:1px solid #d0d7de;color:#656d76;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.02em;">${label}</th>`;

  const td = (html) =>
    `<td style="padding:8px 10px;border-bottom:1px solid #eaeef2;font-size:13px;vertical-align:top;color:#1f2328;">${html}</td>`;

  const stat = (label, value, color) => `
    <td width="33%" style="padding:4px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;">
        <tr><td style="padding:14px 10px;text-align:center;">
          <div style="font-size:24px;font-weight:700;color:${color};line-height:1.2;">${value}</div>
          <div style="font-size:11px;color:#656d76;margin-top:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;">${label}</div>
        </td></tr>
      </table>
    </td>`;

  const badge = (text, bg, fg) =>
    `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${bg};color:${fg};font-size:11px;font-weight:600;line-height:1.4;">${escapeHtml(text)}</span>`;

  const repoLink = (r) =>
    `<a href="${escapeHtml(r.htmlUrl)}" style="color:#0969da;text-decoration:none;font-weight:600;">${escapeHtml(r.fullName)}</a>`;

  const prLink = (r) =>
    r.prUrl
      ? `<a href="${escapeHtml(r.prUrl)}" style="color:#0969da;text-decoration:none;">#${r.prNumber}</a>`
      : "—";

  const shortSha = (sha) => (sha ? escapeHtml(String(sha).slice(0, 7)) : "—");

  const sectionTable = (title, accent, borderColor, bodyHtml, count) => {
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
  };

  // Section A — Upstream created (full detail)
  let upstreamHtml = "";
  if (upstreamRows.length) {
    const head = ["Repository", "Parent", "Fork / Parent default", "Statuses", "SHA", "Note", "PR"]
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
          escapeHtml(r.message || ""),
          prLink(r),
        ];
        return `<tr>${cells.map(td).join("")}</tr>`;
      })
      .join("");
    upstreamHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #d0d7de;border-radius:8px;overflow:hidden;">
      <thead><tr style="background:#f6f8fa;">${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  }

  // Sections B/C/D — standard detail tables
  const detailTable = (rows) => {
    if (!rows.length) return "";
    const head = ["Repository", "Parent", "Branches", "Compare", "PR", "Statuses", "Note"].map(th).join("");
    const body = rows
      .map((r) => {
        const branches = `${escapeHtml(r.defaultBranch || "—")} ← ${escapeHtml(r.parentDefaultBranch || "—")}`;
        const cmp =
          r.compareStatus != null
            ? `${escapeHtml(r.compareStatus)}${typeof r.parentAhead === "number" ? ` (+${r.parentAhead})` : ""}`
            : "—";
        const cells = [
          repoLink(r),
          escapeHtml(r.parentFullName || "—"),
          branches,
          escapeHtml(cmp),
          prLink(r),
          escapeHtml((r.statuses || []).join(", ")),
          escapeHtml(r.message || ""),
        ];
        return `<tr>${cells.map(td).join("")}</tr>`;
      })
      .join("");
    return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #d0d7de;border-radius:8px;overflow:hidden;">
      <thead><tr style="background:#f6f8fa;">${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  };

  // Section E — last 24h workflow runs
  let runsHtml = "";
  if (recentRuns.length) {
    const head = ["When (UTC)", "Title", "Status", "Conclusion", "Link"].map(th).join("");
    const body = recentRuns
      .map((w) => {
        const whenRun = new Date(w.created_at).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
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
    runsHtml = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #d0d7de;border-radius:8px;overflow:hidden;">
      <thead><tr style="background:#f6f8fa;">${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
  } else {
    runsHtml = `<div style="font-size:13px;color:#656d76;padding:8px 0;">No workflow runs found in the last 24 hours (or unavailable outside Actions).</div>`;
  }

  const hasDetail =
    upstreamRows.length || conflictRows.length || mergedRows.length || errorRows.length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light"/>
  <title>Fork Sync Report</title>
</head>
<body style="margin:0;padding:0;background:#f6f8fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1f2328;-webkit-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f8fa;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;border-collapse:collapse;">
        <!-- Header -->
        <tr><td style="padding:20px 24px;background:#24292f;border-radius:10px 10px 0 0;">
          <div style="font-size:20px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">Fork Sync Report${dryRun ? " · DRY RUN" : ""}</div>
          <div style="font-size:12px;color:#8b949e;margin-top:8px;line-height:1.5;">
            ${escapeHtml(when)}
            <span style="color:#484f58;"> · </span>@${escapeHtml(login)}
            <span style="color:#484f58;"> · </span>${scanned} fork${scanned === 1 ? "" : "s"} scanned
          </div>
        </td></tr>

        <!-- Stats -->
        <tr><td style="background:#ffffff;padding:20px 20px 8px 20px;border-left:1px solid #d0d7de;border-right:1px solid #d0d7de;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              ${stat("Scanned", scanned, "#1f2328")}
              ${stat("Merged", merged, "#1a7f37")}
              ${stat("Conflicts", conflicts + prOpen, "#cf222e")}
            </tr>
            <tr>
              ${stat("Upstream+", upstreamCreated, "#0969da")}
              ${stat("Up to date", upToDate, "#656d76")}
              ${stat("Errors / Skipped", errors + skipped, "#bf8700")}
            </tr>
          </table>
        </td></tr>

        <!-- Sections -->
        <tr><td style="background:#ffffff;padding:4px 20px 24px 20px;border:1px solid #d0d7de;border-top:0;border-radius:0 0 10px 10px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${sectionTable("A · Upstream created", "#0969da", "#0969da", upstreamHtml, upstreamRows.length)}
            ${sectionTable("B · Conflicts / PR open", "#cf222e", "#cf222e", detailTable(conflictRows), conflictRows.length)}
            ${sectionTable("C · Merged", "#1a7f37", "#1a7f37", detailTable(mergedRows), mergedRows.length)}
            ${sectionTable("D · Errors / skipped", "#bf8700", "#bf8700", detailTable(errorRows), errorRows.length)}
            ${sectionTable("E · Last 24h workflow runs", "#57606a", "#d0d7de", runsHtml, recentRuns.length)}
            ${
              !hasDetail
                ? `<tr><td style="padding:20px 0 8px 0;font-size:14px;color:#656d76;line-height:1.5;">All ${scanned} fork(s) are up to date. No action needed.</td></tr>`
                : ""
            }
          </table>
          <div style="margin-top:20px;font-size:11px;color:#8b949e;border-top:1px solid #eaeef2;padding-top:14px;line-height:1.5;">
            Generated by chloemlla fork-sync.
            ${workflow ? ` · <a href="${escapeHtml(workflow)}" style="color:#0969da;text-decoration:none;">Current workflow run</a>` : ""}
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildSubject(results, startedAt) {
  const day = new Date(startedAt).toISOString().slice(0, 10);
  const merged = countStatus(results, "merged");
  const conflicts = countStatus(results, "conflict") + countStatus(results, "pr_open");
  const errors = countStatus(results, "error");
  const n = results.length;
  if (errors && !merged && !conflicts) {
    return `[Fork Sync] FAILED — ${day} (${errors} errors, ${n} forks)`;
  }
  if (merged === 0 && conflicts === 0 && errors === 0) {
    return `[Fork Sync] ${day} — all up to date (${n} forks)`;
  }
  return `[Fork Sync] ${day} — ${merged} merged, ${conflicts} conflicts, ${errors} errors`;
}

async function sendEmail({ baseUrl, apiKey, to, subject, content }) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/outemail/send`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to,
      subject,
      content,
      from: "noreply",
      displayName: "Fork Sync Bot",
    }),
  });
  const text = await res.text();
  const bodySnippet = text.length > 1500 ? `${text.slice(0, 1500)}…` : text;

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const msg = redact(
      `Outemail failed HTTP ${res.status}: non-JSON response | body=${bodySnippet}`,
    );
    logError(msg);
    throw new Error(msg);
  }

  // Accept only JSON objects with success === true and HTTP OK.
  // Avoids throwing on parsed null/primitive before building a rich message.
  if (!res.ok || parsed == null || typeof parsed !== "object" || parsed.success !== true) {
    // Example: Outemail failed HTTP 401: unauthorized | success=false | body={...}
    let errLabel = "request failed";
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.error != null &&
      parsed.error !== ""
    ) {
      errLabel =
        typeof parsed.error === "string"
          ? parsed.error
          : JSON.stringify(parsed.error);
    }
    const successPart =
      parsed && typeof parsed === "object" && "success" in parsed
        ? ` | success=${JSON.stringify(parsed.success)}`
        : "";
    const rich = redact(
      `Outemail failed HTTP ${res.status}: ${errLabel}${successPart} | body=${bodySnippet}`,
    );
    logError(rich);
    throw new Error(rich);
  }
  return parsed;
}

async function main() {
  const dryRun = isDryRun();
  const ghPat = env("GH_PAT") || env("USER_PAT") || env("GITHUB_TOKEN");
  if (!ghPat) {
    logError("Missing GH_PAT / USER_PAT (or GITHUB_TOKEN) environment variable");
    process.exit(1);
  }

  const outemailKey = env("OUTEMAIL_API_KEY");
  const outemailBase = env("OUTEMAIL_BASE_URL", "https://tts.chloemlla.com");
  const reportTo = env("REPORT_TO", "happyclovo@gmail.com");
  const mergeMethod = env("MERGE_METHOD", "merge");
  if (!["merge", "squash", "rebase"].includes(mergeMethod)) {
    logError(`Invalid MERGE_METHOD=${mergeMethod}`);
    process.exit(1);
  }

  if (!dryRun && !outemailKey) {
    logError("Missing OUTEMAIL_API_KEY (or set DRY_RUN=1)");
    process.exit(1);
  }

  const startedAt = new Date().toISOString();
  log(`fork-sync start dryRun=${dryRun} mergeMethod=${mergeMethod}`);

  const octokit = createOctokit(ghPat);
  const { data: me } = await octokit.rest.users.getAuthenticated();
  log(`authenticated as @${me.login}`);

  const forks = await listForks(octokit);
  log(`found ${forks.length} fork(s)`);

  /** @type {ForkResult[]} */
  const results = [];
  for (const repo of forks) {
    log(`→ ${repo.full_name}`);
    const r = await processFork(octokit, repo, { dryRun, mergeMethod });
    results.push(r);
    log(`  statuses=${r.statuses.join(",")} ${redact(r.message || "")} ${r.prUrl || ""}`);
  }

  const recentRuns = await fetchRecentWorkflowRuns(octokit);
  log(`recent workflow runs (24h): ${recentRuns.length}`);

  const html = buildHtmlReport({
    results,
    login: me.login,
    startedAt,
    dryRun,
    recentRuns,
  });
  const subject = buildSubject(results, startedAt);

  if (dryRun) {
    log(`[DRY_RUN] skip email subject=${subject}`);
    log(`[DRY_RUN] html length=${html.length}`);
  } else {
    log(`sending email to ${reportTo} subject=${subject}`);
    const sent = await sendEmail({
      baseUrl: outemailBase,
      apiKey: outemailKey,
      to: reportTo,
      subject,
      content: html,
    });
    log(`email sent messageId=${sent.messageId || "ok"}`);
  }

  // Per-fork errors are included in the email report. Do not fail the Action
  // solely because some parents are gone — only fatal main() failures exit 1.
  const hardErrors = countStatus(results, "error");
  if (hardErrors > 0) {
    logError(`completed with ${hardErrors} per-fork error(s) (reported in email; job still green)`);
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
    subject,
  };
  log(`SUMMARY ${JSON.stringify(summary)}`);
}

main().catch((err) => {
  logError("fatal:", redact(err?.stack || err?.message || String(err)));
  process.exit(1);
});
