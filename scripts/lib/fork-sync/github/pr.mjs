import {
  PR_TITLE,
  PR_MARKER,
  MERGEABLE_RETRIES,
  MERGEABLE_DELAY_MS,
} from "../config.mjs";
import { withRetry, sleep } from "../util.mjs";

/**
 * Find open sync PR: head parent:default into base default, or title/marker match.
 *
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {string} forkOwner
 * @param {string} forkRepo
 * @param {string} forkDefault
 * @param {string} parentOwner
 * @param {string} parentDefault
 */
export async function findExistingSyncPr(
  octokit,
  forkOwner,
  forkRepo,
  forkDefault,
  parentOwner,
  parentDefault,
) {
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

/**
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {string} forkOwner
 * @param {string} forkRepo
 * @param {string} forkDefault
 * @param {string} parentOwner
 * @param {string} parentDefault
 */
export async function createSyncPr(
  octokit,
  forkOwner,
  forkRepo,
  forkDefault,
  parentOwner,
  parentDefault,
) {
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

/**
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {string} forkOwner
 * @param {string} forkRepo
 * @param {number} prNumber
 */
export async function waitForMergeable(octokit, forkOwner, forkRepo, prNumber) {
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

/**
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {string} forkOwner
 * @param {string} forkRepo
 * @param {number} prNumber
 * @param {string} method
 */
export async function mergePr(octokit, forkOwner, forkRepo, prNumber, method) {
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
