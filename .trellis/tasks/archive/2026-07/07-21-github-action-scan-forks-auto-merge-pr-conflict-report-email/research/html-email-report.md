# Research: HTML email report for fork-sync

## Delivery

* `POST https://tts.chloemlla.com/api/outemail/send`
* Headers: `Authorization: Bearer ${OUTEMAIL_API_KEY}`, `Content-Type: application/json`
* Body: `{ to, subject, content, from?, displayName? }`
* `content` = full HTML string
* Recipient default: `happyclovo@gmail.com`
* Optional: `from: "noreply"`, `displayName: "Fork Sync Bot"`

## HTML email constraints

* Prefer **table layout** + **inline styles** (Gmail strips `<style>` inconsistently).
* Max width ~600px.
* Web-safe fonts: `-apple-system, Segoe UI, Helvetica, Arial, sans-serif`.
* Avoid JS, external CSS, complex flex/grid as sole layout.
* Use absolute `https://` links for repo/PR URLs.
* Provide simple plain-text fallback only if API supports it (this API is HTML-only → HTML must stand alone).

## Structure (recommended)

1. **Header**: title + run time (UTC) + GitHub login
2. **Stats row** (4–6 cells): Scanned / Merged / Conflict / PR open / Upstream created / Errors
3. **Conflict section** (first, red accent): table of repo, PR link, note
4. **Merged section** (green): repo, PR link, merge method
5. **Upstream created** (blue)
6. **Up to date** (collapsed summary count or short list)
7. **Errors** (orange): repo + message (no tokens)
8. **Footer**: workflow run URL if available (`GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`/`GITHUB_RUN_ID`)

## Visual tokens

* BG page: `#0f1419` or light `#f6f8fa` — pick **light** for Gmail readability (recommended default light).
* Conflict: `#cf222e` border/badge
* Success: `#1a7f37`
* Muted text: `#656d76`
* Cards: white / `#ffffff`, border `#d0d7de`, radius 8px via table cells padding

## Subject lines

* Always: `[Fork Sync] 2026-07-21 — M merged, C conflicts, E errors`
* If all clean: `[Fork Sync] 2026-07-21 — all up to date (N forks)`
* If hard fail: `[Fork Sync] FAILED — ...`

## Node approach

* Template literals only — no MJML/react-email dependency for MVP.
* Escape HTML in user/repo names (`& < > "`).
* Build sections with small helper `row()`, `badge()`, `stat()`.

## Security

* Never include PAT, outemail key, or Authorization headers.
* Truncate error messages that might echo request URLs with tokens.
* Links only to `github.com` / known hosts.

## Send policy (recommended)

* **Always send** a summary email after each run (including all up-to-date), so silent schedule failures are visible.
* Optional env `EMAIL_ONLY_ON_CHANGES=true` later — out of MVP unless needed.
