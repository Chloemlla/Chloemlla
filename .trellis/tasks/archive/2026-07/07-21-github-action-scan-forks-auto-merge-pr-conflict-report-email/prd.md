# GitHub Action: scan forks, auto merge-PR, conflict report + email

## Goal

用 **Node.js 脚本 + GitHub Actions** 定时扫描当前登录账号下的 **fork** 仓库：确保存在名为 `upstream` 的分支（缺失则按 parent 默认分支 tip 创建并每次强制刷新），当 parent 默认分支相对 fork 默认分支有更新时，创建（或复用）同步 PR；**无冲突自动 merge，有冲突保留 PR 并在精美 HTML 邮件中高亮**，经 Happy-TTS 对外邮件 API 发到 `happyclovo@gmail.com`。

## Confirmed / Recommended Decisions

| 主题 | 决定 | 来源 |
| --- | --- | --- |
| 技术栈 | Node 20 + `@octokit/rest` + 原生 `fetch` 发邮件；单入口脚本 | 推荐 |
| `upstream` 角色 | 准入 + 镜像指针：缺失则创建；每次处理强制指向 parent 默认 tip | 用户 + 推荐 |
| 真正同步 | **parent 默认分支 → fork 默认分支** 的 PR | 用户 |
| 无冲突 | **自动 merge**（`merge` 方法） | 用户 |
| 有冲突 | **只建/保留 PR + 邮件高亮**，不 merge | 用户 |
| 扫描范围 | **当前 PAT 对应用户** 的 fork（`type=owner` 分页）；暂不扫 org | 推荐 |
| 定时 | **每天 UTC 06:00** + `workflow_dispatch` | 推荐 |
| 邮件发送 | **每次运行都发**汇总（含全部 up-to-date） | 推荐 |
| 幂等 PR | 标题 `chore(sync): merge upstream` + body 标记 `<!-- fork-sync-bot -->`；复用同 base 的 open PR | 推荐 |
| Auth | Secrets：`GH_PAT`（repo）、`OUTEMAIL_API_KEY`；可选 `OUTEMAIL_BASE_URL` / `REPORT_TO` | 推荐 |
| 收件人 | 默认 `happyclovo@gmail.com` | 用户 |
| 邮件 API | `POST https://tts.chloemlla.com/api/outemail/send`，Bearer，HTML `content` | 用户文档 |

## Requirements

1. **Workflow** `.github/workflows/fork-sync.yml`
   * `schedule: cron: '0 6 * * *'`
   * `workflow_dispatch`
   * Node 20，`npm ci`（或 `npm install` 若无 lock 首次生成）
   * 注入 env：`GH_PAT`、`OUTEMAIL_API_KEY`、可选覆盖项
2. **脚本** `scripts/fork-sync.mjs`（或 `package.json` + `src/index.js`）
   * 用 `GH_PAT` 列出当前用户 fork（分页，过滤 `fork===true`，跳过 archived）
   * 解析 parent、parent/fork 的 `default_branch`
   * **Ensure `upstream`**：不存在则 `POST git/refs`；存在则 `PATCH` force 到 parent default SHA
   * **Compare**：fork default vs `parent_owner:parent_default`
   * 若 behind/diverged：查找/创建同步 PR（cross-repo head）
   * 轮询 `mergeable`；true → merge；false → conflict 记录
   * 汇总结果对象，渲染 HTML，调用 outemail 发送
3. **HTML 报告**（inline CSS + table，约 600px）
   * 统计卡：Scanned / Merged / Conflicts / Upstream created / Up-to-date / Errors
   * 冲突区置顶高亮（红）
   * Merged / Created upstream / Errors 分表
   * 含 PR 链接、仓库链接、运行时间；**不含任何密钥**
4. **README**
   * Secrets 配置、权限说明、如何手动触发、报告字段说明
5. **安全**
   * 密钥仅环境变量；日志脱敏；邮件正文无 token

## Per-fork status enum

