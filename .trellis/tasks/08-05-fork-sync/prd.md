# fork-sync 邮件仅保留中文发送 + When 列增加上海时区

## Goal

fork-sync 的 HTML 邮件报告目前支持 `REPORT_LOCALE` 切换中/英。改为**仅中文**：删除英文 locale 与切换开关，邮件恒为中文。同时报告「E · 最近 24 小时工作流」的 When（时间）列在 UTC 之外**新增上海时区（UTC+8）**显示。

## Requirements

1. 邮件报告移除英文支持，只保留中文（zh-CN）。
2. 移除 `REPORT_LOCALE` 环境变量 / Workflow Variable / README 说明。
3. `report.mjs` 中 runs 表的 When 列，每个单元格同时显示 UTC 与上海（Asia/Shanghai, UTC+8）两个时间。
4. 相应列标题由「时间 (UTC)」调整为体现两种时区（如「时间 (UTC / 上海)」）。

## Acceptance Criteria

- [ ] 不再存在 `en.mjs` 英文 locale 文件；`locales/index.mjs` 只导出 `zh`，无 `getLocale()`。
- [ ] `config.mjs` 不再读取/归一化 `REPORT_LOCALE`；`getRuntimeConfig()` 返回对象不含 `reportLocale`。
- [ ] `scripts/fork-sync.mjs` 直接使用 `zh` locale，日志与 SUMMARY 不再输出 `reportLocale`。
- [ ] `.github/workflows/fork-sync.yml` 不再设置 `REPORT_LOCALE`。
- [ ] README Fork Sync 部分移除 `REPORT_LOCALE` 变量行与英文相关说明。
- [ ] 报告 When 单元格展示 UTC 与上海两个时间；标题含两种时区。
- [ ] `node scripts/fork-sync.mjs --dry-run`（带 GH_PAT）能正常生成中文报告，无引用错误。

## Definition of Done

- 语法/导入无错误（`node --check` 或 dry-run 通过）。
- spec `backend/fork-sync-contracts.md` 同步更新：移除双语/`REPORT_LOCALE`/`en` locale 契约，补充 When 列上海时区。
- 无残留英文 locale 引用（grep 验证）。
- 日志与邮件正文仍不含任何密钥。

## Technical Approach

### 中文唯一化

- 删除 `scripts/lib/fork-sync/email/locales/en.mjs`。
- `locales/index.mjs`：删除 `getLocale()`，仅 `export { zh }`（保留 `zh` 作为默认）。
- `config.mjs`：删除 `normalizeReportLocale`、`REPORT_LOCALE` env 读取及 `reportLocale` 字段；同步更新文件头 env 注释。
- `scripts/fork-sync.mjs`：`import { zh } from .../locales/index.mjs`，`buildHtmlReport`/`buildSubject` 直接传 `zh`；移除 `reportLocale` 于启动 log 与 SUMMARY；更新文件头注释。
- `.github/workflows/fork-sync.yml`：删除 `REPORT_LOCALE` env 行。
- README：删除变量表 `REPORT_LOCALE` 行、「邮件语言可切换」说明，改为仅中文。

### When 列上海时区

- `report.mjs` runs 表 When 单元格（现为 `YYYY-MM-DD HH:MM:SSZ`）改为同时输出 UTC 与上海时间，上下两行堆叠（`<div>`）。
- 上海时间用 `Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", ... })` 计算（Node 20 原生支持，China 无 DST，但用 Intl 保证语义正确）。
- 列标题由 locale 的 `whenUtc: "时间 (UTC)"` 改为 `"时间 (UTC / 上海)"`（`zh.mjs` 内更新）。

## Decision (ADR-lite)

**Context**: 邮件报告默认已是中文，双语开关无人使用，用户要求只保留中文；同时希望 When 列补充上海时区便于本地阅读。
**Decision**: 移除英文 locale 与 `REPORT_LOCALE` 全链路（代码/配置/Workflow/README/spec），报告恒为中文；When 单元格 UTC 与上海双时区堆叠显示。
**Consequences**: 无法再发送英文报告（如需恢复需重新加回 locale）；邮件变宽但仍在 600px 模板内。上海 = UTC+8 固定偏移，无需处理夏令时。

## Out of Scope

- 报告头部 `startedAt` 时间戳、邮件 subject 日期改为上海时区（仅当用户要求时再纳入）。
- 不新增测试框架/单元测试（仓库无测试设施）。
- 不改动 GitHub 同步逻辑与 outemail 发送逻辑。

## Technical Notes

- 涉及文件：
  - `scripts/lib/fork-sync/email/locales/{en.mjs(删), zh.mjs, index.mjs}`
  - `scripts/lib/fork-sync/config.mjs`
  - `scripts/lib/fork-sync/email/report.mjs`
  - `scripts/fork-sync.mjs`
  - `.github/workflows/fork-sync.yml`
  - `README.md`
  - `.trellis/spec/backend/fork-sync-contracts.md`
- Node ≥20，`Intl.DateTimeFormat` 的 `timeZone` 选项可用。
- 仓库无测试设施（package.json 仅 fork-sync / fork-sync:dry 脚本）。
