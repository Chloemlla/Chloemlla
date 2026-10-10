#!/usr/bin/env node
// Re-enable GitHub Actions for every repository owned by an account. Runs locally and in CI
// (`.github/workflows/reenable-actions.yml` runs it on a daily schedule in Chloemlla/Chloemlla).
//
//   node scripts/reenable-actions.mjs                       # every owner repo
//   node scripts/reenable-actions.mjs PiliPlus meatshell    # only these (name or owner/name)
//   node scripts/reenable-actions.mjs --no-scan             # skip the fork-throttle banner scan
//   node scripts/reenable-actions.mjs --dry-run             # report only, no PUT
//   node scripts/reenable-actions.mjs --include-manual      # also re-enable `disabled_manually`
//
// Environment
//   GH_TOKEN / GITHUB_TOKEN    token used by `gh` (needs admin on the repos: repo + workflow)
//   REENABLE_OWNER             account to sweep (default Chloemlla)
//   REENABLE_AUDIT_DIR         where the JSON audit lands (default ./actions-audit)
//
// Why this exists
// ---------------
// GitHub stops running workflows in *forks* that reach a large scale of Actions usage and
// puts this banner on the fork's Actions page:
//
//   "Workflows are not currently being run on this fork due to the scale of GitHub
//    Actions usage. A repository maintainer can choose to re-enable these."
//
// While that is in effect, every push silently produces zero runs, and dispatch is refused
// with HTTP 422 "Actions has been disabled for this repository" — yet
// `GET /repos/{owner}/{repo}/actions/permissions` keeps reporting `enabled: true`, so the
// repo setting is not by itself a reliable read. The only programmatic lever is writing the
// permission back with `PUT /repos/{owner}/{repo}/actions/permissions {enabled: true}`,
// which is what this script does repo by repo (idempotent: 204 even when already enabled).
//
// The banner scan is the honest *read*: it is scraped from the public Actions page, needs no
// token, and is reported per repo as throttled / ok / unknown so the run can say which repos
// were actually being throttled instead of guessing from the write result.
//
// No dependencies: Node ESM + the authenticated `gh` CLI (workspace convention).

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OWNER = process.env.REENABLE_OWNER || "Chloemlla";
const AUDIT_DIR = process.env.REENABLE_AUDIT_DIR || "actions-audit";
const THROTTLE_RE = /Workflows are not currently being run on this fork due to the scale of GitHub Actions usage/i;
const HARD_DISABLED_RE = /Actions (?:are|is|has been) disabled for this repository/i;

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const scan = !argv.includes("--no-scan");
// `disabled_manually` is the owner's own choice, not something GitHub turned off, so it is
// left alone unless asked for. `disabled_fork` / `disabled_inactivity` are GitHub-side.
const includeManual = argv.includes("--include-manual");
const wanted = argv.filter((a) => !a.startsWith("--"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function gh(args, { allowFail = false } = {}) {
  try {
    return { ok: true, out: execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() };
  } catch (error) {
    const out = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    if (!allowFail) throw new Error(`gh ${args.join(" ")} failed: ${out}`);
    return { ok: false, out };
  }
}

function ghJson(args, opts) {
  const r = gh(args, opts);
  if (!r.ok) return null;
  try {
    return JSON.parse(r.out);
  } catch {
    return null;
  }
}

async function scanBanner(fullName) {
  if (!scan) return { state: "skipped" };
  try {
    // curl, not fetch: node's fetch ignores the machine's proxy/fake-IP setup and fails here
    // (verified-methodology §四-9), while curl has been working for these pages all along.
    const html = execFileSync(
      "curl",
      ["-s", "-L", "-A", "Mozilla/5.0 (fork-actions-reenable)", `https://github.com/${fullName}/actions?cb=${Date.now()}`],
      { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    if (!html) return { state: "unknown", detail: "empty body" };
    if (THROTTLE_RE.test(html)) return { state: "throttled" };
    if (HARD_DISABLED_RE.test(html)) return { state: "hard-disabled" };
    return { state: "ok" };
  } catch (error) {
    return { state: "unknown", detail: String(error.message || error).slice(0, 200) };
  }
}

function ownerRepos() {
  const rows = gh([
    "api", "user/repos?per_page=100&affiliation=owner", "--paginate",
    "--jq", '.[] | [.full_name, (.fork|tostring), (.archived|tostring), (.disabled|tostring), .pushed_at] | @tsv',
  ]).out;
  return rows
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [fullName, fork, archived, disabled, pushedAt] = line.split("\t");
      return { fullName, fork: fork === "true", archived: archived === "true", disabled: disabled === "true", pushedAt };
    });
}

// Per-workflow sweep: `disabled_manually` / `disabled_inactivity` workflows are re-enabled too.
// This is a *different* lever from the fork throttle (that one keeps every workflow `active`).
function enableWorkflows(fullName) {
  const out = gh(["api", `repos/${fullName}/actions/workflows`, "--jq", '.workflows[] | [.id, .state, .name] | @tsv'], { allowFail: true });
  const rows = (out.ok ? out.out : "")
    .split("\n")
    .filter(Boolean)
    .map((l) => { const [id, state, name] = l.split("\t"); return { id, state, name }; });
  const enabled = [];
  const skipped = [];
  const failed = [];
  for (const wf of rows) {
    if (wf.state === "active") continue;
    if (wf.state === "disabled_manually" && !includeManual) {
      skipped.push(`${wf.name}(${wf.state})`);
      continue;
    }
    const r = gh(["api", "-X", "PUT", `repos/${fullName}/actions/workflows/${wf.id}/enable`], { allowFail: true });
    if (r.ok) enabled.push(`${wf.name}(${wf.state})`);
    else failed.push(`${wf.name}: ${r.out.slice(0, 120)}`);
  }
  return { total: rows.length, enabled, skipped, failed };
}

function selected(all) {
  if (!wanted.length) return all;
  const lower = wanted.map((w) => w.toLowerCase());
  return all.filter((r) => {
    const short = r.fullName.split("/")[1].toLowerCase();
    return lower.includes(r.fullName.toLowerCase()) || lower.includes(short);
  });
}

const all = ownerRepos();
const repos = selected(all);
console.log(`owner=${OWNER}  仓库总数=${all.length}  本次处理=${repos.length}${dryRun ? "  (dry-run)" : ""}\n`);

const results = [];
for (const repo of repos) {
  const { fullName } = repo;
  const before = ghJson(["api", `repos/${fullName}/actions/permissions`], { allowFail: true });
  const bannerBefore = await scanBanner(fullName);

  let action = "skip";
  let putError = null;
  if (!dryRun) {
    // allowed_actions must be sent along with enabled (the endpoint rejects enabled alone),
    // and it is echoed back from the current state so no other policy field changes.
    const allowed = before?.allowed_actions ?? "all";
    const put = gh(
      ["api", "-X", "PUT", `repos/${fullName}/actions/permissions`, "-F", "enabled=true", "-F", `allowed_actions=${allowed}`],
      { allowFail: true },
    );
    action = put.ok ? "re-enabled" : "PUT-failed";
    if (!put.ok) putError = put.out.slice(0, 300);
  }
  if (action === "re-enabled") await sleep(400);
  const bannerAfter = action === "re-enabled" ? await scanBanner(fullName) : bannerBefore;
  const workflows = dryRun ? { total: null, enabled: [], failed: [] } : enableWorkflows(fullName);

  const row = {
    repo: fullName,
    fork: repo.fork,
    archived: repo.archived,
    pushedAt: repo.pushedAt,
    apiEnabledBefore: before?.enabled ?? null,
    apiAllowedBefore: before?.allowed_actions ?? null,
    bannerBefore: bannerBefore.state,
    action,
    putError,
    bannerAfter: bannerAfter.state,
    workflows,
  };
  results.push(row);
  const flag = row.bannerBefore === "throttled" || row.bannerBefore === "hard-disabled" ? "  <== 被 GitHub 停跑" : "";
  const wfNote = workflows.enabled.length ? `  (启用 workflow: ${workflows.enabled.join(", ")})` : "";
  console.log(
    `${fullName.padEnd(42)} api.enabled=${String(row.apiEnabledBefore).padEnd(5)} banner: ${row.bannerBefore.padEnd(12)} ${action.padEnd(11)} -> ${row.bannerAfter}${flag}${wfNote}`,
  );
  if (!action.startsWith("skip")) await sleep(120);
}

const throttledBefore = results.filter((r) => r.bannerBefore === "throttled" || r.bannerBefore === "hard-disabled");
const stillThrottled = results.filter((r) => r.bannerAfter === "throttled" || r.bannerAfter === "hard-disabled");
const wfEnabled = results.flatMap((r) => (r.workflows?.enabled ?? []).map((w) => `${r.repo} → ${w}`));
const wfSkipped = results.flatMap((r) => (r.workflows?.skipped ?? []).map((w) => `${r.repo} → ${w}`));
console.log(`\n被 GitHub 停跑的仓库（处理前）: ${throttledBefore.length}${throttledBefore.length ? " — " + throttledBefore.map((r) => r.repo).join(", ") : ""}`);
console.log(`仍然停跑的仓库（处理后）:     ${stillThrottled.length}${stillThrottled.length ? " — " + stillThrottled.map((r) => r.repo).join(", ") : ""}`);
console.log(`重新启用的 workflow:          ${wfEnabled.length}${wfEnabled.length ? " — " + wfEnabled.join(", ") : ""}`);
console.log(`按主人意愿跳过的 workflow:     ${wfSkipped.length}${wfSkipped.length ? " — " + wfSkipped.join(", ") : ""}`);
console.log(`扫描失败/未知:                 ${results.filter((r) => r.bannerBefore === "unknown").length}`);
if (stillThrottled.length) {
  console.log(
    "\n注：上面这些仓库的「repo 级 fork 限流」无法用 REST API 清除（实测：permissions PUT 204、workflow enable 204、"
    + "enabled=false→true 的状态迁移也无效，而 dispatch 始终 422、横幅不变）。需要在该仓库 Actions 页点一次 re-enable。",
  );
}

mkdirSync(AUDIT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = join(AUDIT_DIR, `reenable-${stamp}.json`);
writeFileSync(out, JSON.stringify({ owner: OWNER, dryRun, generatedAt: new Date().toISOString(), results }, null, 2), "utf8");
console.log(`\n落盘: ${out}`);
