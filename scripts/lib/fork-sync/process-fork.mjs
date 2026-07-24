import { redact, logError } from "./util.mjs";
import { getFullRepo, getBranchSha, compareWithParent } from "./github/forks.mjs";
import { ensureUpstreamBranch } from "./github/upstream.mjs";
import {
  findExistingSyncPr,
  createSyncPr,
  waitForMergeable,
  mergePr,
} from "./github/pr.mjs";

/**
 * @typedef {'upstream_created'|'upstream_refreshed'|'up_to_date'|'merged'|'conflict'|'pr_open'|'skipped'|'error'} Status
 */

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
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {import('@octokit/openapi-types').components['schemas']['repository']} repo
 * @param {{ dryRun: boolean, mergeMethod: string }} opts
 * @returns {Promise<ForkResult>}
 */
export async function processFork(octokit, repo, opts) {
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
