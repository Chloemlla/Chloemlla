/** Chinese (zh-CN) locale strings for fork-sync HTML email report. */
export const zh = {
  lang: "zh-CN",
  title: "Fork 同步报告",
  dryRunSuffix: " · 演练模式",
  scannedUnit: (n) => `${n} 个 fork 已扫描`,
  stats: {
    scanned: "已扫描",
    merged: "已合并",
    conflicts: "冲突",
    upstreamCreated: "新建 upstream",
    upToDate: "已是最新",
    errorsSkipped: "错误 / 跳过",
  },
  sections: {
    upstream: "A · 新建 upstream",
    conflicts: "B · 冲突 / PR 待处理",
    merged: "C · 已合并",
    errors: "D · 错误 / 跳过",
    runs: "E · 最近 24 小时工作流",
  },
  columns: {
    repository: "仓库",
    parent: "上游",
    forkParentDefault: "Fork / 上游默认分支",
    branches: "分支",
    statuses: "状态",
    sha: "SHA",
    note: "备注",
    pr: "PR",
    compare: "对比",
    whenUtc: "时间 (UTC / 上海)",
    title: "标题",
    status: "状态",
    conclusion: "结论",
    link: "链接",
  },
  allUpToDate: (n) => `全部 ${n} 个 fork 已是最新，无需操作。`,
  noRuns: "最近 24 小时内未找到工作流运行（或非 Actions 环境不可用）。",
  footer: "由 chloemlla fork-sync 生成。",
  currentRun: "本次工作流运行",
  subject: {
    failed: (day, errors, n) =>
      `[Fork 同步] 失败 — ${day}（${errors} 个错误，${n} 个 fork）`,
    allClean: (day, n) => `[Fork 同步] ${day} — 全部已是最新（${n} 个 fork）`,
    summary: (day, merged, conflicts, errors) =>
      `[Fork 同步] ${day} — 已合并 ${merged}，冲突 ${conflicts}，错误 ${errors}`,
  },
};
