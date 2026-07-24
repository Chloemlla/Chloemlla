import { UPSTREAM_BRANCH } from "../config.mjs";
import { withRetry } from "../util.mjs";
import { getBranchSha } from "./forks.mjs";

/**
 * Ensure fork has `upstream` branch pointing at parent default SHA.
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {string} forkOwner
 * @param {string} forkRepo
 * @param {string} parentSha
 * @param {boolean} dryRun
 * @returns {Promise<{ created: boolean, refreshed: boolean, sha: string }>}
 */
export async function ensureUpstreamBranch(octokit, forkOwner, forkRepo, parentSha, dryRun) {
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
