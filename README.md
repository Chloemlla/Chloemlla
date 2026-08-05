<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Chloemlla/Chloemlla/output/github-snake.svg" />
  <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/Chloemlla/Chloemlla/output/github-snake.svg" />
  <img alt="github-snake" src="https://raw.githubusercontent.com/Chloemlla/Chloemlla/output/github-snake.svg" />
</picture>

擅长使用 **Kotlin** 与 **TypeScript** 进行开发，同时熟悉 **Go**、**Java**、**JavaScript** 和 **Python**，习惯在不同语言之间按需切换。

</div>

## 🔧 Tech Stack

![Kotlin](https://img.shields.io/badge/Kotlin-7F52FF?style=for-the-badge&logo=kotlin&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Go](https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=go&logoColor=white)
![Java](https://img.shields.io/badge/Java-ED8B00?style=for-the-badge&logo=openjdk&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)

![Gradle](https://img.shields.io/badge/Gradle-02303A?style=for-the-badge&logo=gradle&logoColor=white)
![Go Modules](https://img.shields.io/badge/Go_Modules-00ADD8?style=for-the-badge&logo=go&logoColor=white)
![npm](https://img.shields.io/badge/npm-CB3837?style=for-the-badge&logo=npm&logoColor=white)
![pnpm](https://img.shields.io/badge/pnpm-F69220?style=for-the-badge&logo=pnpm&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)
![Docusaurus](https://img.shields.io/badge/Docusaurus-3ECC5F?style=for-the-badge&logo=docusaurus&logoColor=white)
![Task](https://img.shields.io/badge/Task-29BEB0?style=for-the-badge&logo=task&logoColor=white)
![Git](https://img.shields.io/badge/Git-F05032?style=for-the-badge&logo=git&logoColor=white)

## 📊 Language Stats

<div align="center">

![](https://github-profile-summary-cards.vercel.app/api/cards/repos-per-language?username=Chloemlla&theme=tokyonight)
![](https://github-profile-summary-cards.vercel.app/api/cards/most-commit-language?username=Chloemlla&theme=tokyonight)

</div>

---

## 🤖 Fork Sync Bot（本仓库自动化）

每日扫描账号下 **fork**，维护 `upstream` 分支，在上游有更新时开 PR；无冲突自动 merge，有冲突保留 PR，并通过 Happy-TTS 对外邮件发送 HTML 报告。

入口脚本：`scripts/fork-sync.mjs`（薄编排层）。实现模块在 `scripts/lib/fork-sync/`（GitHub API、per-fork 处理、邮件 HTML / 中文 locale、outemail 发送）。

| 触发 | 说明 |
| --- | --- |
| Cron | `0 6 * * *`（每天 **06:00 UTC**） |
| 手动 | **Actions → Fork Sync → Run workflow**（可勾选 dry-run） |

### Secrets

| Secret | 说明 |
| --- | --- |
| `USER_PAT` | GitHub PAT。Workflow 映射：`GH_PAT: ${{ secrets.USER_PAT }}`。需能列 fork、读写 Contents（`upstream` 分支）、读写 Pull requests，以及读 Actions 工作流 runs（邮件「最近 24h」区块）。 |
| `OUTEMAIL_API_KEY` | Happy-TTS **对外邮件外部 API Key**（EnvManager「对外邮件 API 鉴权」），**不是** Resend `re_…` 主密钥；脚本仅用 `Authorization: Bearer <key>`。 |

可选 Variables：

| Variable | 默认 | 说明 |
| --- | --- | --- |
| `OUTEMAIL_BASE_URL` | `https://tts.chloemlla.com` | 对外邮件 API 根地址 |
| `REPORT_TO` | `happyclovo@gmail.com` | 报告收件人 |
| `MERGE_METHOD` | `merge` | PR 合并方式：`merge` / `squash` / `rebase` |

### 邮件报告

- 邮件固定为 **中文（zh）**
- 每次运行都会发 HTML 汇总（含全部 up-to-date）
- 统计：已扫描 / 已合并 / 冲突 / 新建 upstream / 已是最新 / 错误·跳过
- 分区：**A** 新建 upstream → **B** 冲突 / PR 待处理 → **C** 已合并 → **D** 错误 / 跳过 → **E** 最近 24 小时工作流（本仓库 `fork-sync.yml`）
- 「最近 24 小时工作流」时间列同时显示 UTC 与上海（UTC+8）时间
- 日志与邮件正文不含任何密钥

本地：

```bash
npm ci
# dry-run
set DRY_RUN=1   # PowerShell: $env:DRY_RUN=1
# 也可用 USER_PAT 代替 GH_PAT
node scripts/fork-sync.mjs
# 或
npm run fork-sync:dry
```

详见 workflow：`.github/workflows/fork-sync.yml`，入口：`scripts/fork-sync.mjs`，模块：`scripts/lib/fork-sync/`。
