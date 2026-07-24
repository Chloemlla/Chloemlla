import { env } from "./config.mjs";

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export function redact(text) {
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

export function log(...args) {
  console.log(...args);
}

export function logError(...args) {
  console.error(...args);
}

export async function withRetry(fn, { retries = 3, label = "op" } = {}) {
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

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function hasStatus(r, s) {
  return r.statuses.includes(s);
}

export function countStatus(results, s) {
  return results.filter((r) => hasStatus(r, s)).length;
}

export function runUrl() {
  const server = env("GITHUB_SERVER_URL", "https://github.com");
  const repo = env("GITHUB_REPOSITORY");
  const runId = env("GITHUB_RUN_ID");
  if (repo && runId) return `${server}/${repo}/actions/runs/${runId}`;
  return null;
}
