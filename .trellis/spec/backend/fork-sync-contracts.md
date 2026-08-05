# Fork Sync Contracts

> Executable contracts for the account-level fork scanner: modular Node entry, GitHub sync PR flow, Happy-TTS outemail HTML report, and Chinese-only locale.

## Scenario: Fork Sync report + modular entry

### 1. Scope / Trigger

- Trigger: Action/script env wiring, outemail API contract, modular layout under `scripts/lib/fork-sync/`, and Chinese-only HTML report.
- Applies to `scripts/fork-sync.mjs`, `scripts/lib/fork-sync/**`, `.github/workflows/fork-sync.yml`, and README Fork Sync section.

### 2. Signatures

- Entry: `node scripts/fork-sync.mjs` (optional CLI flag `--dry-run`).
- Runtime config: `getRuntimeConfig()` → `{ dryRun, ghPat, outemailKey, outemailBase, reportTo, mergeMethod }`.
- Per fork: `processFork(octokit, repo, { dryRun, mergeMethod })` → `ForkResult`.
- Report: `buildHtmlReport(report, locale)`, `buildSubject(results, startedAt, locale)` (locale is the Chinese `zh` object).
- Locale: `locales/index.mjs` exports `zh` only (Chinese-first, no runtime language switch).
- Email: `sendEmail({ baseUrl, apiKey, to, subject, content })` → parsed JSON when `success === true`.
- Outemail HTTP: `POST {OUTEMAIL_BASE_URL}/api/outemail/send` with Bearer key and JSON body `{ to, subject, content, from, displayName }`.

### 3. Contracts

- Env (required unless dry-run noted):
  - `GH_PAT` / `USER_PAT` / `GITHUB_TOKEN` — GitHub PAT (workflow maps `USER_PAT` → `GH_PAT`).
  - `OUTEMAIL_API_KEY` — required when not dry-run.
- Env (optional):
  - `OUTEMAIL_BASE_URL` default `https://tts.chloemlla.com`
  - `REPORT_TO` default `happyclovo@gmail.com`
  - `MERGE_METHOD` default `merge` (`merge` | `squash` | `rebase`)
  - `DRY_RUN=1` or `--dry-run` — no ref writes, no PR create/merge, no email
  - Actions-provided for footer/runs: `GITHUB_SERVER_URL`, `GITHUB_REPOSITORY`, `GITHUB_RUN_ID`
- Module layout (no super-file):
  - `scripts/fork-sync.mjs` — thin orchestrator only
  - `scripts/lib/fork-sync/config.mjs`, `util.mjs`, `process-fork.mjs`
  - `scripts/lib/fork-sync/github/{client,forks,upstream,pr,workflow-runs}.mjs`
  - `scripts/lib/fork-sync/email/{html,report,send}.mjs`
  - `scripts/lib/fork-sync/email/locales/{zh,index}.mjs`
- ForkResult statuses (may combine): `upstream_created`, `upstream_refreshed`, `up_to_date`, `merged`, `conflict`, `pr_open`, `skipped`, `error`
- HTML report: table layout + inline CSS, ~600px; sections A upstream / B conflicts·pr_open / C merged / D errors·skipped / E last 24h workflow runs; E When column shows UTC and Shanghai (Asia/Shanghai, UTC+8) stacked
- All user-visible report/subject strings must come from locale; dynamic values escaped via `escapeHtml`
- Logs + email body must never contain PAT / outemail key / Bearer tokens (`redact`)

### 4. Validation & Error Matrix

| Condition | Behavior |
| --- | --- |
| Missing GH PAT | `process.exit(1)` |
| Invalid `MERGE_METHOD` | `process.exit(1)` |
| Non-dry-run without `OUTEMAIL_API_KEY` | `process.exit(1)` |
| Parent missing / 404 | fork `skipped` (job green) |
| PR create HTTP 422 | fork `skipped` (job green) |
| Merge 405/409 | fork `conflict` (job green) |
| Per-fork unexpected throw | fork `error`, redacted message (job green) |
| Outemail non-JSON / `success !== true` / non-OK | log redacted rich error; **do not** exit 1 |
| Workflow runs API fail | empty E section; warn log; continue |

### 5. Good / Base / Bad Cases

- Good: dry-run with PAT scans forks, builds Chinese HTML subject/body, skips email.
- Good: clean upstream updates create/reuse PR and merge; report lists Merged.
- Good: conflict keeps PR open; Chinese conflict section high-lights with PR link.
- Base: all forks up-to-date → subject “全部已是最新”; still would send email when not dry-run.
- Base: email always Chinese (`zh`); no language switch env.
- Bad: reintroducing a language switch (`REPORT_LOCALE`) or English report strings in `report.mjs`.
- Bad: failing the Action solely because outemail returned 401.
- Bad: logging raw `Authorization` or PAT values.

### 6. Tests Required

- Unit: `buildSubject` / `buildHtmlReport` for `zh` include expected Chinese title and escape `<>&`.
- Unit: `redact` strips `ghp_…`, `github_pat_…`, Bearer, and known env secret values.
- Integration (optional dry-run): `DRY_RUN=1 GH_PAT=… node scripts/fork-sync.mjs` exits 0 and logs SUMMARY.
- Assertion points: soft-fail email path never sets process exit code 1; SUMMARY JSON includes `emailSent`.

### 7. Wrong vs Correct

#### Wrong

```js
// Monolith entry + runtime language switch + fail Action on outemail error
const locale = getLocale(process.env.REPORT_LOCALE); // reintroduced switch
await sendEmail(...); // throw bubbles to main().catch → exit 1
```

#### Correct

```js
const locale = zh; // Chinese-only report
const html = buildHtmlReport({ results, login, startedAt, dryRun, recentRuns }, locale);
const subject = buildSubject(results, startedAt, locale);
try {
  await sendEmail({ baseUrl, apiKey, to, subject, content: html });
} catch (err) {
  logError("email send failed:", redact(err?.message || String(err)));
  // job stays green
}
```
