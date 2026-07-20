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

| 触发 | 说明 |
| --- | --- |
| Cron | `0 6 * * *`（每天 **06:00 UTC**） |
| 手动 | **Actions → Fork Sync → Run workflow** |

### Secrets

| Secret | 说明 |
| --- | --- |
| `USER_PAT` | GitHub PAT（workflow 注入为 `GH_PAT`），需能列 fork / 推分支 / 建并合并 PR |
| `OUTEMAIL_API_KEY` | Happy-TTS **对外邮件外部 API Key**（非 Resend 主密钥） |

可选 Variables：`OUTEMAIL_BASE_URL`（默认 `https://tts.chloemlla.com`）、`REPORT_TO`（默认 `happyclovo@gmail.com`）、`MERGE_METHOD`（默认 `merge`）。

本地：

```bash
npm ci
# dry-run
set DRY_RUN=1   # PowerShell: $env:DRY_RUN=1
node scripts/fork-sync.mjs
# 或
npm run fork-sync:dry
```

详见 workflow：`.github/workflows/fork-sync.yml`，脚本：`scripts/fork-sync.mjs`。
