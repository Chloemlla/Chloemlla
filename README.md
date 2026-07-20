# Fork Sync Bot

Daily GitHub Action that scans **your account’s fork repositories**, keeps an `upstream` branch pointer in sync with the parent default tip, opens (or reuses) a sync PR when the parent is ahead, **auto-merges clean PRs**, and emails an HTML summary of conflicts and results.

## What it does

For each non-archived fork owned by the authenticated user:

1. **Ensure `upstream` branch** — create if missing; every run force-points it at the parent’s default-branch tip.
2. **Compare** parent default → fork default.
3. If the parent has new commits: **find or create** a PR  
   `head: {parent_owner}:{parent_default}` → `base: {fork_default}`.
4. Poll `mergeable`:
   - **true** → merge with method `merge` (merge commit).
   - **false** → leave the PR open and highlight it in the email.
   - still unknown after retries → treat as open/conflict-class in the report.
5. **Always send** an HTML email report (unless dry-run).

PR identity (idempotent):

- Title: `chore(sync): merge upstream`
- Body marker: `<!-- fork-sync-bot -->`

## Schedule

| Trigger | When |
| --- | --- |
| Cron | `0 6 * * *` (daily **06:00 UTC**) |
| Manual | **Actions → Fork Sync → Run workflow** (`workflow_dispatch`) |

Manual runs can set **Dry run** to `true` (no branch writes, no PR create/merge, no email).

## Required secrets

Configure under **Settings → Secrets and variables → Actions**:

| Secret | Required | Description |
| --- | --- | --- |
| `USER_PAT` | **Yes** | GitHub personal access token (wired into the job as `GH_PAT`). Needed for listing owned forks and opening cross-repo PRs. |
| `OUTEMAIL_API_KEY` | **Yes** | Happy-TTS **对外邮件外部 API Key**（EnvManager「对外邮件 API 鉴权」/`OUTEMAIL_API_KEY`），**不是** Resend 的 `re_…` 主密钥。也可用旧 `code`，但本脚本只用 Bearer API Key。 |

### `USER_PAT` permissions

**Classic PAT**

- Scope: `repo` (full private access if you have private forks)

**Fine-grained PAT**

- Resource owner: your user
- Repository access: all repositories you own (or every fork you want synced)
- Permissions:
  - **Contents**: Read and write (create/update `upstream` ref)
  - **Pull requests**: Read and write (create / merge)
  - **Metadata**: Read
- Must be able to **read** public (or accessible) parent repositories

> Do **not** rely on the default workflow `GITHUB_TOKEN` alone — it cannot reliably list all user forks or open cross-repo sync PRs.

## Optional variables

Repository **Variables** (or override in the workflow env):

| Name | Default | Description |
| --- | --- | --- |
| `OUTEMAIL_BASE_URL` | `https://tts.chloemlla.com` | Outemail API origin (no trailing path) |
| `REPORT_TO` | `happyclovo@gmail.com` | Report recipient |
| `MERGE_METHOD` | `merge` | `merge` \| `squash` \| `rebase` |

Environment flags (local or workflow):

| Name | Default | Description |
| --- | --- | --- |
| `DRY_RUN` | `0` | Set to `1` to scan only: no ref writes, no PR create/merge, no email |
| `GH_PAT` / `USER_PAT` | — | Required (workflow maps `USER_PAT` → `GH_PAT`; script also accepts `GITHUB_TOKEN`) |
| `OUTEMAIL_API_KEY` | — | Required unless `DRY_RUN=1` |

## Email report

- API: `POST {OUTEMAIL_BASE_URL}/api/outemail/send`
- HTML body (~600px table layout, inline styles)
- Sent **on every run** (including all up-to-date), so silent schedule failures are visible

### Stats / sections

| Stat | Meaning |
| --- | --- |
| Scanned | Forks processed |
| Merged | Auto-merged sync PRs |
| Conflicts | Unmergeable + mergeable-unknown open PRs |
| Upstream+ | `upstream` branch created this run |
| Up to date | No parent updates needing a PR |
| Errors | Hard failures / skipped (no parent, etc.) |

Conflict and open-PR rows are listed first (red accent) with repository and PR links. Logs and email content never include tokens.

### Per-fork status values

| Status | Meaning |
| --- | --- |
| `upstream_created` | Created `upstream` this run |
| `upstream_refreshed` | Force-updated `upstream` tip |
| `up_to_date` | Parent has nothing new for the fork default |
| `merged` | Sync PR auto-merged |
| `conflict` | PR open and not mergeable |
| `pr_open` | PR open; mergeable still unknown (or dry-run would-create) |
| `skipped` | No parent / create PR 422 / similar |
| `error` | Unexpected API or processing error |

## Local usage

```bash
npm install
```

**Dry run** (recommended first):

```bash
# cross-platform via flag
npm run fork-sync:dry

# or via env (Unix)
DRY_RUN=1 GH_PAT=ghp_xxx node scripts/fork-sync.mjs

# PowerShell
$env:DRY_RUN="1"; $env:GH_PAT="ghp_xxx"; node scripts/fork-sync.mjs
```

**Live run** (writes refs / PRs and sends email):

```bash
# Unix
GH_PAT=ghp_xxx OUTEMAIL_API_KEY=xxx node scripts/fork-sync.mjs

# PowerShell
$env:GH_PAT="ghp_xxx"
$env:OUTEMAIL_API_KEY="xxx"
# optional: $env:REPORT_TO="you@example.com"
node scripts/fork-sync.mjs
```

## Manual dispatch (GitHub UI)

1. Add secrets `GH_PAT` and `OUTEMAIL_API_KEY`.
2. Open **Actions → Fork Sync**.
3. **Run workflow** (optionally choose Dry run = `true`).
4. Check the job log for `SUMMARY {…}` and your inbox for the HTML report.

## Project layout

```text
package.json
package-lock.json
scripts/fork-sync.mjs          # single entry
.github/workflows/fork-sync.yml
README.md
.gitignore
```

## Security notes

- Secrets only via environment / Actions secrets — never hard-coded.
- Error messages are redacted (PAT patterns + env value scrubbing).
- Email HTML contains only repo/PR URLs and status text — no keys.

## Out of scope

- Automatic conflict resolution
- Org / non-fork scanning
- Multi-recipient mail or attachments
- Using only default `GITHUB_TOKEN`