* `upstream_created` — 本次新建了 `upstream`
* `upstream_refreshed` — 强制更新了 `upstream` tip（可与其它状态并存于细节）
* `up_to_date` — 无需 PR
* `merged` — 已自动合并
* `conflict` — 有 PR 且不可 merge
* `pr_open` — 建了 PR 但 mergeable 仍未知（超时）→ 按冲突类高亮
* `skipped` — 无 parent / 不可访问等
* `error` — 异常信息

## Acceptance Criteria

* [ ] `workflow_dispatch` 可在配置 Secrets 后跑通
* [ ] 无 `upstream` 时自动创建并指向 parent default tip
* [ ] 每次运行 force 刷新 `upstream` 到 parent default tip
* [ ] 上游有更新时创建或复用同步 PR
* [ ] 无冲突自动 merge
* [ ] 有冲突保留 PR，邮件冲突区高亮且含链接
* [ ] 每次运行向 `happyclovo@gmail.com` 发送 HTML 汇总（API success）
* [ ] 日志与邮件无 `GH_PAT` / `OUTEMAIL_API_KEY`
* [ ] README 说明 Secrets 与用法

## Definition of Done

* 脚本 + workflow + package 依赖可提交
* README 完整
* 无密钥硬编码
* 本地可 dry-run 文档说明（可选 env `DRY_RUN=1` 跳过写操作与发信——推荐实现）

## Technical Approach

```
Action runner
  → node scripts/fork-sync.mjs
      → Octokit(auth: GH_PAT)
      → list forks → for each:
          ensureUpstream(parentDefaultSha)
          compare → maybe create/reuse PR → maybe merge
      → buildHtml(report)
      → fetch(OUTEMAIL)/send
```

**Cross-repo PR**: `POST /repos/{fork_owner}/{fork}/pulls` with  
`head: "{parent_owner}:{parent_default}"`, `base: "{fork_default}"`.

**Merge method**: `merge`（保留 merge commit，清晰标记同步历史）。

**Rate limit**: 分页 100；连续请求间无需强 sleep；遇 403 secondary 指数退避。

## Decision (ADR-lite)

**Context**: 用户要账号级 fork 自动跟上上游，冲突可见，结果邮件通知。  
**Decision**: JS Action + PAT；`upstream` 作镜像指针并强制刷新；parent→fork default PR；clean auto-merge；conflict 保留 PR；每次发 HTML 邮件。  
**Consequences**: 需要维护 PAT；force 更新 `upstream` 会改写该分支历史（仅该分支）；公开 parent 的 cross-repo PR 在 GitHub 原生支持。

## Out of Scope

* 自动解决代码冲突
* 扫描 org 成员仓 / 非 fork
* 多收件人、附件、MJML 构建链
* 前端 UI
* 用默认 `GITHUB_TOKEN` 替代 PAT

## Repo layout (to create)

```text
package.json
package-lock.json          # npm install 后生成
scripts/fork-sync.mjs
.github/workflows/fork-sync.yml
README.md
.gitignore                 # 已有，可补 node_modules
```

## Secrets / Env

| Name | Required | Description |
| --- | --- | --- |
| `GH_PAT` | yes | Classic `repo` 或 fine-grained Contents+PR+Metadata |
| `OUTEMAIL_API_KEY` | yes | Happy-TTS 对外邮件 Key |
| `OUTEMAIL_BASE_URL` | no | 默认 `https://tts.chloemlla.com` |
| `REPORT_TO` | no | 默认 `happyclovo@gmail.com` |
| `DRY_RUN` | no | `1` 时只扫描报告，不写 ref / 不建 PR / 不发信 |

## Research References

* [`research/github-fork-sync.md`](research/github-fork-sync.md) — API、权限、幂等 PR、边界
* [`research/html-email-report.md`](research/html-email-report.md) — 邮件 HTML 结构与发送约定
* 外部文档：`Happy-TTS/docs/outemail-api-rust.md`

## Implementation Plan (single PR in this repo)

1. `package.json` + `scripts/fork-sync.mjs`（核心逻辑 + HTML + 邮件）
2. `.github/workflows/fork-sync.yml`
3. `README.md` + `.gitignore` 补充 `node_modules`
