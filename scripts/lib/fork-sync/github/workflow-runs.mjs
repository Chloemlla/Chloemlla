import { env } from "../config.mjs";
import { withRetry, redact, logError } from "../util.mjs";

/**
 * @typedef {object} WorkflowRunSummary
 * @property {number} id
 * @property {string|null} conclusion
 * @property {string} status
 * @property {string} html_url
 * @property {string} created_at
 * @property {string} display_title
 */

/**
 * Fetch Fork Sync workflow runs from the last 24 hours (this repo).
 * Graceful empty when GITHUB_REPOSITORY missing or API fails.
 * @param {import('@octokit/rest').Octokit} octokit
 * @returns {Promise<WorkflowRunSummary[]>}
 */
export async function fetchRecentWorkflowRuns(octokit) {
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
