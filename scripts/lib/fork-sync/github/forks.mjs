import { withRetry } from "../util.mjs";

/**
 * @param {import('@octokit/rest').Octokit} octokit
 */
export async function listForks(octokit) {
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
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 */
export async function getFullRepo(octokit, owner, repo) {
  const { data } = await withRetry(() => octokit.rest.repos.get({ owner, repo }), {
    label: `repos.get ${owner}/${repo}`,
  });
  return data;
}

/**
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {string} owner
 * @param {string} repo
 * @param {string} branch
 */
export async function getBranchSha(octokit, owner, repo, branch) {
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
 * Compare fork default ... parent:parentDefault
 * Returns { status, aheadBy, behindBy, totalCommits } from GitHub compare API
 * status: diverged | ahead | behind | identical
 *
 * @param {import('@octokit/rest').Octokit} octokit
 * @param {string} forkOwner
 * @param {string} forkRepo
 * @param {string} forkDefault
 * @param {string} parentOwner
 * @param {string} parentDefault
 */
export async function compareWithParent(
  octokit,
  forkOwner,
  forkRepo,
  forkDefault,
  parentOwner,
  parentDefault,
) {
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
