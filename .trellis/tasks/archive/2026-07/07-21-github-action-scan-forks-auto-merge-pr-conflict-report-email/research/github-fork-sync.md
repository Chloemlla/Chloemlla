# Research: GitHub fork sync automation

## Goal

List user forks, ensure `upstream` branch exists (from parent default tip), open PR parent:default → fork:default when behind, auto-merge if clean, keep PR + report if conflict.

## APIs (REST via Octokit / fetch)

| Step | API |
| --- | --- |
| List user repos (forks) | `GET /user/repos?type=owner&per_page=100` + pagination; filter `fork === true` |
| Repo detail (parent) | fork payload includes `parent` when fetched with full repo; else `GET /repos/{owner}/{repo}` |
| Parent default branch tip | `GET /repos/{parent}/git/ref/heads/{default_branch}` or `GET /repos/{parent}/commits/{default_branch}` |
| List / get branch | `GET /repos/{fork}/branches/upstream` (404 → missing) |
| Create branch | `POST /repos/{fork}/git/refs` body `{ ref: "refs/heads/upstream", sha }` |
| Update branch (force) | `PATCH /repos/{fork}/git/refs/heads/upstream` body `{ sha, force: true }` |
| Compare | `GET /repos/{fork}/compare/{fork_default}...{parent_owner}:{parent_default}` — `ahead_by` on parent side via status `behind` / `diverged` / `ahead` |
| Create PR (cross-repo) | `POST /repos/{fork}/pulls` with `head` = `{parent_owner}:{parent_default}` and `base` = fork default branch |
| Check mergeable | After create, poll `GET /repos/{fork}/pulls/{n}` for `mergeable` / `mergeable_state` |
| Merge | `PUT /repos/{fork}/pulls/{n}/merge` with `merge_method: "merge"` or `rebase`/`squash` |
| Find existing sync PR | `GET /repos/{fork}/pulls?state=open&base={default}` filter by head repo/ref or title label |

## Auth

* Default `GITHUB_TOKEN` in Actions **cannot** list all user forks reliably across arbitrary parents and often cannot open cross-repo PRs with full rights.
* Use **fine-grained PAT** or classic PAT in secret `GH_PAT`:
  * Classic: `repo` (full private repo access if private forks exist)
  * Fine-grained: Contents R/W, Pull requests R/W, Metadata R on all owned repos (and ability to read parent public repos)
* Do **not** use workflow `GITHUB_TOKEN` alone for this job.

## Recommended merge flow

1. List forks for authenticated user.
2. Skip archived / disabled.
3. Resolve `parent` + parent default branch SHA.
4. Ensure branch `upstream` on fork = parent default SHA (create or force-update).
5. Compare fork default vs parent default.
6. If not behind → record `up_to_date`.
7. If behind / diverged:
   * Find open PR with head `parent:default` into base default, or title marker `chore(sync): upstream`.
   * Else create PR.
   * Wait briefly for `mergeable` (null → retry).
   * `mergeable === true` → merge; status `merged`.
   * `mergeable === false` → leave open; status `conflict`.
8. Aggregate report for email.

## Idempotency

* Title prefix: `chore(sync): merge upstream`
* Body marker: `<!-- fork-sync-bot -->`
* Reuse single open PR per fork base.

## Edge cases

| Case | Behavior |
| --- | --- |
| Parent deleted / inaccessible | error row, skip |
| Private parent without access | error row |
| Default branch renamed | always read live `default_branch` |
| Existing conflict PR | reuse, re-check mergeable |
| Rate limit | paginate + secondary rate limit backoff; user-agent |
| Empty fork | still can open PR from parent |

## Stack recommendation

* Node 20 + plain `fetch` or `@octokit/rest` (prefer Octokit for pagination helpers).
* Single entry: `scripts/fork-sync.js` (or `src/index.js` + package.json).
* Workflow: `schedule` cron daily UTC + `workflow_dispatch`.
* Env: `GH_PAT`, `OUTEMAIL_API_KEY`, optional `OUTEMAIL_BASE_URL`, `REPORT_TO`.

## Out of research scope

* Conflict auto-resolve
* Org-wide multi-owner matrix (can add `GITHUB_OWNER` later)
