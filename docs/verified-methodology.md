# 已验证方法论手册

> 本文件整理在 NexAI 与 Project-Lumen 两个仓库的批量缺陷审查/修复任务中**完整验证过**的流程与技巧。凡标"已验证"的条目，均在此类任务中实际执行并产生过正确结果。

- 适用仓库：Android/Kotlin、Flutter/Dart 等一切由 GitHub Actions 负责构建的仓库；§十（md→docx + Word 宏）与 §十二（本机批量解压改名）是**本机 Windows 文档/文件批处理**，与仓库构建无关
- 验证来源：`F:\Repositories\GitHub\NexAI`、`F:\Repositories\GitHub\Project-Lumen`（2026-08，`ui` 分支）；fork 同步流程（§七）另验证于 `LibChecker`、`SyncClipboard`、`EcoEnchants`（2026-08-29）；远程服务器运维（§八）另验证于湖北服务器（MeatShell MCP，2026-08-29、2026-08-30、2026-09-02、2026-09-03）；CI check-runs 轮询判定与编译错定位（§五-36/37）另验证于 `Happy-TTS`（TypeScript/Node，2026-09-06）；上游无 PR CI 合并不可编译代码与 `Ref<T>::clone`（§五-38）、`(req as any)` 隐藏类型形状（§五-39）、定时 job 历史归因（§五-40）另验证于 `Chloemlla/meatshell`（Rust/Slint）与 `Happy-TTS`（2026-09-12）；本机批量解压与按规则改名（§十二）验证于本机微信文件目录，两轮共 41 个 zip / 94 个条目（2026-09-13）；镜像 bare-require 解析扫描与合并解冲突归因（§五-41）验证于 `SynapticArch/LibreChat`（2026-09-13）
- 关联记忆：`feedback-nexai-workflow`、`win-git-push-credential-fix`、`fork-upstream-sync-conflict-workflow`、`hubei-server-env`、`hubei-deployment-topology`、`hubei-mongodb-replica-set-fix`、`newapi-checkin-hubei-deploy`
- 配套文档：`code-audit-methodology.md`（漏洞与错误代码审计——"审什么、找什么"；本文档是"怎么执行、怎么验证"）

---

## 一、核心原则（已逐条验证）

| # | 原则 | 原因 |
|---|---|---|
| 1 | **禁止本地构建/测试/安装依赖** | 本地机器性能不足；一切构建、测试、lint 只由 GitHub Actions 执行 |
| 2 | **并行 subagent 分组审查/实现，各组可修改文件两两不相交** | 避免并发冲突；每组一个 subagent，只允许编辑指定文件 |
| 3 | **收到每个 subagent 结果后逐份核查 `git diff` 才采信** | 曾发生 agent 报告"完成"但实际未落盘任何修改；也发生过"改完但带编译错误" |
| 4 | **直接修改代码，不做 diff 预览** | 用户明确纠正过：要真实编辑，不是贴改动预览 |
| 5 | **修完自动生成 commit message 并 commit + push** | 仓库 CLAUDE.md 硬性要求；**优先 GPG 签名提交**（`git commit -S`），仅当签名失败或 pinentry 卡住时才退回 `--no-gpg-sign` |
| 6 | **静态命令检查为主，最终正确性以 CI 为准** | 静态检查抓不到运行时/编译问题，GitHub Actions 才是唯一裁决者 |
| 7 | **上下文足够时直接分派 subagent 落盘改代码，且禁止用 `fork` 形式** | 已读过相关代码、缺陷与改法明确时不必自己逐个 Edit，派并行 subagent 直接写文件更快；但用户明确要求**不要用 `subagent_type: "fork"`**（fork 继承主对话的全部记录），改用独立 fresh agent（`general-purpose` / `claude`）+ 自包含提示词 |
| 8 | **审查发现的所有问题，必须先落盘成一份本地汇总文档，再进入修复** | 修复要对"症"，前提是有一份带细节的完整清单：每条含唯一编号、文件+行号、缺陷类型、详细错误信息、建议改法。否则修复靠记忆发散、易漏项，收尾也无从逐条核对（2026-09-06 用户要求新增并固化） |

---

## 二、完整工作流

### 阶段 0：准备
1. 先读仓库 `CLAUDE.md` / `AGENTS.md`，确认：工作分支、是否禁本地构建、commit/push 要求、特殊编码约定。
2. 确认 git 凭证可用（见 §三）。
3. `git status` 确认工作树干净、当前分支正确。
4. 建任务清单（TaskCreate），把"审查、分组修复、CI 验证"拆成任务跟踪。

### 阶段 1：并行审查
1. 按模块/包将仓库切成 N 个**不相交**文件组（如：核心架构组、数据层组、服务组、安全组、UI 组…）。
2. 对每组派一个并行 subagent，提示词写明：
   - 只允许编辑指定文件清单（两两不相交）
   - 禁止运行任何命令（构建/测试/lint）
   - 逐行读文件找缺陷（线程安全、主线程阻塞、资源泄漏、竞态、空指针、越界等）
   - 完成后报告：改了哪些文件、每个改动的原因
3. 每收到一个结果，**立刻 `git diff` 核查**：改动是否真实落盘、是否符合原因描述、有无语法/结构错误。
4. **全部 subagent 收齐、逐份 diff 核查完毕后，先落盘一份本地缺陷汇总文档，再进入阶段 2**（2026-09-06 用户要求固化：修复要对症，必先有带细节的完整清单）：
   - 路径：仓库内 `docs/audit-<YYYY-MM-DD>.md`；清单需放仓库外的任务沿用 `.audit-reports/`（Aura 审计先例）
   - 每条缺陷一条，字段：**唯一编号**（修复与收尾按编号追溯）、文件路径+行号、缺陷类型（线程安全/资源泄漏/竞态/空指针/越界/编译错/跨平台等）、**详细错误信息**（症状、根因、复现条件，能支撑对症改法）、建议改法
   - 依据 = 各 subagent 报告 + 协调者的 diff 核查记录，宁可细不可粗，不写"没问题/全部通过"式空话
   - 写完把清单与全部改动对一遍：任何被改处都能指回一条编号；任何一条都有去向（已修或挂起理由），缺口当场补齐

### 阶段 2：修复
1. 按缺陷类型合理分组，一次修一批，避免碎片化提交。分组与每条改法以阶段 1 落盘的汇总文档为唯一依据（按编号追踪），不凭记忆从零重读已审文件。
2. **上下文足够时直接分派并行 subagent 落盘修改**，不用"agent 只审查、协调者再逐个 Edit"这条弯路。"上下文足够"指：相关文件已读过、缺陷位置与期望改法明确、各组可编辑文件两两不相交。
   - **禁止 `subagent_type: "fork"`**（用户明确要求）：fork 继承主对话的全部记录，起不到隔离作用。一律用独立 fresh agent（`general-purpose` / `claude`）。
   - fresh agent 零上下文 ⇒ 提示词必须自包含：仓库绝对路径、允许编辑的文件清单（两两不相交）、缺陷描述与期望改法、禁止运行构建/测试/lint、禁止 commit/push（提交只由协调者做）。
   - 采信仍以 `git diff` 为准，不等它的报告（坑 1、坑 9）。
3. 协调者自己动手时用 Edit 工具真实改代码（不是贴改动预览）。
4. 每批改完自查 diff。
5. 可做静态检查兜底（非构建）：
   ```bash
   # 花括号平衡（kapt 曾因缺右括号挂掉）
   python -c "s=open('File.kt',encoding='utf-8').read(); print(s.count('{')==s.count('}'))"
   ```

### 阶段 3：CI 验证迭代（核心循环）
```bash
# 1. 提交并推送（凭证见 §三）
git add <file...>   # 显式列文件，不用 git add -A
git commit -S -m "<conventional message>"          # 优先签名提交
# 签名失败/卡住时才退回：git commit --no-gpg-sign -m "<conventional message>"
git log --show-signature -1 | head -5              # 确认出现 "Good signature"
GIT_TERMINAL_PROMPT=0 git push origin <branch>

# 2. 找新运行的 run id
gh run list --branch <branch> --limit 1

# 3. 后台盯 CI（网络抖动用容错轮询，见 §四-4）
# 4. 失败时拉日志
gh run view <RUN_ID> --log-failed
# 5. 从日志提取真实错误（过滤 Gradle 插件内部噪音）
gh run view <RUN_ID> --log-failed | grep -aE "FAILED|Syntax error|Location:|ExceptionInInitializerError|BUILD "
# 6. 静态修复 → 重新 commit + push → 回到步骤 2，直到全绿
```
判定"全绿"：`gh run view <RUN_ID> --json conclusion` 返回 `success`，且所有 job 步骤均为 success。

### 阶段 4：收尾
1. 确认最终 commit 已推送、CI 全绿。
2. **对照阶段 1 落盘的汇总文档逐条核对去向**：每条编号要么已修（标注对应批次/commit），要么写明未修的挂起理由，核对结果写回文档；不允许任何一条静默消失。
3. 把流程经验/新坑写回记忆（memory）与本文档（避免重复踩坑）。
4. 向用户输出简洁总结：提交列表 + 每批修复内容 + CI 迭代结论 + 汇总文档路径。

---

## 三、Git 与凭证（Windows 已验证）

- **push 必须**：`GIT_TERMINAL_PROMPT=0` + `gh auth setup-git`，否则 push 会挂起/超时。
- **提交优先签名**：默认 `git commit -S`，提交后用 `git log --show-signature -1` 确认 `Good signature`。
- **签名可用性预检只能证明"能签"，不能证明"不能签"**：
  ```bash
  timeout 25 "$(git config --get gpg.program)" --batch --yes --pinentry-mode error \
    --local-user 8D05F105A6DD6BA0 --detach-sign -o /dev/null <<< probe
  # exit 0 → 签名可用，直接 git commit -S8D05F105A6DD6BA0
  # 非 0 → 不要据此退回 --no-gpg-sign，改用 timeout 45 git commit -S8D05F105A6DD6BA0
  ```
- **预检失败也要先试真实签名提交**（见 §五-13）：`--pinentry-mode error` 拿不到 pinentry 就直接报错，而 git 自己调 gpg 时拿得到，签名照样成功。用 `timeout` 包住真实提交即可，被 timeout 杀掉的提交不留半成品。
- **只有真实签名提交也失败/超时**才用 `git commit --no-gpg-sign`：gpg 可能在非交互终端等 pinentry 而卡死。
- **不要为了签名去改 git config**：签名密钥/格式由用户维护；预检失败就如实报告（例如 `user.signingkey` 指向不可签名的密钥），由用户决定是否调整。
- **推荐显式列文件** `git add <file...>`，避免 `-A` 带入敏感文件。
- **严禁** `git rebase -i` / `git add -i` 等交互命令。

---

## 四、Windows 环境细节（已验证）

1. **Bash 噪音**：每条 Bash 命令开头出现
   `\377\376export': command not found` 是 `.bashrc` 的 BOM 所致，**无害，忽略**。
2. **乱码**：中文"乱码"不是文件损坏（文件是 UTF-8）。PowerShell 读取：
   ```powershell
   [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
   Get-Content -Encoding UTF8 <file>
   ```
3. **路径**：Read 工具要用 Windows 绝对路径；Bash 工具用 `/tmp/...` 可以，但 Read 读不到 `/tmp`。
4. **CI 轮询**：网络抖动会导致 `gh run watch` 因 TLS 超时退出（exit 0 但没真完成）。用容错轮询：
   ```bash
   while true; do
     r=$(gh run view <ID> --json status,conclusion 2>/dev/null)
     [ -z "$r" ] && sleep 30 && continue
     status=$(echo "$r" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
     concl=$(echo "$r" | sed -n 's/.*"conclusion":"\([^"]*\)".*/\1/p')
     [ "$status" = "completed" ] && echo "DONE $concl" && break
     sleep 30
   done
   ```
   轮询间隔 30s+（GitHub API 限流）。
5. **命令行工具**：找文件用 `fd`，搜内容用 `rg`（优先用 Glob/Grep 工具）。**禁止调用 `find`**，尤其是 Git 自带的 `C:\Program Files\Git\usr\bin\find.exe`（已在 settings.json 的 `permissions.deny` 里拦掉）。
6. **`$args` 是 PowerShell 的自动变量，拿它当函数局部变量会静默出错**（2026-09-12 raksmart 已验证）：把 headless Chrome 的调用包进函数，函数里写 `$args = @("--headless=new", …)` 再 `& $chrome @args > file`，**四次调用全部产出 0 字节文件、且不报任何错**——从外面看完全像"Chrome 起不来/站点打不开"，极易误判成被测系统的问题。换成别的变量名（`$common`）后立刻正常。凡自定义参数数组，一律避开 `$args`（`$input`/`$error` 等同理）。
7. **双引号里 `$var` 紧跟冒号会被解析成作用域/驱动器限定名**（同上）：`curl.exe "https://$h:25150/"` 中 PowerShell 把 `$h:25150` 当成作用域限定变量、展开为空串，curl 只收到 `https://:25150/` 并报 `curl: (3) URL rejected: No host part in the URL`。拼接 host:port 必须写 `"https://${h}:25150/"`；`$var` 后面要跟字母/数字/冒号时都用 `${}` 括起来。
8. **`openssl` 不在 PowerShell 的 PATH 里**（同上）：它是 Git Bash 自带的工具，PowerShell 里直接调会报 `The term 'openssl' is not recognized`。要在 PowerShell 里做 TLS 探测就得写全路径，否则**改用 Bash 工具**（本机 Bash 里 `openssl s_client` 可用）。

---

## 五、踩坑记录（全部真实发生）

1. **subagent 报告完成但未落盘**：0 字节 transcript，声称改完实际什么都没写 → 必须逐份核查 diff。
2. **subagent 改完带语法错误**：`FaceDistanceAnalyzer.kt` 资源清理改造漏掉右括号，kapt 报 `Syntax error: Missing '}'` → 只有 CI 能抓到。
3. **类加载期 Android 框架初始化**：`private val mainHandler = Handler(Looper.getMainLooper())` 在纯 JVM 单元测试里 `getMainLooper()` 返回 null → NPE → `ExceptionInInitializerError`，4 个测试全挂。修复：`by lazy`。
4. **UI 基类与主题不兼容**：`MainActivity` 从 `ComponentActivity` 改成 `AppCompatActivity`，但应用主题是平台 Material 主题（非 AppCompat），`onCreate` 抛异常 → 基线档案模拟器上"应用启动但从未可见、进程消失"。修复：回退基类。
5. **kapt 只报第一个语法错误**：一次运行可能只暴露一处错误，修完再推可能暴露下一处 → 耐心多轮迭代，或用花括号平衡静态检查兜底。
6. **基线档案失败常是模糊的**：`Target package ... failed to stay running after launch` 无 logcat 细节时，用"最后一个通过的 commit 与当前 commit 的差异"来锁定肇事改动（二分思维）。
7. **`--log-failed` 偶发抓空**：网络抖动时输出 0 行，重试即可。
8. **默认加 `--no-gpg-sign` 掩盖了签名本可用**（2026-08 CDict 验证）：仓库 `commit.gpgsign=true` 且 gpg 代理已缓存口令，非交互签名预检 exit 0，直接 `git commit -S` 即可产出 `Good signature`。`user.signingkey` 填的是加密子钥 ID（`[E]`）也无妨——gpg 会回溯到同一主钥的签名子钥。另外 Windows GnuPG 会打印 `gpg: Warning: Enabling DEP failed`，**无害**，不要据此判断签名失败，只看退出码与 `--show-signature` 输出。
9. **subagent 的报告根本不会送达协调者**（2026-08 Project-Lumen 性能优化验证）：7 个后台 agent 全程只发空的 `idle_notification`（无正文），主动 `SendMessage` 索取报告也拿不到内容。这从另一面印证了坑 1：**`git diff` 是唯一可靠的信息渠道**，不要为等报告而阻塞。
10. **括号/花括号平衡检查会误报**：正则或字符串字面量里的孤立括号会让文件永久不平衡（`UpdateChecker.kt` 在 HEAD 就是 259/258）→ 必须与 `git show HEAD:<file>` 的计数对比，看**增量是否一致**，而非绝对相等。
11. **源码文本型测试会限制重构**：`ForegroundServiceArchitectureTest` 断言每个前台服务源文件必须出现字面量 `"ForegroundServiceController.promote("`。重构服务前先 grep 这类断言，否则 CI 会在**测试阶段**而非编译阶段才挂。
12. **"看起来像回归"的删除要先读调用链**：agent 删掉 `latestInstalledApps` 里的 `sortedBy { it.packageName }`，看似破坏列表顺序，实际下游有 `sortedWith(compareBy…thenBy)` 重排，删除是净收益。只看被改函数本身会误判并白白回退一个正确优化。
13. **GPG 签名预检会假阴性**（2026-08-27 NexAI 验证）：用显式主钥 `8D05F105A6DD6BA0` 跑 `--pinentry-mode error` 预检，退出码 2、报 `signing failed: No pinentry`；紧接着 `timeout 45 git commit -S8D05F105A6DD6BA0` 却产出 `Good signature`。git 调用 gpg 时能拿到 pinentry / 已缓存口令，独立探针拿不到 → **预检失败不等于签名不可用，必须先试真实提交**（修正了坑 8 只记录"预检 exit 0"那一半）。
14. **崩溃报告要先做版本归因再动手**（2026-08-27 NexAI 验证）：报告里的 `Commit:` 字段用 `git merge-base --is-ancestor <fix> <crash-commit>` 判定，能直接分辨"尚未修复"与"用户装的是旧包"。这次两份 @UiThread 报告中，第一份的肇事提交比修复早三天，改代码是纯浪费。
15. **R8 会剥掉反射注册器的无参构造函数，只在 minify 的 release 里崩**（2026-08-29 Synapse-Client 验证）：ML Kit/Firebase 的 `ComponentRegistrar` 实现只在 `AndroidManifest` 的 `<meta-data>` 里以字符串出现，发现流程是 `Class.forName` → `getDeclaredConstructor()` → `newInstance()`。R8 保住了类名却删了 `<init>()V`，发现流程 `NoSuchMethodException` 后**静默跳过所有注册器**，于是 `BarcodeScanning.getClient()` 拿到 null 工厂并 NPE。debug 不复现、CI 全绿、只有装了 release 包的用户会崩。修复：`-keep class * implements com.google.firebase.components.ComponentRegistrar { <init>(); }`（用 `<init>();` 而非 `public <init>();`，覆盖非 public 构造）。同时把 `app/build/outputs/mapping/**` 加进 CI 上传产物，下次混淆报告不必再反编译 APK。
16. **混淆崩溃可以直接在已发布 APK 上取证**（同上）：下载 release 资产 → `sha256sum` 与 `gh release view --json assets` 的 digest 对齐，确认分析的就是用户装的那个二进制 → `apktool d -f --no-res` 出 smali，grep `.method .*<init>` / `ctor_count` 即可证明成员是否被删；jadx `--single-class` 反编译崩溃帧所在类还原表达式。修完后对新 release 重跑同一检查闭环取证，而不是"应该修好了"。
17. **上游删除的符号不会产生冲突**（2026-08-29 SyncClipboard / LibChecker 验证）：上游把 `Models/UserConfigs/ConfigKey.cs` 整个删掉，而 fork 独有的 `OssNoticeHelper.cs` 引用 `ConfigKey.Program`——两侧改的是不同文件，git 判定"无冲突"合并成功，代码却已经编译不过。LibChecker 同理：上游删了 `ViewExtensions.kt` 里的 `ViewPager2.setCurrentItem(item, duration, …)` 扩展，fork 的 `MainActivity.kt` 只剩一个悬空 import（ktlint 会因未使用 import 挂掉）。**必须在提交前主动 grep 上游删除项**（见 §七 步骤 5）。
18. **本地 fork 仓库通常落后 `origin`**（同上，EcoEnchants）：sync bot 一直在往 `origin` 推，本地 `advanced` 停在 3 个提交之前。在旧基上合并出来的 merge commit push 时被 non-fast-forward 拒绝。对齐分支前先 `git status`——本次 `AGENTS.md` 有用户未提交的 WIP，用 `git stash push -- AGENTS.md` → `git reset --hard origin/advanced` → `git stash pop` 保住，绝不能裸跑 `reset --hard`。
19. **同步前先确认目标分支的 CI 本来是不是绿的**（同上，LibChecker）：`master` 的 `spotlessCheck` 自 2026-08-17 起一直红（`BackupRules.kt` 枚举注释前缺空行、`BackupRulesPolicyTest.kt` 缺末尾换行），与本次合并毫无关系。不先看历史 run 就推，会把存量失败误判成自己的合并把 CI 搞坏，反复排查合并结果。用 `gh run list -R <owner>/<repo> --branch <b> --limit 5` 取基线，存量问题单独一个 `style:` 提交修掉。
20. **`gh` 会从本地 remote 推错仓库**（同上）：在 fork 目录里跑 `gh run view <id> --log-failed` 解析成了 `LibChecker/LibChecker`（上游），返回 HTTP 404。**对 fork 的所有 `gh run` / `gh pr` 调用一律显式带 `-R <owner>/<repo>`**。
21. **`grep -n '[ \t]$'` 在本机 shell 里不认 `\t`**：方括号里的 `\t` 被当成字面字符 `\` 和 `t`，一次扫出 44 个假的"行尾空白"。要用 `grep -nP '[ \t]+$'` 或 `grep -n $'[ \t]+$'`，否则以 spotless/ktlint 的实际日志为准。
22. **用 `utf-8-sig` 读文件会吃掉正文里的 BOM**（同上，SyncClipboard）：`ProgramConfig.cs` 的 BOM 落在 `=======` 冲突标记**之后**（属于上游那一侧的内容），Python 以 `encoding='utf-8-sig'` 读入后 BOM 被剥掉，写好的匹配串对不上导致 `AssertionError`。解冲突脚本一律用纯 `utf-8` 读写，并把字面 BOM 字符包含进匹配串。
23. **fork 固定依赖版本与上游代码的 API 漂移只在 CI 期炸**（2026-08-29 PiliPlus 验证）：fork 用 git 固定 file_picker 12.0.0-beta.7（`pickFiles` 返回 `FilePickerResult?`、列表在 `.files`），上游按稳定 12.0.0 API 写 `files.isNotEmpty`/`files.map`。合并后 `flutter analyze` 报空安全 + `undefined_getter`，首轮只加空检查仍错、次轮 `result?.files` 解包才对。修这类问题前先读 fork 固定的依赖源码（pub 缓存 `%LOCALAPPDATA%\Pub\Cache\git\...`）确认真实 API，别靠猜。

24. **Rust `GenericArray::as_ref()` 类型推断歧义（E0282/E0283，2026-08-30 janus TOTP 验证）**：`sha1::digest::GenericArray` 有多个 `AsRef` 实现，`hasher.finalize().as_ref()` 在没有上下文钉死目标类型时编译不过（如 `as_ref().to_vec()`、`outer.update(x.as_ref())`），而 `copy_from_slice(hasher.finalize().as_ref())` 能过是因为 `copy_from_slice` 的 `&[u8]` 参数把目标类型钉死了。统一改用固有方法 `.as_slice()`（直接返回 `&[u8]`，零推断）。两个并行审查 agent 都通读过这段却没看出——这类错误静态读码抓不到，只能靠 CI。

25. **修完一个 E0282，同函数常藏第二个同模式错误（E0283）**（同上）：`cargo check --keep-going` 第一轮只报 `outer.finalize().as_ref().to_vec()`（interface.rs:1657），修完再推，第二轮才报同函数 `outer.update(inner_hash.as_ref())`（:1656）。与坑 5（kapt 只报第一个语法错误）同理：修完一个推断错误后，先把整函数所有同模式用法扫一遍再推，否则每轮 CI 只暴露一个、白白烧多轮。

26. **功能放宽传输假设后，必须审计旧假设下写死的安全属性**（同上，transport 审查 agent 抓到，major）：TOTP 模式为 http/IP 部署而生，但 `grant_response` 无条件写 `__Host-janus_session=…; Secure; …`——浏览器在纯 http 下拒绝带 `Secure` 的 cookie（`__Host-` 前缀同样要求 Secure），结果登录 200 但后续请求全 401，功能端到端失效。修复：cookie 名与 `Secure` 属性按 `public_origin` scheme 条件化（https 保持 `__Host-`+Secure，http 用无前缀普通名），且 set/read/clear 三处（`grant_response`/`authenticate`/`logout`）必须共用同一套逻辑。凡把 https 放宽到 http 的新功能，都要排查：Secure cookie、`__Host-` 前缀、CSP/HSTS、WebCrypto 与 Secure context API 可用性。

27. **`utf8_percent_encode(&format!(...), …)` 借用临时量 → E0716**（同上，静态自查抓住）：`PercentEncode` 借用参数，`&format!(...)` 的临时 String 语句末即 drop，下一行使用即悬垂引用。必须先 `let label_input = format!(…); let label = utf8_percent_encode(&label_input, NON_ALPHANUMERIC);`。另：`otpauth://` URI 的 label 必须百分号转义——`display_name` 含 `&`/`?`/空格会让验证器 App 解析失败（identity 审查 minor，真实用户可触发，值得修）。

28. **WebIDL 方法解绑后裸调用 → `TypeError: Illegal invocation`（2026-08-30 janus 前端验证：整条服务器链路全 200，浏览器却一直「Unable to load Janus deployment state」）**：`crypto.randomUUID` 等 WebIDL 方法强制 `this` 绑定，`const e = crypto.randomUUID; e()` 在浏览器（Chrome 151 实测；Firefox/Safari 同理）抛 Illegal invocation——但 **Node 里不抛**（JS 函数无 brand check），所以 curl/后端全 200、浏览器却一个请求都发不出，极难定位。本 bug 异常发生在构造 `new Headers({ "X-Request-Id": randomUuid(), ... })` 时、**fetch 之前**，SPA 的 bootstrap 查询零网络请求即进错误态渲染 fallback，且无控制台错误（异常被 query 吞掉）。修复：直接 `crypto.randomUUID()` 调用保持 this 绑定。凡把原生/WebIDL 方法（`crypto.randomUUID`、`crypto.subtle`、`navigator.credentials` 等）解绑成变量再调用的模式，浏览器里都可能炸；Node/curl 复现不了这种错。

29. **Slint `Rectangle` 没有 `vertical-alignment` 属性（2026-08-30 MeatShell MCP 活动面板验证）**：在 HorizontalLayout 里加了 `Rectangle { width: 1px; height: 12px; background: …; vertical-alignment: center; }` 作分隔线，Slint 编译报 `Unknown property vertical-alignment in Rectangle`，build.rs 在第一个错误处 panic，Windows/macOS/Linux 所有平台的 `Build (release)` 一起挂。只有 `Text`/`Image` 有 `vertical-alignment`；`Rectangle` 没有。仓库既有分隔线写法是裸 `Rectangle { width: 1px; background: Theme.border-subtle; }`（不写 height/alignment，布局默认拉伸成整高）。修复：删掉 `height` 与 `vertical-alignment`。教训：新增 `.slint` 标记前先 grep 仓库既有同类元素用法；且 Slint 编译器一次只报第一个错误（同坑 5/25），修完一个还要把同一块里其他可疑点（未用的 `vertical-alignment`、图标字体引用、数组 `.length` 等）全部扫一遍再推，否则每轮 CI 只暴露一个。

30. **`gh run watch --exit-status` 在 Windows 上不可靠（2026-08-30 MeatShell 全量修复验证）**：同一次 CI 里两次调用都提前退出、退出码一律 0（一次 run 实际失败、一次成功），`--exit-status` 的"退出码随结论"语义在本机不成立，据此判断会把失败 run 当成功。改用 `gh api repos/<owner>/<repo>/actions/runs/<id> --jq '"status="+.status+" conclusion="+(.conclusion//"null")'` 轮询拿到权威结论（round 1 两个 E0308 + 一个 Windows-only 编译错就是这么抓到的）。任何"wait-and-check"式轮询都别迷信 `--exit-status`，直接查 run 对象字段。

31. **subagent 修复代码的跨平台类型问题只在对应平台的 CI job 炸（同上，CI round 1 三连）**：静态审查都放在常规路径上，真正先爆的是两类跨平台错误——(a) 类型不匹配，**所有平台**一起挂：`hasher.write_u64(std::process::id())` 拿 u32 喂 u64（`std::process::id()` 返回 u32，需 `.into()`）；`Des::new_from_slice(&key)` 传 `&Zeroizing<[u8;8]>` 而不是 `&[u8]`（需 `&*key` 解引用），两个都是 E0308；(b) Windows-only nightly API：`std::os::windows::fs::PermissionsExt::from_mode(0o600)` 是 unstable（`windows_permissions_ext`），只在 windows job 挂 E0658/E0599，macOS/Linux 全绿。教训：审查 agent 的 diff 里只要出现平台专属分支（`#[cfg(windows)]`、`std::os::windows`、TCP 回环替代 unix socket 之类），就要把该分支单独当一类错误源，push 前人工过一遍类型与稳定性。

32. **`RefMut` 借用存活期内把 owner 搬进闭包是 E0505（同上，G1 核查时抓到）**：`poll_webdav_download` 在 `Err(TryRecvError::Empty)` 分支里 `move || poll.clone()` 重新布防定时器，但外层 `poll.borrow_mut()` 的 `RefMut`（Drop 类型）还活着、仍借用 `poll`，闭包 move 捕获 owner 即报错。修复：把 `borrow_mut()` 的作用域收进一个块，块内只读通道、把"需要重试"记到块外的 `let mut reschedule` 标志，出块后再 `slint::Timer::single_shot(..., move || poll_webdav_download(poll.clone(), ...))`。模式：凡 `RefMut`/`MutexGuard` 与"闭包 move 捕获其 owner"并存，先把借用圈在小块里。

33. **`rg -r` 是 replace 而不是 recursive（2026-09-01/03 Aura 审计，同一项目内踩三次）**：`rg -rn "setSchedulerEnabled|setAutoWallpaperEnabled" path/` 会把每个匹配替换成字面量 `n` 再输出，于是 `prefs.setSchedulerEnabled(false)` 打印成 `prefs.n(false)` —— 看起来像源码被改坏了、或者像有人塞了个奇怪的辅助函数，会白白引出一轮"这是什么"的排查。ripgrep 默认就递归，不需要任何开关。**要行号只写 `-n`**，或者直接用 Grep 工具。

34. **生产代码新读一个 mock 对象的成员，就会打死严格 mock（2026-09-01 Aura G6-15，AGV 连红两轮）**：把硬编码英文改成 `context.resources.getString(...)` 之后，`VideoWallpapersViewModelTest` 里的 `mockk<Context>()` 没有 `resources` 存根，凡是走到这条路径的测试全红 —— 而 `Build full release APK` 是绿的，编译毫无问题。同一批还踩了对偶形态：`SettingsViewModelTest` 的严格 `ThemePackRecipeManager` mock 缺 `hasPendingSoundRecipes` 应答，导致 14 个"要构造 ViewModel"的测试一起挂。**改生产代码前先 grep 测试里的 `mockk<该类型>`**，新增的成员读取要同步补 `every { ... } returns ...`。

35. **把工作从 `init` 里搬走，会抽掉依赖 `init` 副作用的测试的数据（同上，G6-09）**：`browse.start()` 从 ViewModel `init` 移到幂等的 `startBrowsing()`（只有列表屏 opt-in）之后，两个 feed 测试拿到空列表。修法是测试里显式调用 `startBrowsing()`。同类改造还有个陷阱：`init` 里的 `Eagerly` 收集器**不能无脑改 `WhileSubscribed`** —— 如果有代码同步读 `stateFlow.value`（本例 `WallpaperBrowseViewModel` 就有），没有订阅者时读到的是初始值。

36. **CI check-runs 的 `@tsv` 输出带空格的 job 名，awk 按空白切分会字段错位，把 in_progress 静默判成 completed（2026-09-06 Happy-TTS 三线格式 CI 验证，同一套轮询逻辑连续三次提前放行）**：`gh api .../commits/<sha>/check-runs --jq '.check_runs[] | [.name, .status, .conclusion] | @tsv'` 里 job 名如 `Analyze (typescript)`、`Publish Docker (amd64)` 含空格，awk 的 `$2` 拿到的不是 status 而是名字第二段 → `awk '{if ($2!="completed") exit 1}'` 永不 exit → 等位器把仍在跑的 job 当全绿、提前打印一份仍含 `in_progress` 的"终局"。另有非原子竞态：重型 job 稍晚才进 check-runs 列表，某次快照恰好全 completed（重 job 尚未创建）也会误放行。**修法**：别把 tsv 拉出来给 awk 判——让 jq 自己判布尔：`--jq '[.check_runs[] | select(.status=="completed")] | length == ([.check_runs] | length) and ([.check_runs] | length) > 0'`（输出 `true`/`false`）；判定为全绿后再抓一次排序快照（`sort_by(.name)` + `join("|")` 拼单行防换行歧义），隔 8–20s 抓第二次，**两次相等且仍全绿才算终局**，杜绝"新 job 迟到"式假绿。与坑 30（`gh run watch --exit-status` 不可靠）同族：wait-and-check 式轮询一律直接查 API 权威字段，凡是拿"名字含空格的文本 + awk 切字段"判状态的都是雷。

37. **改了函数的返回结构，却漏同步显式返回类型注解 → type-check 在调用处报类型不兼容，报错点不在定义处（2026-09-06 Happy-TTS，一轮连挂 type-check-backend / Node verification / Publish Docker 三个 job）**：`buildProviderTryList` 函数体改成返回带 `wire` 字段的对象，但行首显式返回注解还是旧签名 `{ baseUrl; apiKey; model }[]`。TS 以显式注解为对外契约（不采信函数体推断），于是 sendMessage/retryMessage 两处 `providers = this.buildProviderTryList(false)` 同时报 `Type '{...}' is not assignable to type '{... wire ...}[]'`，定义处本身不报、报错全在调用点。**定位法**：报错在调用处且措辞是"数组元素缺某字段"，先回头看被调函数的显式返回注解是否与函数体最新返回形状脱节——同步补字段，或删掉显式注解让 TS 推断（推断会自动带上新字段）。**连坐效应**：同一编译错会让 type-check、test（Node verification）、镜像构建（Publish Docker 的 buildx）全部失败，失败 job 多不一定错多，先看是不是同一个 TS/编译根因。

38. **对 PR 不跑 CI 的上游仓库，能在自己 main 上留下"从未编译过"的代码；fork 的 release 构建才是第一道编译闸门**（2026-09-12 Chloemlla/meatshell 验证，7 个平台 job 一起红）。上游 PR #436 在 `open_window` 里加了 `let lay = layout.borrow().clone();` 快照，却**既没给 `Layout` 派生 `Clone`、也没把快照传下去**（后续 `refresh_panes(&window, &layout.borrow(), …)` 还是旧的借用写法），于是 7 个平台同一处报 `E0599: no method named clone found for struct std::cell::Ref<'_, layout::layout::Layout>`，并附一句**误导性**的 `note: this is an associated function, not a method`。根因有两层：(a) 上游 `yituorou/meatshell` **对 PR 不跑任何 CI**（`gh pr checks 436 -R <上游>` → `no checks reported`），所以非编译代码能合进 main，fork 的 Release workflow 是全仓唯一会编译这段代码的地方 —— **fork 同步合并后必须自己推一次构建验编译，不能因为"上游已合并"就假定它编译得过**；(b) `std::cell::Ref<'_, T>` **有意不实现 `Clone`**（`Ref::clone` 是固有**关联函数**、不是方法），`x.borrow().clone()` 只有在 `T: Clone` 时才靠 `*Ref` 自动解引用落到 `T::clone`，否则 `E0599` + 上面那句 note。归因法：`git log -S` 追 derive 历史 + grep 全仓确认无手写 `impl Clone for Layout`，再 `git show <合并前 sha>:src/app.rs` 确认基线里根本没有这两行 ⇒ 上游引入，不是自己改坏。**修复取舍**：别把那两行当死代码删掉 —— 注释与同仓 `refresh_dock` 路径（`DockStacks` 正是为同一目的 derive 了 `Clone`）都表明意图是"快照后释放 RefCell 借用再动 Slint 模型"，删除会静默丢掉一个防 `BorrowMutError`/重入 panic 的护栏；正确做法是补 `#[derive(Clone, Debug)]` 并让 `refresh_panes` 真收到 `&lay`。同族见坑 32（借用存活期）、坑 17/19（上游合并后 fork 才炸）。

39. **`(req as any)` 把类型形状不匹配藏到运行时；同一中间件挂多个上下文时先读中间件源码**（2026-09-12 Happy-TTS OAuth userinfo 生产崩溃验证）。生产日志 `[OAuth] userinfo 获取失败 TypeError: Cannot read properties of undefined (reading 'id')`，栈为 `buildUserProfile ← getOAuthUserInfo ← userinfo`。根因：中间件 `oauthTokenAuth` 往请求上挂的是一个**窄**上下文 `OAuthRequestContext = {clientId, tokenId, scopes, grantId}`（**无 user 行**），controller 却把它当**宽**上下文 `OAuthAccessContext = {token, client, grant, user, scopes}` 传给 `getOAuthUserInfo(context)`，后者读 `context.user.id` → undefined.id。`(req as any)` 抹掉了这条不匹配，tsc 全绿、CI 全绿，只有真跑到 `/userinfo` 才 500。**修两层，缺一不可**：(a) 运行时改从同一中间件**也**设好的 `auth.user` / `req.user` 取 user（仓库既有模式 `asAuthenticatedRequest(req)`）；(b) 把 service 签名从"吃整个宽 context"**收窄到它真正读的字段** `getOAuthUserInfo(user: User, scopes: string[])` —— 同类错误下次就是**编译错**而非生产 500。定位法：同一中间件同时挂了两个上下文（本例 `oauthContext` 与 `auth.user` 并存）时，**先读中间件源码确认真实形状**再决定从哪个取，不要凭调用点的 cast 推断。通用提问：凡是"cast 掉类型 + 传整包上下文"的地方，被调函数实际读了哪几个字段？cast 类缺陷在 CI 里永远看不见，只能靠日志栈 + 生产路径倒推；修的时候顺手把该 cast 换成有类型的 helper，避免下一个调用点再踩。

40. **长期红的定时（cron/schedule）job 要按历史归因，别当成自己改红**（同上验证）。推送后 `Nightly live / integration slice` 报 failure，日志显示 `Test Suites: 2 failed, 2 total` / `Tests: 0 total`，原因是 `The TypeScript compiler "typescript" (version 7.0.2) does not expose the JavaScript compiler API required by ts-jest` —— 两个套件**编译期就没起来**（`policyApi.test.ts` / `logshare-mongodb.test.ts`），与本次改动（OAuth 路径）毫无关系。归因动作：`gh api repos/<o>/<r>/commits/<父 sha>/check-runs --jq '.check_runs[] | select(.name | test("<job名>")) | "\(.name) | \(.conclusion) | \(.started_at)"'` 把**同一个 job 在父提交（乃至更早若干提交）上的历史结论**拉出来 —— 本次自 2026-09-07 起连续 5 天同一原因 failure ⇒ 存量问题，直接判为与本次无关并如实报告。坑 19 是"同步前查基线"，本条是"推送后判红"，同样先用历史结论把存量失败摘出去，再决定要不要动它（本例 workflow 里本就写着该错误的说明，属已知未决，不该顺手改）。

41. **解冲突时"综合"出来的命令行可能两侧原文都没有，而且通常是错的；同因缺陷会分步暴露、被只修前一步**（2026-09-13 `SynapticArch/LibreChat` 验证：镜像构建全绿、CI 全绿，容器一起就 `Error: Cannot find module 'winston-daily-rotate-file'` 崩）。根因在 Dockerfile 一行：上游同步合并 `361a49057` 把它解析成 `npm prune --omit=dev --legacy-peer-deps`，而 `git show --cc <merge> -- Dockerfile` 显示**两个父提交都是** `npm prune --production`——这行是解冲突时新造的。`--legacy-peer-deps` 让 npm 建树时忽略 peerDependencies，于是 lockfile 里标 `"peer": true` 的 peer-only 节点全被判 extraneous 删掉；`packages/data-schemas` 把 `winston-daily-rotate-file` 声明为 **peerDependency**，rollup 的 `peer-deps-external` 又把它标为 external 不打包（`dist/index.cjs:38` 就是 `require('winston-daily-rotate-file')`），被 prune 后从 `/app/packages/data-schemas/dist/` 向上找不到（api 那份在 `/app/api/node_modules/`，**不在这条解析路径上**）⇒ 启动即崩。三条可复用的做法：
    - **归因先看合并本身**：`git show --cc <merge-commit> -- <file>` 看清两侧原文。结果里出现两侧都没有的非平凡命令，默认**按原侧写法回退**（本例回到上游的 `npm prune --production`/`--omit=dev` 正常语义），别相信综合版。`git log -S/-G -- <file>` 在这里会**查不到**这个字符串——路径历史简化会跳过 merge 另一父提交引入的内容，必须用 `--cc` 或 `--full-history`。
    - **同类缺陷会分步暴露**：同一次合并里 `npm ci --legacy-peer-deps` 先炸（peer-only 的 `@radix-ui/react-slot` 装不上，被 `9a0ab5a10` 修），修完 install 一步后，prune 这一步的同因缺陷要等**下一次构建**才显形。修一个 peer/依赖解析缺陷时，把同一条链上后续所有走同一个 flag 的步骤（install → build → prune → 启动）一次扫完再推。
    - **镜像能否启动用 bare-require 解析扫描判定**（不需要跑起服务）：遍历后端各 workspace `dist/**/*.cjs`，把 `require("…")` 的 specifier 用 `Module.createRequire(<该文件>).resolve(spec)` 逐个试。本仓健康值 = 119 个 specifier / 0 unresolved；修复前是 2（`winston-daily-rotate-file` 在启动路径上，`@opentelemetry/sdk-node` 只在 `OTEL_*_ENABLED` 打开时才 require，属同一隐患但默认不炸）。修复后复跑归零，再以容器日志 `Server readiness checks passing.` + `curl <容器IP>:<端口>/health` 返回 200 收闭环。注意 **CI 全绿不能替代这一步**：`publish-amd64` 构建完镜像没有任何启动冒烟测试，`deploy-amd64` 也不检查容器是否真的起来，`MODULE_NOT_FOUND` 的镜像能一路绿到生产。

---

## 六、经验法则（已验证）

- **CI 是唯一裁判**：静态审查 + 人工读码都漏过编译/运行时缺陷，GitHub Actions 每次都抓到了。
- **但"CI 是唯一裁判"只覆盖仓库改动**：本机文件/文档批处理（§十、§十二）没有 CI，必须自建判据——逐文件比对成果与归档元数据（解压后 `Length` 与 `ZipArchiveEntry.Length` 全等）、把 docx 当 zip 容器重开一次证明未截断；别把命令 `exit 0` 当成功（§四-6 那种静默产出 0 字节的失败正是这样漏掉的）。
- **"上游已合并" ≠ "能编译"**：对 PR 不跑 CI 的上游仓库（`gh pr checks <n> -R <上游>` 返回 `no checks reported`），它的 main 上可能是从未编译过的代码；fork 同步合并后**必须自己推一次构建**，release workflow 往往是全仓唯一会编译那段代码的地方（坑 38）。
- **判断红 job 前先查同一个 job 的历史结论**：定时（cron）workflow 长期红和"自己改红"在 check-runs 上长得一样，用父提交/更早若干提交上同一 job 的结论把存量失败摘出去再动手（坑 19、40）。
- **审查出的问题先落盘带细节的汇总文档再修复**：每条问题编号 + 位置 + 类型 + 详细错误信息 + 建议改法，改完逐条核对去向（已修 / 挂起理由），不留无去向项——这是"对症修复"的兜底。
- **用 diff 隔离肇事改动**：比较"最后一个成功 commit"与当前 commit，凡是启动路径/构建路径上的差异优先怀疑。
- **改动要最小化**：只修缺陷本身，不顺手重构；仓库规则明确禁写"超级文件"（大型聚合文件）。
- **套规则前先枚举输入形态，别假定一批输入同质**：14 个看起来同款的试卷包里藏着 1 个异形包（既无「精品解析：」前缀、也无「解析版」字样），只按用户明说的规则盲跑会**静默漏标**；规则覆盖不到的（异形包怎么命名、源头笔误改不改）**一次问全再动手**——按错规则跑完再返工，面是全量文件（§十二）。
- **批量改名要先算目标名再查重，归并类规则必须留区分器**：把多个不同的源名归并成同一格式时（「答案及评分标准」与「解析版」都归并成「（解析版）…」，或「考试版A3」「考试版A4」整段删掉），只加前缀、别删原词——`Group-Object New` 查重实测抓到过这种撞名（§十二-2/3）。查重是把"规则看着对、实际不可逆"挡在落盘之前的那一步。
- **靠关键词启发式筛"这一批包含哪些输入"会静默漏项**：筛来源包时按条目名含标记词来判，会整包漏掉名字里没有标记词的那一个（第二轮漏掉 1,214,337 字节的整包），信号是"总量对不上"。同族：§五-33、§五-36。一律显式列出清单。
- **修完每批就 push 验证**：不要攒一大堆改动再推，否则一个错误要重跑全量 CI 且难定位。
- **命名与提交规范**：Conventional Commits（`fix: ...`），message 说明"为什么"而非"改了什么"。
- **CI 工作流按时长分层利用**：本仓库 `CodeQL` 与 `Release Lumen Crash SDK` 比 `Build Project Lumen Android`（约 25 分钟以上）早得多完成，可当作"能否编译"的早期信号，不必干等主构建。
- **性能优化只缓存进程内不可变的东西**：签名证书摘要、HMAC 密钥、PendingIntent、已编译 Regex 都合格。缓存前必须核查是否存在 `cancel()`/`clear()` 之类的失效路径——本次逐个读了 `SecureCredentialStore.clear()` 的 key 列表和 `NotificationService.scheduledAlarmActions`，确认被缓存对象都不在失效名单里才放行。
- **Compose 的 `remember` key 必须覆盖 lambda 读到的全部字段**：把整个 `uiState` 传给纯函数、却只用其中两个字段作 key，是"UI 不更新"的头号成因。核查办法是读被调函数实现，确认它只读了 key 里的字段（如 `activeTemplate` 只读 `templates` 与 `activeTipTemplateId`，`templateCountdownStyle` 只读 `layoutJson`）。
- **平台线程约束会把"预热"变成纯负债**：`FlutterEngine` 构造调用 `@UiThread` 的 FlutterJNI 方法，Android 16 强制校验，所以引擎预热只能跑主线程——相对于让 `FlutterActivity` 自建引擎毫无并行收益，却多出一个可能比 Activity 活得更久的缓存引擎（网关等待超时后 Activity 另建引擎，孤儿 isolate 的 channel 处理器被误注销，几分钟后冒出 `MissingPluginException`）。给这类"优化"打补丁前先问：**在平台约束下它还剩多少收益**；答案是零就删掉，并用 `git diff <引入该优化的提交>^` 逐行核对，确认是干净回退而非重写。
- **并行审查 agent 同样适合特性代码（不止批量缺陷修复）**（2026-08-30 janus TOTP 验证）：三个互不相交文件组的只读审查 agent（identity 密码学核心 / transport+config / web），transport 组抓到静态读码漏掉的 major（Secure cookie × http，坑 26），identity 组对重放防护/限流/恒时比较逐条 PASS，web 组 SHIP。结论分档 SHIP/FIX/minor 后，协调者按威胁模型裁剪修复范围：只修有真实用户影响的 minor（otpauth URI 转义），不动会破坏单次消耗语义或威胁模型无关的（畸形码绕过限流计数、check-record 两步竞态、初始化接受 W+1 造成登录锁 60s）。

---

## 七、fork 上游同步冲突 PR（2026-08-29 三仓库已验证）

sync bot 会为 fork 自动开 `chore(sync): merge upstream` PR，**head 是上游仓库的分支，不可 push**。冲突只能在本地把 `upstream/<branch>` 合进我们自己的分支再推送，PR 会自动变成 MERGED。

### 固定步骤

```bash
# 1. 确认 PR head 与上游 OID（fork 必须显式 -R）
gh pr view <n> -R <owner>/<repo> --json headRefOid,headRepositoryOwner,state

# 2. 抓取两侧；本地几乎总是落后 origin（坑 18）
git fetch origin && git fetch upstream

# 3. 对齐本地分支到 origin。先 git status！有 WIP 就先 stash 指定文件
git stash push -m wip -- <file>        # 仅当存在用户未提交改动
git reset --hard origin/<branch>       # AGENTS.md 禁止的破坏性命令，仅用于此对齐场景
git stash pop

# 4. 合并但不自动提交，逐个解冲突
git merge upstream/<branch> --no-commit --no-ff

# 5. 三方交集核对：fork 与上游都改过的文件，确认 fork 语义没被吞
B=$(git merge-base HEAD upstream/<branch>)
comm -12 <(git diff --name-only $B..HEAD | sort) \
         <(git diff --name-only $B..upstream/<branch> | sort)
#    对每个交集文件：git diff $B..HEAD -- <f>（fork 改了什么）
#                    git diff HEAD -- <f>（合并结果保住了吗）

# 6. 查上游删除项——git 不会为此报冲突（坑 17）
git diff --name-status $B..upstream/<branch> | grep -E '^(D|R)'
#    再把被删文件里的公开符号 grep 全树，重点是 fork 独有的新增文件

# 7. 提交并推送
timeout 90 git commit -S<key>          # 见 §三
GIT_TERMINAL_PROMPT=0 git push origin <branch>
```

### 判断留哪一侧的原则

- **fork 的立场性删除优先于上游的"恢复"**：LibChecker 上游在 `libs.versions.toml` 重新加回 `firebase-bom` / `firebase-crashlytics` / `gms`，而 fork 的 `AGENTS.md` 明确"never add Google/Firebase behavior to `foss`" → 三项全部丢弃。**先读 fork 的 `AGENTS.md`/`CLAUDE.md` 再定取舍**，冲突块里看不出立场。
- **上游的机制改造优先于 fork 的产物**：SyncClipboard 上游把 checked-in 的 `Strings.Designer.cs` 换成 MSBuild 生成（`StronglyTypedFileName=$(IntermediateOutputPath)`）→ `git rm -f` 掉旧 designer，并确认合并后的 csproj 不再残留 `<Compile Update="I18n\Strings.Designer.cs">`。fork 只需保证自己新增的 resx key 在两个语言文件里都齐。
- **fork 的功能字段要挪到上游的新载体上**：上游删掉常量类后，fork 的 `ProgramConfig.OssNoticeAcknowledged` 保留，引用方从 `ConfigKey.Program` 改成 `ProgramConfig.ConfigKey`——搬迁而非回退上游。

### 收尾核查（本次实际执行过的项目）

- 上游删除项 grep 全树，无残留引用（坑 17）
- 新增/改动的 resx key 在 `Strings.resx` 与 `Strings.zh-CN.resx` 两侧都存在；新包在 `Directory.Packages.props` 里有版本（中央包管理）
- 计数型断言仍成立（`SyncClipboardConfigRegistryTests` 的 `Assert.HasCount(21, …)`）
- Android `strings.xml` 无重复 `name=`；合并后的 `android.yml` 仍保留 fork 对 flavor / `permissions` / 签名步骤的改造
- 未跟踪的签名材料（`*.jks`、`*.jks.bak`、`setup-android-signing.ps1`）绝不入暂存区——所以 `git add` 必须显式列文件
- 用户 WIP 保持未提交状态，并在总结里告知用户

---

## 八、远程服务器运维（MeatShell MCP 驱动，湖北服务器已验证 2026-08-29 起、raksmart 服务器已验证 2026-09-12）

> 与前七节（GitHub Actions 批量审查修复）不同，本节是**远程 CN VPS 上的网络/代理/工具链运维**。验证来源：湖北服务器（<HUBEI_IP>:<SSH_PORT>，Ubuntu 22.04，root），全程经 MeatShell MCP 驱动，没有一条直连 SSH；§八-15 另验证于 raksmart 服务器（<RAKSMART_IP>:<RAKSMART_WEB_PORT>，1Panel + openresty，同为本机 MeatShell MCP 会话）。关联记忆：`hubei-server-env`、`raksmart-server-env`。
>
> 注：本副本面向公开仓库，生产服务器的公网 IP 与公网 NAT 端口已脱敏为 `<HUBEI_IP>` / `<RAKSMART_IP>` / `<SSH_PORT>` / `<JANUS_PORT>` / `<MONGO_PORT>` / `<RAKSMART_WEB_PORT>` 占位符，数据库账号名记为 `<dbuser>`；其余内容与本地完整版一致。

### 1. 访问与执行（MCP 唯一通道）

- 服务器只能经 MeatShell MCP 操作，**直连 SSH 必被拒**（凭据 enc:v1: 加密，取不到明文 key）。本机 helper：`/tmp/mcp_run.py "<bash脚本>" <超时s>`（run_command，输出写 `mcp_run_out.txt`）、`/tmp/mcp_call.py <tool> '<json args>'`（任意工具）、`/tmp/mcp_up.py <local> <remote_dir>`（upload_file）。
- **Git Bash 路径改写坑**：传给 MCP 的 `/root` 会被转成 `C:/Program Files/Git/root`，upload_file 直接报 `sftp ... Disconnected`。调 MCP 工具一律 `MSYS_NO_PATHCONV=1` + 脚本用 Windows 路径（服务器侧路径交给脚本内自己处理）。
- 大命令要传足 timeout：Bash 工具默认 120s 会杀掉超时进程，MCP 侧再设独立 `timeout_seconds`。

### 2. 大文件传输（本机下载 → MCP 上传）

- 境外 CDN 在服务器上**单连接限速 ~140KB/s，走代理也一样**（cdn.azul.com 实测）；本机下载却 23MB/s。Zulu 25 tarball（231MB）策略：本机下载 → MCP 上传 → 服务器解压，比服务器直下快两个数量级。
- 服务器上并行下载用 `aria2c -x16`；apt 官方下载器经 mihomo 仅 ~150KB/s，curl HTTP/2 ~11MB/s。

### 3. NAT 机器的端口测试（用户连续纠正 3 次）

- 服务器是 NAT 机器：公网端口重映射到内部端口。**必须测公网 NAT 端口**（`<HUBEI_IP>:<MONGO_PORT>`），不要测内部 27017——外部 SYN 到达 172.16.0.34:27017 但无 SYN-ACK，恰恰是 TUN 劫持转发路径的证据。约定：公网 `<SSH_PORT>`→内部 `22`；`<MONGO_PORT>`→容器 `27017`。

### 4. mihomo TUN 劫持 docker 转发（已永久修复，最贵的坑）

- **症状**：容器发布端口外部不可达；SSH 却正常——22 本地直收走 `rule 0 lookup local`，绕过了问题，极易误导排查方向。
- **根因**：auto-route 的 `ip rule 9002: not from all iif lo lookup 2022` 捕获**一切非 lo 流量**，包括 DNAT 后转发给容器的入站包、以及容器回包 → 全被拐进 TUN 走代理。外部 SYN 到 eth0 无 SYN-ACK。
- **诊断法**：tcpdump 两侧（公网 NAT 端口与容器 IP）都抓，确认"SYN 到了、SYN-ACK 没回"，把问题锁定在转发路径而非应用层。
- **修复**（已泛化并持久化）：`/usr/local/bin/tunfix.sh` + `clash.service.d/tunfix.conf`（ExecStartPost），重启 clash 自动重放：
  - 三条 `ip rule 8999 to {10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16} lookup main` —— 入站 DNAT 到 docker 网段的转发
  - `ip rule 8998 fwmark 0x66 lookup main` —— 容器回包
  - nft `ip tunfix` MANGLE：`iifname "br-*"` / `"docker0"` 的 established/related 打 mark 0x66
  - 容器**新建出站仍被 TUN 捕获走代理**（代理需求保留），只豁免转发/回包。
- **nft 坑**：iifname 通配符只能单元素（`iifname "br-*"`），放匿名集合 `{ "br-*", "docker0" }` 报 `Byteorder mismatch: expected big endian, got host endian`，脚本非零退出会让 ExecStartPost 失败 → clash 重启失败。改为两条单元素规则 + 末尾 `exit 0`。

### 5. mihomo 域名分流钉住规则

- rule 模式下 `MATCH,GLOBAL` 兜底会把未知域名全走代理（GLOBAL→日本高速05），fake-ip 解析（198.18.0.8）。ghcr.io 其实已被兜底接管——但为可读性与稳定性，显式钉住并覆盖 blob CDN：
  ```
  - DOMAIN-SUFFIX,ghcr.io,GLOBAL
  - DOMAIN-SUFFIX,pkg-containers.githubusercontent.com,GLOBAL   # blob 镜像层 CDN，docker pull 必走
  ```
  放 MATCH 之前；备份 config（.bak.ghcr）→ `clash -t` 校验 → reload 204 → 实时 `curl` 后从 /connections 看到 `rule=DomainSuffix payload=ghcr.io` 才算命中显式规则（而非 Match 兜底）→ 再 `docker manifest inspect ghcr.io/...` 验证 docker 全链路。
- 改规则前建立的旧连接在 /connections 里仍显示 `rule=Match`（keep-alive），别据此误判。

### 6. 其他

- MongoDB <dbuser> 建在 admin 库、root 角色，连接串带 `authSource=admin` 即可；用户会直接给出想要的连接串，**照做，别去复刻内部网络地址/拓扑**（用户明确"网络地址不用复刻"）。

### 7. 公网端口转发部署的同一性判定（湖北 janus <JANUS_PORT>，2026-08-30 已验证）

> 触发：用户报 `http://<HUBEI_IP>:<JANUS_PORT>/` 上「Unable to load Janus deployment state」，而宿主本机没有 <JANUS_PORT> 监听，一度误判为另一台服务器。实际 <JANUS_PORT> 就是刚修好的湖北 janus，报错一度是修复前的浏览器残留。

- **宿主 `ss -tln` 没有 <JANUS_PORT>/<SSH_PORT>**，但 MeatShell 却能经 <SSH_PORT> 连上 → 公网 <HUBEI_IP> 是**云端口转发**：<SSH_PORT>→SSH、<JANUS_PORT>→janus 容器内网 4317；公网 4317 未转发（外部 502），<JANUS_PORT> 是唯一 web 入口。
- **宿主 curl 自己的公网 IP 不具备判别力**（返回 000，无 hairpin），必须从**外部**机器测。
- **SPA 资源哈希比对 = 同一部署指纹**：外部 curl <JANUS_PORT> 的 `index.html` 里 `/assets/index-<hash>.js` 与内网 `curl 127.0.0.1:4317/` 完全一致 → 同一 janus 部署，中间只是 NAT。
- API 路由可佐证版本：当前 bootstrap 在 `/api/v1/bootstrap`（200）；`/api/bootstrap` 返回 404 `no route matches` 是旧路径，不是故障。
- **浏览器报错 hex 与修复前逐字节一致**（`...616c4f7065726174696f6e0000` = "alOperation\0"）→ 判为残留旧错误，硬刷新即可。端到端健康标准：经**公网 NAT 端口** `curl http://<HUBEI_IP>:<JANUS_PORT>/api/v1/bootstrap` 返回 200 且数据正确。

### 8. MongoDB standalone → 单节点副本集 rs0（janus 事务修复，2026-08-30 已验证）

> 触发：初始化错误 `Error code 20 (IllegalOperation): This MongoDB deployment does not support retryable writes`，server response `Transaction numbers are only allowed on a replica set member or mongos`。这是「详细错误改造」的直接收益——裸 `RuntimeUnavailable` 时根本看不到这个根因。

- **根因**：janus 需要多文档事务；standalone mongod 拒绝 retryable writes 且不支持事务。仅 `retryWrites=false` 不够（server 端仍拒事务号），必须把 standalone 变成副本集。
- **keyfile**：`openssl rand -base64 756`，`chmod 400` + `chown 999:999`（= 容器内 mongod 用户 uid；host 上 `ls` 显示 `lxd docker` 是 uid 映射，正常）。副本集 + auth 必须 keyfile，owner/mode 错 mongod 拒启。
- **重建容器**：保留 data bind mount、configdb 卷、固定 IP、端口、`restart=always`，只加 `mongod --replSet rs0 --keyFile /data/mongodb-keyfile`。root 密码从旧容器 env 读进 shell 变量透传，不落 MCP 命令文本。
- **`rs.initiate({_id:"rs0",members:[{_id:0,host:"192.168.16.2:27017"}]})`** → `rs.status()` 出现 `stateStr:"PRIMARY"` 才算成。密码从 janus-server 容器 env 的 `JANUS_MONGODB_URI` 提取，不写死。
- **未 initiate 时日志的 `ReadConcernMajorityNotAvailableYet` / `local.oplog.rs not found` 是正常现象**，别误判。
- **URI 无需加 `replicaSet=rs0`**：驱动连上 PRIMARY 后事务/retryable writes 正常。验证 = 启动日志 `janus control plane ready` + workers 全起 + bootstrap 200。
- **空库判定**：janus 库全部业务集合为 0（`owners=0`）→ 部署**从未初始化**（修复前 janus 起不来，走不到初始化），首次访问会走 TOTP 初始化界面，不是数据丢失。

### 9. SPA 报错但服务器全 200 的浏览器侧取证闭环（2026-08-30 janus.chloemlla.com 已验证）

> 触发：浏览器显示「Unable to load Janus deployment state」，Retry 无效；而整条链路（openresty→webjj→湖北 janus→MongoDB）curl 全部 200。**§八-7 曾把同类报错判为「浏览器残留，硬刷新即可」——本轮证明那是真 bug（见坑 28），不是残留**。凡再遇「服务器健康但浏览器报错」，按下述闭环取证，不要猜残留。

- **第一步：确认浏览器请求到底有没有到达服务器**。看 openresty vhost 的 access log：浏览器加载了 `/` 和 assets（200）但**没有** `/api/v1/bootstrap` → 请求根本没出浏览器。error log 无新条目可排除连接级拒绝（404/header 过大/upstream reset 都会留痕）。
- **第二步：确认 fetch 有没有进入浏览器网络层**。`chrome --headless=new --log-net-log=netlog.json --net-log-capture-mode=Everything --dump-dom <url>`，然后 netlog 里 grep 目标 URL：页面/assets 有记录、目标 API 完全没有 ⇒ fetch 在 renderer 内部、发起网络请求之前就失败了。
- **第三步：打桩 `window.fetch` 记录所有调用**。CDP `Page.addScriptToEvaluateOnNewDocument` 在导航前注入，把 `window.fetch` 包一层，url/method/status/error 写进 `window.__logs`。SPA 自己的 bootstrap 查询零次调用（连点击 Retry 后也是）⇒ queryFn 在 fetch 前抛异常（queryFn 缺失时 TanStack Query 会立即进入「Missing queryFn」错误态，特征完全一致）。
- **第四步：在页面内原样执行可疑的请求构建路径**。`Runtime.evaluate` 里跑 `const e=crypto.randomUUID; e()` → 抓到 `TypeError: Illegal invocation`（坑 28）；同页 `fetch('/api/v1/bootstrap')` 却 200 → 网络路径没问题，问题在应用构造请求的那段 JS。
- **第五步：改完用同闭环复验**。新 bundle 里 `function ft(){if(typeof crypto.randomUUID=="function")return crypto.randomUUID();...}` 确认修复版；重建 webjj 后浏览器能发出 `/api/v1/bootstrap`（200）与 `/api/v1/me`（401→跳 TOTP 登录页）才算端到端好。
- **工具坑**：busybox grep 的 ERE 不支持 `{n,m}`（报 `Invalid contents of {}`），容器里 grep 用简单固定串；要精确提取 minified 函数体就 `docker cp` 出来、下载到本地用 ripgrep。`--dump-dom --virtual-time-budget` 会快进虚拟时间、可能取消挂起的网络请求造成「fetch 从未发出」的假象——判据以真实等待的 CDP 会话为准，别只信 dump-dom。

### 10. 单节点副本集的外部连接必须广告公网可达 host（湖北 rs0，2026-08-30 已验证）

> 触发：外部连接串 `mongodb://<dbuser>:<pw>@<HUBEI_IP>:<MONGO_PORT>/?authSource=admin` 连不上，驱动反复报 `connection <monitor> to 192.168.16.2:27017 closed`，用户怀疑 mihomo 又劫持流量。实际根因是**副本集广告内网 IP**，非劫持。

- **排除 mihomo 的证据**：`tcpdump -i Meta port 27017` = 0 包、`br-*` 桥接口大量 MongoDB wire 包。mihomo `stack: system` + fake-ip 模式下，真实 IP（docker 网段）走 main 表直连路由，只有 fake-ip（198.18.0.0/16）被 main 表的 `198.18.0.0/16 dev Meta` 直连路由送进 TUN——不需要也不存在按目标 IP 的捕获 ip rule。所以「外部 SYN 到容器 IP 无响应」不等于 TUN 劫持，也可能是副本集/应用层问题。
- **驱动行为**：现代驱动（pymongo 4.x 实测）对单 host 无 replicaSet 的 URI 也会握手后自动切 ReplicaSetNoPrimary 拓扑，转去连 hello 广告的 `hosts` 地址。内网 IP 广告 → 外部连不上 → monitor 反复 closed。
- **修复**：`rs.reconfig` 成员 host 内网 IP → 公网 NAT 地址（`<HUBEI_IP>:<MONGO_PORT>`）。**必须 `cfg.version += 1`**，否则报 `New replica set configuration version and term must be greater than old`。配置持久化在 `local.system.replset`，容器重启不丢。改后宿主与容器内 hairpin 到公网 <MONGO_PORT> 均通，内部客户端（Rust 驱动无 replicaSet 用 Single 拓扑）不受影响。
- **tunfix 规则会静默丢失**：clash 未重启、nft 表还在，但 8998/8999 从 `ip rule` 消失（ExecStartPost 只在启动时放一次，不抗后续清空）。自愈方案：systemd `tunfix.timer`（OnUnitActiveSec=60）周期性重放 `tunfix.sh`（幂等）。排查「转发又坏了」先 `ip rule list` 看 8998/8999 在不在，别只看 nft。

#### 本轮完整排查链（可直接复用的路径）

- **信号识别**：`connection <monitor> to <内网IP>:27017 closed` 本身就是驱动在**按副本集广告地址做拓扑发现**的痕迹——monitor 连接连的是 hello 返回的 `hosts`，不是种子地址。看到这个报错先查广告地址，别急着怀疑劫持。
- **证伪 mihomo**：`tcpdump -i Meta -nn 'port 27017'` = 0 包 + `tcpdump -i br-*` 满屏 MongoDB wire 包 ⇒ 流量全程直连桥接，没进 TUN。mihomo `stack: system` 的 TUN 只靠 main 表 `198.18.0.0/16 dev Meta` 直连路由接 fake-ip，真实 IP（docker 网段）天然走 main 表直连，**不需要、也不存在**按目标 IP 的捕获规则。
- **锁定根因**：`rs.status()` / `db.hello()` 看 `me`/`hosts` 字段 = 内网 IP ⇒ 广告错了。本机 `pymongo` 用**用户原样 URI** 复现：`TopologyDescription` 变 `ReplicaSetNoPrimary`、目标 `[('192.168.16.2', 27017)]`、报 `Replica set is configured with internal hostnames or IPs?` ⇒ 坐实。
- **验证闭环（改前/改后对比）**：改前 pymongo 原样 URI 连不上；改后同一脚本 `ping`+`list_database_names`+`insert`+`find` 全过、拓扑 `ReplicaSetWithPrimary`、`replSetGetStatus` 成员 = `<HUBEI_IP>:<MONGO_PORT> PRIMARY`。**reconfig 前先在宿主和容器内各验一次 hairpin**（`bash -c 'exec 3<>/dev/tcp/<HUBEI_IP>/<MONGO_PORT> && echo OK'`），确认内部发现型客户端改公网地址后也能回连，否则内部会断。
- **连带发现（本轮未修，记录备查）**：
  - tts-node 容器 `MONGO_URI` 指向 `172.18.0.2:27017/tts`、Redis 指向 `172.18.0.3:6379`——172.18.x 网络已不存在（实际 mongodb/redis 在 1panel-network 192.168.16.2/.3），致 EHOSTUNREACH 反复重启、`tts` 库从未建起。需改容器 env 重建，等用户确认。
  - mihomo TUN auto-route 半残：`ip rule` 有 `9001: from all iif Meta goto 9010 [unresolved]`（表 9010 不存在）、无捕获规则，但 fake-ip 代理仍工作。这个异常规则是**配置残缺**，不是劫持证据，别据此下结论。
  - 本机 mongosh 的 pnpm 全局安装损坏（`MODULE_NOT_FOUND`），服务器/外连实测一律用 pymongo。


### 11. mihomo TUN → rule 模式重构 + 下载器走 7890 代理 + 下载速度根因（2026-08-30 已验证）

> 触发：GitHub release 下载经 mihomo 只有 ~90-200KB/s（本机 50MB/s）。排查中发现 TUN auto-route 规则反复丢失（`9001 goto 9010 [unresolved]` 残留、tunfix 8998/8999 静默消失），决定整体重构：**弃用 TUN，改 rule 模式 + mixed-port 7890 显式代理 + 腾讯 DNS 全局**。

- **关 TUN**：config `tun.enable:false` + `auto-route:false`，重启 clash 后 Meta 网卡、auto-route ip rule、nft tunfix 表全部消失。停用 tunfix.service/timer、删 `clash.service.d/tunfix.conf`（TUN 没了不再需要）。clash 从此只出 `Mixed(http+socks) proxy listening at 127.0.0.1:7890`。
- **系统 DNS 全局腾讯**：netplan `/etc/netplan/50-network.yaml` eth0 nameservers = `119.29.29.29 / 119.28.28.28 / 兜底 223.5.5.5`，`netplan apply`。**文件须 chmod 600**（否则 netplan 报 "Permissions too open"）。verify：`resolvectl status eth0`；fake-ip 劫持消失后 `getent hosts` 返回真实 IP。
- **下载器走 7890 规则代理**：`/etc/environment` + `/etc/profile.d/zz-proxy.sh`（HTTP/HTTPS/ALL_PROXY=127.0.0.1:7890，NO_PROXY=localhost,127.0.0.1,::1）；apt `/etc/apt/apt.conf.d/95proxy`；git `/etc/gitconfig`；docker `/etc/docker/daemon.json` 加 `proxies` 键（**须重启 dockerd 才生效**）。验证：`apt-get update`、`git ls-remote`、`docker pull hello-world` 各跑一次 + clash 日志看命中规则（aliyun→DomainSuffix DIRECT、github→Match GLOBAL）。
- **`GEOIP,CN,DIRECT` 防国内流量绕日本**：放在 IP-CIDR 内网 DIRECT 之后、MATCH 之前。**必须预置 `/etc/clash/geoip.dat`（17MB，meta-rules-dat latest 本机下载→MCP 上传）且 `geodata-mode:false`**。坑①：`geodata-mode:true` 在此 build 不生效（仍找 geoip.dat）；坑②：缺 geoip 文件时 clash 启动**直连 github 下载会挂死**、7890 起不来——先放好文件再重启。实测 baidu→`GeoIP(cn) using DIRECT`、google→`Match using GLOBAL`。
- **内网流量兜底靠 mihomo IP-CIDR DIRECT，不靠 NO_PROXY**：curl 7.81 的 NO_PROXY 不支持 CIDR（7.86+ 才支持），工具若把内网 IP 丢给 7890，由 mihomo `IP-CIDR,{10/8,172.16/12,192.168/16,127/8},DIRECT` 直连兜底。
- **dockerd 重启会触发静态 IP 竞争（本轮最贵）**：mongodb 静态 IP=192.168.16.2，dockerd 重启时动态分配 IP 的 tts-node 先抢走 .2 → mongodb 起不来报 `failed to set up container networking: Address already in use`。修：`docker stop tts-node` → `docker start mongodb`（拿回 .2）→ 再起 tts-node(.4)/janus(.5)。**janus-server restart=no**，重启 dockerd 后必须手动 `docker start janus-server`。当前 IP：mongodb=.2、redis=.3、tts-node=.4、janus=.5。
- **下载速度根因 = VPS 境外单连接限速（非 TUN/DNS/节点）**：单连接 curl=123-144KB/s；切节点无救（日本高速05=144KB/s、香港=106、日本01=42、住宅IP=39、新加坡=0，全 <150KB/s）；**并行可绕过**：6 连接 curl=383KB/s、**aria2c -x16=~1.0 MiB/s（快约 8 倍）**。与 §八-2 cdn.azul.com 先例同源：境外单连接限速。结论：这台 VPS 要下大境外文件一律 `aria2c -x16`。
- **下载速度根因修正（2026-08-30 晚间直连复核，推翻上面的"单连接限速"表述）**：瓶颈不是代理/节点，是**这台 CN VPS 出国际的物理链路本身**。`--noproxy` 直连实测：dl.google.com（腾讯 DNS 解析到**国内 Google 缓存 IP 202.101.48.33**，被 `GEOIP,CN,DIRECT` 判直连）=11.3MB/s；**Linode 东京=20KB/s、Cloudflare=114KB/s、OVH=29KB/s、GitHub=25KB/s**。⇒ **"谷歌快"是假象=国内缓存直连没走代理**；任何真过国际出口的流量都几十 KB/s。机场节点把单连接"提升"到 60-165KB/s（节点自有国际链路更好），但 VPS→节点段是硬约束，**并行 x16 聚合在 0.15-1MB/s 间飘、不稳定**。61 个节点高速档全测（60-84KB/s）、专线全灭（0KB/s），**换机场/换节点/换CDN 均无解**。判别法：测某"快"目标时先 `getent ahostsv4` 看是否解析到 CN IP + 查 clash 日志该域名有没有 `match` 记录（GEOIP,CN 直连的域名无日志）。
- **git clone 会 fatal 128（单连接长流被掐/early EOF）；GitHub 仓库改用 tarball + aria2c -x16**：`aria2c -x16 -s16 -d /tmp -o repo.tar.gz --all-proxy=http://127.0.0.1:7890 'https://github.com/USER/REPO/archive/refs/heads/BRANCH.tar.gz'`。实测 Happy-TTS main（3.4MB）23s 拉完。默认分支先查：`curl -s --proxy http://127.0.0.1:7890 https://api.github.com/repos/USER/REPO | python3 -c 'import json,sys;print(json.load(sys.stdin)["default_branch"])'`。

### 12. Node 脚本上服务器跑定时任务：运行时版本 + fetch 代理 + systemd 干净环境（2026-09-02 newapi-checkin 湖北已验证）

> 触发：把本机跑通的 `checkin.js`（纯 HTTP 签到，依赖 Node 内置 `fetch`）部署成湖北服务器的每日定时任务。三个坑全部在"本机好使"的前提下出现。

- **系统 `node` 是 12.22.9，没有全局 `fetch`**。别升级系统包（其它东西可能依赖它），装**独立运行时**：`/opt/node` 软链到 `/opt/node-v24.20.0-linux-x64`，脚本里写绝对路径 `/opt/node/bin/node`。tarball 走 `https://mirrors.aliyun.com/nodejs-release/<v>/`（`--noproxy '*'` 直连，实测 2.7-7.1MB/s，与 §八-11 "境外几十 KB/s" 天壤之别），版本清单查同域 `index.json`，并用同目录 `SHASUMS256.txt` 校验：**curl 必须用原始文件名落盘**，否则 `sha256sum -c -` 找不到文件而 FAILED。
- **Node 内置 `fetch`（undici）默认忽略 `HTTP_PROXY`/`HTTPS_PROXY`**，必须 `NODE_USE_ENV_PROXY=1`（Node ≥24）。同一句 `fetch("https://agentrouter.org/")` 实测：裸跑 `TypeError: fetch failed`；加 `NODE_USE_ENV_PROXY=1 + HTTP(S)_PROXY=http://127.0.0.1:7890` → 200。curl 能通不代表 Node 能通——**验证要用目标运行时本身跑一次 fetch**，别拿 curl 的结果推断。
- **注意 `/etc/environment` 里的 `ALL_PROXY=socks5://…`**：给 Node 只显式设 `HTTP_PROXY`/`HTTPS_PROXY` 的 `http://` 形式（mihomo mixed-port 7890 同时收 http 与 socks），别把 socks 变量带进去。
- **systemd 服务拿到的是干净环境，不读 `/etc/environment`**：代理变量、`CHECKIN_ACCOUNTS` 之类全部在包装脚本里 `export`。**交互确认必须用环境变量关掉**（本例 `CHECKIN_YES=1`），否则脚本 readline 等 stdin，在 systemd 下直接挂死。
- **`OnCalendar` 一律按本机时区解释，动手前先 `timedatectl`**：本次部署时湖北机是 `Etc/UTC`，所以写 `01:10:00` 才等于北京 09:10（该机时区 2026-09-03 已改成 `Asia/Shanghai`，`OnCalendar` 同步改成 `09:10:00`，见 §八-13）。Ubuntu 22.04 的 systemd 249 **不支持 `OnCalendar` 带时区**（v252 才有），只能依赖本机时区并在 Description 里写清楚。
- **凭据文件用 `upload_file` 传，不要用 `cat > file <<EOF` 把明文塞进 MCP 命令文本**；落地后 `chmod 600`（目录 700）。上传后**两侧 `sha256sum` 对齐**再继续（本次 `Get-FileHash` 与服务器 `sha256sum` 逐字节一致）。
- **验证闭环**：`systemd-analyze verify` 两个 unit（会顺带打印其它 unit 的存量告警，如 clash.service 被标可执行，与本次无关，别当成自己的问题）→ `systemctl enable --now <timer>` → `systemctl start <service>` 同步跑一次 → 看 `systemctl show -p Result -p ExecMainStatus`（`success` / `0`）+ 日志正文 → `systemctl list-timers <timer>` 确认 NEXT 是预期时刻。

### 13. 改服务器时区 = 平移所有本地时刻型任务，还会触发 `Persistent=true` 补跑（2026-09-03 湖北已验证）

> 触发：用户要求把湖北机时区从 `Etc/UTC` 改成 `Asia/Shanghai`。一条 `timedatectl set-timezone` 的影响面远大于字面。

- **改时区前先盘点"按本机时区跑"的东西**，一条命令拿全：`grep -rl OnCalendar /etc/systemd/system/ /lib/systemd/system/` 逐个打印 `OnCalendar=`；再看 `crontab -l` 与 `/etc/cron.d/`（cron 也用本机时区）。本次自建的只有 `mongodb-backup.timer`(03:10) 与 `newapi-checkin.timer`(01:10)，其余是系统自带。
- **自己写死过 UTC 换算的 unit 必须同步改回本地写法**，否则静默漂 8 小时：`newapi-checkin` 的 `01:10` 本意是"北京 09:10"，改时区后必须改成 `09:10`。改完 NEXT 落在**与改之前完全相同的绝对时刻**（`Thu 09:10 CST` = `Thu 01:10 UTC`），既不漏跑也不重跑——这个"同一时刻"就是改对了的判据。
- **不属于自己意图的 unit 不要顺手改**：`mongodb-backup` 的 `03:10` 在两个时区下都是合法的"每日备份"，改时区后语义从 03:10 UTC（北京 11:10）变成北京 03:10（真凌晨），是净收益，如实告知用户即可，别擅自改成 11:10 去"保住原时刻"。
- **`Persistent=true` 的 timer 会立刻补跑一次**：systemd 用 stamp 文件（`/var/lib/systemd/timers/stamp-<timer>`）的 mtime 当"上次触发"，按新时区重算下一次；若算出来的时刻已过去就当作漏跑而立即触发。本次 `mongodb-backup` 就这么被拉起来跑了一次全量 mongodump（成功，24M，Google Drive 上传也 OK）。**改时区前先想清楚哪些 Persistent timer 会补跑、代价能不能接受**，别用 `touch` stamp 去压制（那是掩盖状态）。
- **挂了 `/etc/localtime` 的容器会跟着宿主变**：`docker inspect <c> --format '{{range .Mounts}}{{.Destination}} {{end}}'` 里出现 `/etc/localtime` 的（本次是 1Panel-openresty），其日志时间戳会一起平移；只设 `TZ=` 环境变量的容器（本次 tts-node 已是 `Asia/Shanghai`）不受宿主影响。MongoDB 内部存 UTC，不受影响。
- **验证三件套**：`timedatectl`（`Time zone: Asia/Shanghai (CST, +0800)` 且 Universal time 未变）→ `systemctl list-timers` 逐个核对 NEXT 是否为期望的本地时刻 → 被补跑的 unit 查 `systemctl show -p Result -p ExecMainStatus` + 它自己的日志确认没跑坏。

### 14. 更新服务器上已存在的凭据文件：`upload_file` 不覆盖（2026-09-03 湖北已验证）

> 触发：本机 `accounts.json` 改了账号，要同步到服务器已部署的同名文件并手动触发一次。

- **MeatShell `upload_file` 是"先传临时文件再 rename"，目标已存在时 rename 直接失败**：返回 `rename remote /path/accounts.json: Failure: Failure`（SFTP 的 `SSH_FXP_RENAME` 不覆盖），文件**一个字节都没变**、也没有明确报错原因，很容易误判成传成功。**先 `mv accounts.json accounts.json.bak` 腾出目标名再上传**，跑通后再删 bak（凭据文件别长期留副本；`chmod 600` 后再放着）。
- **上传出来的新文件不继承旧权限**，必须重新 `chmod 600`；两侧 `sha256sum` / `Get-FileHash` 对一遍确认逐字节一致（**判据是新哈希 ≠ 旧哈希且 = 本机哈希**，光看"exit 0"不算验证）。
- **核对凭据文件内容不打印明文**：`/opt/node/bin/node -e` 读 JSON 只输出 `url / mode / user / pw=set/<长度>` 与去重后的 `distinct=N`（这次正是靠 `distinct=5` 确认用户已把原来重复的那条换成独立账号）。
- **`run_command` 里的单行 node 脚本别用模板字符串**：含 `${}` / 反引号的整条命令实测**静默失败**（`exit_code=null`、stdout/stderr 全空，看不出是哪一环挂的），换成字符串拼接立刻正常。同理，长命令用 `;` 串联比 `&&` 更容易定位是哪一步没输出。
- **重跑验证前先 `truncate -s 0 <log>`**，否则新旧输出混在一起分不清这次的结果；包装脚本自带 tail 滚动不代表本次输出是干净的。

### 15. 域名 443 报 ERR_CONNECTION_CLOSED：1Panel 默认 server 的 `ssl_reject_handshake`（2026-09-12 raksmart 已验证）

> 触发：用户报「通过本地代理 7890 访问 `us-raksmart-1p.chloemlla.com` 意外终止了连接 ERR_CONNECTION_CLOSED」，先入为主怀疑本地代理。实际是服务器 443 上根本没有该域名的 vhost。

- **第一步永远是拿直连对照**：同一条 URL 用 `curl --noproxy '*'` 与 `-x http://127.0.0.1:7890` 各跑一遍。本次两边报**同一个** `schannel ... SEC_E_ILLEGAL_MESSAGE`（TLS 致命警报）⇒ 代理只是忠实转达源站警报，**代理无罪**。（反之只有走代理才失败，才去查代理/分流规则。）
- **openssl 读警报号，信息量远大于 curl**：`echo | openssl s_client -connect <host>:443 -servername <host>` 报 `tlsv1 unrecognized name:SSL alert number 112`。**alert 112 (`unrecognized_name`) 一定等于"SNI 没匹配到任何 server_name"**，直接把问题锁到 nginx 配置层，不必猜证书/协议/密码套件。
- **1Panel 的默认 server 就是"拒绝握手"**：`/opt/1panel/apps/openresty/openresty/conf/default/00.default.conf` 里是 `listen 443 ssl default_server;` + `ssl_reject_handshake on;`。所以"域名没建过站"在 443 上的表现是 TLS 层直接断开；在 80 上则落到 default（`root /usr/share/nginx/html`）返回 404。
- **HSTS 会把浏览器锁死在死路上**：default 的 `ssl/root_ssl.conf` 与站点模板都带 `add_header Strict-Transport-Security`。浏览器碰过一次 http 就被永久升级到 https，于是"连接被关闭"看起来像地址问题而非 TLS 问题——排错时别被 http 能开（200）误导。
- **面板域名绑定 ≠ 建站**：1Panel `core.db` 的 `settings` 表里 `BindDomain` 只是把**面板自身**限制到该域名，面板照旧监听自己的 `ServerPort`（本例 25150），且开了 SSL 后对该端口的 http 请求返回 **400**（必须 https）。想让裸域名可用，必须在 openresty 里另建 vhost 反代过去。
- **查 1Panel 自身状态：库分两个，且服务器通常没装 sqlite3**：`/opt/1panel/db/core.db` 存 `settings`（`BindDomain`/`ServerPort`/`SecurityEntrance`/`SSL*` 都在这儿）、用户、操作日志；`/opt/1panel/db/agent.db` 存站点数据（`websites`/`website_domains`/`website_ssls`/`website_acme_accounts`）。用 python3 只读 URI 查即可，不必装 sqlite3、也不会跟 WAL 抢锁：
  ```bash
  python3 -c "import sqlite3;print(sqlite3.connect('file:/opt/1panel/db/core.db?mode=ro',uri=True).execute(\"select key,value from settings\").fetchall())"
  ```
  多行脚本用 `<<'PYEOF'` heredoc（引号包住分隔符，`$` 不会被展开）；单行 `python3 -c` 里的内层双引号转义成 `\"` 在 MCP `run_command` 里可用（踩坑的是 `${}`/反引号，见 §八-14）。**输出要回避密码类字段**（`Password`/`ProxyPasswd`/`PASSWORD_PRIVATE_KEY`）与敏感路径 `SecurityEntrance`。
- **改配置的落盘姿势**：conf 与证书都在容器外（宿主 `/opt/1panel/www/...` ↔ 容器内 `/usr/local/openresty/nginx/...`，先 `docker inspect <c> --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{"\n"}}{{end}}'`）。**照抄 1Panel 给别的站点生成的 conf 最省事**（含 `proxy/*.conf` 的 include 结构）；SSL 直接从同证书的既有站点 `cp`，再用 `openssl x509 -pubkey | md5` 与 `openssl pkey -pubout | md5` 比对确认证书与私钥配对（EC 私钥跑 `openssl rsa -check` 会报 `Not an RSA key`，属正常，别误判）。**MeatShell `upload_file` 的上传源必须位于 MCP 进程的工作目录内**，否则报 `upload source is outside the allowed transfer directory` → 先写到工作目录再传。传完 `sha256sum` 两侧对哈希 → `docker exec <c> nginx -t` → `nginx -s reload`。
- **服务器上 curl 自己的 443 必须带 `--resolve`**：`curl -k https://127.0.0.1/` 会把 SNI 设成 `127.0.0.1`，落回 default server 被 `ssl_reject_handshake` 拒掉（=000），会伪装成"新配置没生效"。用 `curl --resolve <host>:443:127.0.0.1 https://<host>/` 才同时正确设置 SNI 与 Host。
- **验证要分"裸域名"与"安全入口路径"两条，并用真浏览器**：`chrome --headless=new --dump-dom --virtual-time-budget=15000` 跑四种组合（裸域名/`/<SecurityEntrance>` × 直连/走代理）。裸域名渲染 1Panel 的 "Access Temporarily Unavailable" **不是故障**，是没带安全入口时它故意返回的伪装页；带入口路径才渲染真 SPA（`<title>1Panel</title>`、`id="app"` 有内容）。再把这些路径在 443 与 25150 上的正文 `md5` 对齐，证明反代字节透明。
- **收尾必查"手工站点不在 1Panel DB 里"的后果**：手工建的站点不进 `websites`/`website_domains` 表 ⇒ 面板 UI 看不到，且**证书自动续期只写入 DB 里登记的站点**，它的 ssl 目录会停在旧证书上（本例泛域名 2026-11-27 到期）。长期做法是在面板 UI 正经建一个反向代理站点（上游填 `https://127.0.0.1:25150`）再删掉手工 conf。
- **回归检查要区分"真挂了"与"域名压根没解析"**：本次 10 个站点里有 4 个返回 000，`curl: (6) Could not resolve host` 才是真因（DNS 无记录），与本次 reload 无关。别把 000 一律当成自己改坏了。



## 九、镜像层 CVE 扫描与修复（Docker Hub tag 页 SSR 脱水数据，Happy-TTS 已验证 2026-08-30）

> 触发：用户给出 Docker Hub 镜像层 URL，要求"依据镜像扫描修复所有代码依赖 CVE"。验证于 Node.js 后端 + pnpm + Alpine 的 Happy-TTS 仓库。

### 1. Docker Scout REST API 走不通（已验证）

- `https://api.docker.com/scout/v2/*` 一律 HTTP 404（空 body），连 `openapi.json` / `swagger.json`、连公认已被扫描的公开镜像 `library/alpine:3.20` 都 404。
- `docker/docs` 仓库的 git tree（`gh api repos/docker/docs/git/trees/main?recursive=1`）里**没有** Scout REST API reference 页面。
- `https://scout.docker.com/*` 是 Next.js web 应用，不是 API。

**结论：Docker Scout 的 REST API 没有公开文档/端点，别浪费时间探测。** 想拿 Docker Hub 镜像扫描报告只有两条路：
1. `docker scout cves <image>` CLI（需本机有 Docker + `docker login`；本机无 docker 时不可用）。
2. Docker Hub 网页 → 镜像 tag 页 → **Vulnerabilities** 标签，手动复制扫描结果。

### 2. Docker Hub PAT 的正确认证姿势（已验证）

- PAT 只对 **registry 基本认证**有效：`curl -u <user>:<pat> "https://auth.docker.io/token?service=registry.docker.io&scope=repository:<repo>:pull"` → 200 + 一个 JWT（用于后续 `docker pull` 拉层）。
- 同一个 PAT 当 **Bearer** 打 `hub.docker.com/v2/user/` → 401；打 Scout 端点 → 404。
- 所以：**有 pull token 能拉镜像，但拉不到 Docker Hub 的扫描报告**。拿不到扫描本身时，退回对代码依赖直接审计（下条）。

### 3. npmmirror 没有 audit 端点，必须显式切官方 registry（已验证）

- 本机全局 npm config 的 registry 是 `registry.npmmirror.com`，它不实现 npm audit 端点 → `pnpm audit` 报 `ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS`。
- 环境变量 `npm_config_registry=https://registry.npmjs.org` **不生效**（pnpm 优先读项目 `.npmrc`，本项目 root `.npmrc` 未设 registry → 回落全局 npmmirror）。
- 唯一有效：`pnpm audit --registry=https://registry.npmjs.org`（`--registry` 参数）。对 `pnpm-lock.yaml` 审计用 pnpm 而非 npm（npm audit 读 package-lock.json）。

### 4. 镜像扫描 CVE 的主力往往来自钉死的旧基础镜像，而非代码依赖

- 两个 `pnpm-lock.yaml` 用官方 registry 审计均返回 **No known vulnerabilities found** → 代码（npm）依赖层干净。
- Dockerfile 三阶段全部 `FROM node:24.3.0-alpine`（约 2025-06，已一年+），Alpine OS 包（musl/busybox/openssl 等）累积大量 CVE；最新 24.x-alpine 是 `24.20.0-alpine`（2026-08-27 更新）。
- 修法：三处 `FROM` 统一升级到最新补丁版，push 触发仓库 `docker.yml`（`on: push: branches: [main]`）重建镜像，tag 名 = `$(git rev-parse --short HEAD)-amd64`。旧镜像的 scan 只是旧 base 的产物。
- 版本核对：`curl -s "https://hub.docker.com/v2/repositories/library/node/tags?page_size=100&name=24."` 按 `last_updated` 排序取最新 24.x-alpine。

### 5. Windows Git Bash `/tmp` 与原生 Node 的路径不一致（再次踩到）

- curl（Git Bash）写 `/tmp/x.json` 成功，但 Windows 原生 `node readFileSync('/tmp/x.json')` 把 `/tmp` 解析成 `F:\tmp\x.json` → ENOENT。跨 curl 与 node 传文件时，在同一 shell 里取 JWT（`curl ... | node -e ...` 管道），不要落盘再读；或显式用 Windows 路径。

### 6. Docker Hub tag 页的 SSR 脱水数据可直接提取完整扫描报告（关键方法学）

- 镜像 tag 页 URL：`https://hub.docker.com/repository/docker/<ns>/<repo>/tags/<tag>/sha256-<manifest_digest>`。它是 React Router SSR 页面，**完整扫描数据**序列化在 `window.__reactRouterContext.streamController.enqueue("<JSON>")` 的字符串参数里（React Router 的「脱水 loaderData」）。
- 该参数是 JS 字符串字面量：引号在页面里可能是 `\"`（单层转义）也可能是 `\\"`（双层转义，不同渲染路径/数据形态会变）。先 `JSON.parse('"'+payload+'"')` 得到内层 JSON 文本，再 `JSON.parse` 一次得到扁平数组；两种转义都要试，取能成功解析为数组的那个。
- 扁平数组里字符串是键/值，对象是 ref-map：`{"_<keyIndex>": valueRef}`，keyIndex 指向键字符串在数组中的下标，valueRef 是值所在下标（负数 = null）。**不能用「键后一位就是值」的假设**——那会抓到下一个键或一个大 ref-map 对象，得出错误计数。
- 判定扫描状态与结果：
  - `scanningType` / `repoScanningType` = `"docker-scout"` → 该镜像确实被 Docker Scout 扫过（不是未扫描/排队）。
  - `purlToVulnerabilities` 的值对象 = 受影响 purl → 每个 purl 是漏洞记录数组；`{}` = **0 漏洞**。
  - 交叉验证：页面里 `scout.docker.com/v/CVE-*` 链接数、原始 `CVE-\d{4}-\d+` 子串数，应为 0。
- 解析记录时的坑：URL 参数分隔符是 `\u0026`（转义 `&`）；版本区间是 URL 编码（`%3C`=`<`、`%3E`=`>`）；CVSS 分数与 EPSS 概率（<1.0）要区分，只取 ≥1.0；npm/GHSA 记录的 CVE 后第一个字符串是长描述不是 fixedVer，只有短版本形态才接受。
- manifest digest 从 tag API 拿（`/v2/repositories/<ns>/<repo>/tags/<tag>` 的 `digest` 字段），别用 tag 列表里 layer digest 的 `slice(7,19)`——那是层 digest 不是清单 digest。

### 7. CVE 修复链 79 → 0：基础镜像 + apk upgrade + `--prod`（三者独立验证）

三代镜像同一镜像仓库 `happyclo/tts-node` 的 Docker Scout 计数：

| 镜像 | 唯一 CVE | 说明 |
|---|---|---|
| `2c02756`（修复前，用户原始链接） | 79 | 三阶段全钉 `node:24.3.0-alpine`（2025-06，已一年+） |
| `d9b6c24`（仅升基础镜像） | 24（40 条计数） | openssl×10、golang stdlib×10、undici×3、golang.org/x/text×1 等 |
| `2d46fcd`（本次完整修复） | **0** | `scanningType=docker-scout`，`purlToVulnerabilities={}`，页面 0 个 CVE 引用 |

三种修复手段及归因：
1. **基础镜像升级**：三处 `FROM node:24.3.0-alpine → node:24.20.0-alpine`（用 Docker Hub tag API 按 `last_updated` 取最新 24.x）。清掉绝大部分（120→40 条计数）。
2. **`apk upgrade --no-cache`**（运行时阶段）：清 Alpine OS 包 CVE（openssl，Alpine 仓库已发布 3.5.8-r0 修复版）。
3. **运行时 `pnpm install --prod --frozen-lockfile --ignore-scripts`**：之前运行时安装**没有 `--prod`**，把 devDependencies 一起装进生产镜像——其中 `typescript@7.x` = **typescript-go**（Go 原生编译器，其二进制自带 Go stdlib / golang.org/x/text 的 11 条 CVE），另有 **undici@6.x**（dev 树传递依赖，3 条 `<6.28.0` CVE）。`--prod` 后两者都从镜像消失。

**关键教训（曾误判）**：扫描里出现 `undici` 不等于「base npm 上游、应用修不了」。先用 purl / 安装路径（`/app/node_modules/.pnpm/…` vs `/usr/local/lib/node_modules/npm/…`）判断归属再下结论。本例 undici 在 `/app/node_modules` 是 devDep 传递依赖，`--prod` 直接清掉。

验证闭环：commit 触发仓库 `docker.yml`（`on: push: main`）→ Publish(amd64) + Deploy 全绿 → 部署后 `https://tts.chloemlla.com/health`、`/`、`/api-docs` 均 200（证明 `--prod` 运行时无回归）→ 再抓新 tag 页扫描确认 0。

### 8. hub.docker.com 网页数据的认证姿势（补充 2 节）

- Docker Hub PAT（`dckr_pat_*`）只对 **registry 基本认证**（拉层）有效；打 `hub.docker.com/v2/repositories/*` 401。
- 网页数据用**浏览器 session cookie**（`dckr-auth`、`dckr-sessid`）即可 200；auth0 Bearer JWT 对 `/v2/users/*` 有效、对 repo 端点 401。
- 结论：抓 tag 页 / 扫描报告 → 用带 session cookie 的 curl 直接请求 tag 页 URL 即可，无需 PAT/JWT。

### 9. 复验闭环：确认「当前生产镜像」无 CVE（2026-08-30 追加）

- **`general.data` 单路由端点不携带扫描报告**：`/repository/docker/<ns>/<repo>/general.data?_routes=routes%2F_layout.repository.%24registry.%24namespace.%24name.general` 是 React Router 的单路由数据请求，只返回 General 页 loader 数据（tag 列表预览：`digest`、`full_size`、`last_pushed`、`count`、`name` 等），**没有** `purlToVulnerabilities`/扫描字段。扫描报告只在 tag 页的 SSR 脱水数据里（见小节 6）。
- **general.data 的用途**：快速确认「生产 tag 指向哪个 digest」。本次用它验证 `main-amd64` 与最新短 SHA tag（`2d46fcd-amd64`）指向同一 digest `sha256:e84f76ef…` → 生产跑的就是已修复镜像。
- **复验三步闭环**（不需要全页面加载就能核对当前状态）：① tags API 列最近 tag 找最新短 SHA tag；② 确认 `main-amd64` 与它 digest 一致；③ 抓该 tag 页 → 解码 `purlToVulnerabilities`。本次复验结果：`scanningType=docker-scout`、`purlToVulnerabilities={}`、页面 0 个 `CVE-YYYY-####` 子串 → **0 漏洞，无残留可修**。
- **凭证澄清**：用户贴的「新 auth0 Bearer JWT」实际是浏览器 session cookies（`dckr-auth`、`dckr-sessid` 等一长串，含 Cloudflare `__cf_bm`、GA 等），不是 JWT。PowerShell 版 curl 里 `^"` / `^%` / `^&` / `^$` 是 cmd 转义，落地为真实 header 时需去掉所有 `^`（用 `tr -d '^'`）。`dckr-sessid` 在多轮抓取间保持不变 → 同一会话，旧抓取的数据仍有效。
- **维护提醒**：基础镜像钉死后，上游（node/npm/Alpine）补丁会随仓库漂移；每次有新的 `on: push: main` 构建后，可复用本闭环抽查一次扫描，防止未来重新引入 CVE。

### 10. 镜像扫描 CVE 也可能来自基础镜像捆绑的 npm CLI（2026-08-30 追加，同一仓库）

触发：用户再次给出 `2d46fcd-amd64` 的 tag 页，要求修 high/medium。此前该 tag 扫描是 0（§九-7），但 Docker Scout 漏洞库更新后，新入库的 2026-07-24 / 08-03 的 CVE 在**镜像内容没变**的情况下被重新标出 9 条（4 HIGH + 5 MEDIUM）。

- **归属判定法（关键）**：`purlToVulnerabilities` 里同一包名出现**新旧两个版本**（如 `undici@6.27.0` 与 `undici@8.10.0`、`ip-address@10.2.0` 与 `10.5.0`、`tar@7.5.19` 与 `7.5.22`、`brace-expansion@5.0.7` 与 `5.0.9` 并存）。应用层已用 pnpm `overrides` 钉到安全版（`>=8.9.0` 等），所以新版本是应用安装的；**旧版本来自 node 基础镜像捆绑的 npm CLI**（`/usr/local/lib/node_modules/npm/node_modules/...`），应用层 overrides 根本管不到它。
- **核实手段**：直接下载 npm 官方 tarball 核对捆绑版本——`curl -sL "https://registry.npmjs.org/npm/-/npm-11.19.0.tgz"`，`tar -xOzf ... "package/node_modules/<pkg>/package.json"` 读 version。本次四个包与扫描完全吻合（undici@6.27.0 / ip-address@10.2.0 / brace-expansion@5.0.7 / tar@7.5.19），归属 100% 坐实。
- **修复法（确定性归零）**：运行时镜像以 `node dist/app.js` 直接启动、不需要任何包管理器时，在 `pnpm install --prod` 后把 npm + corepack + pnpm 一并 `rm -rf` 掉：
  ```
  RUN pnpm install --prod --frozen-lockfile --ignore-scripts && \
      rm -rf /usr/local/lib/node_modules/npm \
             /usr/local/lib/node_modules/corepack \
             /usr/local/bin/npm /usr/local/bin/npx \
             /usr/local/bin/corepack \
             /usr/local/bin/pnpm /usr/local/bin/pnpx \
             /usr/local/bin/yarn /usr/local/bin/yarnpkg \
             /root/.cache/node/corepack
  ```
  注意 `corepack prepare pnpm@11.11.0 --activate` 把 pnpm 放在 `$COREPACK_HOME`（默认 `~/.cache/node/corepack`，root 即 `/root/.cache/node/corepack`）。移除前 grep 确认运行时代码无 `spawn/exec npm|npx|pnpm|corepack`（本仓库仅 profiling/migration 脚本的 console.log 文本提到 `npm run`，不是实际调用，安全）。
- **扫描数据下标不固定**：不同 tag 页 SSR 扁平数组里 `purlToVulnerabilities` 所在 ref-map 下标不同（本次 7154 vs 551），解析脚本要**动态找同时含 `scanningType` 与 `purlToVulnerabilities` 键的 ref-map**，别硬编码下标。
- **结果形态**：干净镜像 = `scanningType:"docker-scout"` + `purlToVulnerabilities={}` + 页面 0 个 `CVE-\d{4}-\d+` 子串 + 0 个 `scout.docker.com/v/` 链接。移除后生产 `/health` `/` `/api-docs` 均 200，无回归。

---

## 十、md → docx 与 Word 批量排版宏（Windows 中文 Word + pandoc 3.10.2，2026-09-06 已验证）

> 触发：13 份中文学习笔记 md 用 pandoc 转 docx 后，在 Word 里给"所有已有表格"统一加框线并整文排版。以下各条均为本轮实际跑通或踩到。

### 1. pandoc md → docx

- `pandoc -f gfm -t docx -o "<out>.docx" "<in>.md"`：GFM 的管道表格、引用块、多级标题、中文均正常，无需额外参数。批量：同目录 `for f in *.md; do pandoc -f gfm -t docx -o "${f%.md}.docx" "$f"; done`。
- **转出的 docx 表格默认不带框线**（参考样式无表格边框）——是视觉问题，不是转换失败。

### 2. 给所有已有表格统一加框线

- 界面捷径：点任一表格内 → 出现「表设计」选项卡 → `Ctrl+A` 全选 → 「边框 → 所有框线」，一次覆盖全文档所有表格。
- 宏里 `tbl.Style = "Table Grid"` **在中文版 Word 报"样式不存在"**：内置表格样式按本地名（`网格型`）存取，英文内部名只在英文版可靠。
- 稳妥写法：遍历 `ActiveDocument.Styles`，取 `Type = wdStyleTypeTable And BuiltIn` 且 `InStr(st.NameLocal, "Grid") > 0 Or InStr(st.NameLocal, "网格") > 0` 的样式，`tbl.Style = st.NameLocal`；找不到再兜底手写边框（`tbl.Borders.Enable = True` + `Inside/OutsideLineStyle = wdLineStyleSingle`）。匹配/赋值一律用 `NameLocal`。
- 顺带做"根据窗口自动调整表格"：`tbl.AutoFitBehavior wdAutoFitWindow`（内容自适应 `wdAutoFitContent`；固定列宽 `wdAutoFitFixed`）。

### 3. 对话框选项名 ≠ VBA 成员（踩到 461）

- Word「段落 → 缩进和间距 → 间距」里的"在相同样式的段落间不添加空格"，底层是 OOXML 的 `w:contextualSpacing`，**Word VBA 对象模型没有暴露**——写成 `With Selection.ParagraphFormat ... .NoSpaceBetweenParagraphsOfSameStyle = True` 直接编译报 `Method or data member not found`（错误 461）。
- 想要该效果只能二选一：放弃；或 VBA 模拟——遍历相邻段，仅当上一段与本段**样式名相同**时把本段 `SpaceBefore` 归零，视觉上等同勾选（标题等不同样式段落间距不受影响）。

### 4. 全文排版一段流（可编译、可运行）

- 窄页边距：`ActiveDocument.PageSetup.{Top,Bottom,Left,Right}Margin = CentimetersToPoints(1.27)`（Gutter = 0）。
- 全文字体统一、全部变黑：先 `ActiveDocument.Content.Select`（等同 Ctrl+A，会连带表格内文字），再 `.Font.NameAscii/.NameFarEast/.NameOther = "<字体>"`、`.Font.Color = wdColorBlack`——**只设 `.Name` 只改西文，中文必须设 `.NameFarEast`**；设色不改字号/加粗（那些仍由样式决定）。
- 固定行距 16 磅：`Selection.ParagraphFormat.LineSpacingRule = wdLineSpaceExactly` + `.LineSpacing = 16`。不设 `SpaceBefore/SpaceAfter` 就保持原值。
- VBA 常量（`wdLineSpaceExactly`/`wdColorBlack`/`wdAutoFitWindow`/`wdStyleTypeTable`）与语言无关，中文版照用。

### 5. 中文宏名与"空壳"陷阱

- Word「宏名对话框 → 输入中文名 → 创建」生成的是**只有注释、没有代码的空壳 Sub**，代码需自己填入；同模块出现两个 `Sub … End Sub` 就是两个独立宏，空的那个运行无效果。填码时只保留一个。

---

## 十一、GitHub code-scanning（CodeQL/GHAS）告警批量清零：先分类，真修与 dismiss 并用（Chloemlla/Happy-TTS，2026-09-06 已验证）

触发：任务="把 Happy-TTS 的 open code-scanning 告警修到 0，全程经 GitHub Actions 验证（禁本地构建/测试）"。open 主体是 js/missing-rate-limiting（绝大多数集中在挂载于 `/api/admin` 的整棵 admin 路由树），另有 js/command-line-injection、js/sql-injection 等 code 告警。终局：真修一批 + 按用户批准批量 dismiss 123 条逐文件核实过的误报（121 限流 + 2 code），`state=open` 复验归零。结论先行：每一条先判**能真修（改代码）还是只能 dismiss（结构性误报 / 设计使然）**；真修是首选，dismiss 只用于逐文件核实过的误报并留痕，别一上来就 dismiss，也别死磕到改坏设计。

1. **GHAS 不识别行内 `// codeql[js/...]` 注释抑制（推翻旧假设，本轮最重要的实证）**
   曾假定"在告警锚定行正上方加 `// codeql[规则] 理由`，CodeQL 重扫后该告警自动关闭"。实证反例：推送**仅加注释**的提交后 CodeQL 全量重扫 success；同一轮分析里真改过代码的告警（nexai 等）在 closed 列表以该 commit 出现——证明该分析已被完整摄入对账——而仅加注释的告警仍 open、锚点行分毫未动。结论：行内注释只能作代码内文档，**清除 GHAS 告警必须走官方 dismiss 机制**，不要指望注释。

2. **`js/missing-rate-limiting` 的锚点与可见性边界（决定哪些能真修、哪些只能 dismiss）**
   - 告警锚在每条路由**鉴权/handler 记号那一行**（带列号），不是路由起点；CodeQL 只认**同一文件内**按序出现的 rate-limiter。
   - 跨文件集中挂载的限流（`app.use('/path', limiter, router)` 前缀挂载；routeLimiterModules 相位前缀限流器；模块 `middlewares: [xLimiter]` 数组）运行时真实生效、每请求恰好过一次，但 CodeQL 看不见 → 整棵被集中限流的子树（admin 树 111 条等）= **结构性误报**。
   - **绝不在子路由重复挂同一 limiter 实例去"骗"过 CodeQL**：同一请求会过两次限流器、计数翻倍、quota 减半 = 真实回归（设计注记 G11-06 / G3-26 正是为此移除路由级重复）。
   - 只有"该路由真的没限流"才能代码修复：把限流器挪到鉴权之前（coinFlip 2 条、nexai 12 条即此类）。

3. **dismiss 前的逐文件接线核实（批量关误报的正当性前提）**
   按 rule × file 汇总 open 集；对每个文件定位运行时真实限流点（模块 middlewares 数组 / 相位前缀限流器 / 文件内联限流器）确认单次生效，再 dismiss。并发会话同时推代码会使 alert 按位置漂移或新增 → dismiss 前重拉一次当前 open 集，别用早期快照。

4. **批量 dismiss 的官方姿势与写接口限流退避**
   `gh api -X PATCH "repos/{o}/{r}/code-scanning/alerts/{n}" -f state=dismissed -f dismissed_reason='false positive' -f dismissed_comment='按文件归属的说明'`。`dismissed_reason` 枚举：`false positive` / `won't fix` / `used in tests`。
   - **写接口有二级限流**：紧凑循环约第 2 次请求后即 403 → 循环必须带退避重试（失败 sleep ~15s，最多 ~5 次），放后台跑（127 条约 20+ 分钟）。
   - 告警按 fingerprint 稳定：代码不变时 dismissal 跨后续 CI 重扫保持；收尾用 `state=open` 分页核对，应归零。
   - `gh api --paginate` 会把多页 JSON 数组**直接拼接** → 用 `--jq '.[]'` 逐行喂再逐条解析，不能整体 `json.load`。

5. **Windows / Git Bash 两个具体坑（本轮复现）**
   - `gh api "/repos/..."` 前导斜杠被 MSYS 改写成文件系统路径 → 端点省略前导斜杠：`gh api "repos/{o}/{r}/..."`。
   - `gh run watch` 网络抖动会**提前 exit 0**（根本没盯完）→ 改用 `gh api "repos/{o}/{r}/actions/runs/{id}"` 轮询 status/conclusion。
   - 判断"最新一次分析是否已被 GHAS 摄入"：`GET .../code-scanning/analyses?ref=` 看最新 commit 的 created_at；或看 closed 告警里是否存在以该 commit 解析的——有则说明该分析已完整对账（仍 open 的就是真在报，不是扫描滞后）。

6. **check-ts-file-size 的 800 行护栏与拆文件修法（Quality Guardrails）**
   硬上限 `MAX_TS_FILE_LINES||800`；已在限内的文件**越过 800 即硬失败**（outEmailService 618→862 红灯），"legacy 超限文件在不增长时可被 grandfathered"不适用于"限内跨到限外"。修法：把自包含纯函数块（零依赖 HTML 清洗器）原样抽到同目录兄弟模块（862 → 590 / 276），两文件均回 800 内，代码零改动只搬位置。Node Verification（tsc）是与文件护栏相互独立的 gate，需各自转绿。

7. **同工作树多会话并发**
   每次提交前 `git status`；只 `git add` 自己那批文件（别人正在改的 M 文件绝不碰、绝不纳入自己的提交）；push 前 `git ls-remote origin <branch>` 判远端是否已被对方推进——push 会快进到对方刚推的 commit 之上（45649f43→02be5da2 即此情形），无冲突就别惊慌。

收尾（实际核验数）：真修路径 = coinFlip / nexai 限流前置到鉴权之前 + outEmail HTML 清洗改单遍线性扫描（清 code 告警）+ WAF 正则去 ReDoS + 拆文件过护栏；其余 **123 条（121 js/missing-rate-limiting + js/command-line-injection + js/sql-injection）逐文件接线核实后 dismiss**（`dismissed_reason=false positive` + 挂载/设计注释留痕），脚本终态 `ok=123 fail=0`，复验 `state=open` 归零。终态 CI 全绿：CodeQL / Node Verification / Quality Guardrails / Code Quality 均 success。

---

## 十二、本机批量解压 + 按规则改名（Windows 微信收到的一批试卷 zip，2026-09-13 已验证）

> 触发（第一轮）：14 个「精品解析：…」试卷 zip 要**平铺**解压到同目录 `试卷\`（用户明确"不要把每个压缩包搞成文件夹的形式放在里面"），去掉开头的「精品解析：」，并把「（解析版）/（原卷版）」注释移到文件名最前。**第二轮（同日）**同一套规则扩到 27 个包 / 62 个条目，且**跨两个来源目录**（2026-07 的 11 个 + 2026-08 的 16 个）合并进同一个 `试卷\`——规模一上来，"结构不同质""名实不符""无标识文件名"三类问题才暴露出来（§1、§3）。本机文件批量搬运**不涉及仓库、不涉及 CI**，所以 §一-6「CI 是唯一裁判」不适用，必须自建判据（见 §4）。验证来源：`D:\xwechat_files\…\2026-09\`（14 zip / 32 条目）与 `…\2026-07\` + `…\2026-08\`（27 zip / 62 条目）。

### 1. 先枚举条目结构，再定规则（"14 个包"实为 3 种形态）

- `[System.IO.Compression.ZipFile]::OpenRead($zip)` 遍历 `Entries`，逐条打印 `Length + FullName`，一次看清全部形态：13 个包各 2 个 docx（原卷版 + 解析版），第 14 个包（学易金卷）是 6 个异形文件（考试版 A3 / 考试版 / 参考答案 / 全解全析 / 答题卡 docx + pdf）。
- **异形包必须在动手前发现**：它既无「精品解析：」前缀、也无「解析版」字样，按"每个包套同一规则"盲跑会静默漏标。凡"用户给的规则 + 一批看似同质的输入"，先花一次枚举**证明输入真同质**。
- 打印条目名时用 `<>` 或 `""` 把名字整个包住，才看得出「…10月月考 化学试题」里的多余空格这类肉眼易漏的瑕疵。本机 .NET 解码中文条目名正常、未见 GBK 乱码，但仍应先打印确认，不要假定。

### 2. 先算目标名 + 查重，再落盘（本轮最关键的顺序）

- **不要走"先按原名解压、再逐个 rename"这条弯路**：两步之间存在半成品状态，32 个 rename 中途失败就留下混杂命名，事后分不清哪些已改。
- 直接构建 `条目 → 目标名` 映射表，开写前先查重：`$map | Group-Object New | Where-Object Count -gt 1`。查重会命中两类真实风险：①**跨包同名**（同一学校不同学科的包只差「语文/化学/生物」几个字）；②**规则归并撞名**——多个不同的源名被同一套规则归并到同一目标名（第二轮实测命中，见 §3）。第一轮 32 个全无冲突才放行，第二轮命中 1 处、修正规则后归零才落盘。
- 落盘用 `[IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $dest, $true)` 直接写成目标名；源压缩包一律不动（用户没要求删），目标目录 `New-Item -ItemType Directory -Force` 建。
- 查重与落盘分两次跑（先只打印映射表、确认后再写）：命名规则一旦有偏差，返工面是全部文件，先看一眼的代价近乎为零。

### 3. 改名规则：用户明说的照做，规则覆盖不到的一次问全

- 明说的两类都能静态实现：①去固定前缀用 `-replace '^精品解析：',''`（`^` 锚定开头，避免误伤名字中段出现的同名子串）；②注释提前 = 先把基名里的 `（解析版）` 删掉、再拼到开头，**扩展名单独取出保留**，别把注释拼到 `.docx` 之后。
- **规则覆盖不到的必须问，且一次问全**。第一轮三个待定项一次 `AskUserQuestion` 三问解决：同包里的「（原卷版）」是否也提前、异形包（不含「解析版」字样）怎么命名、源包笔误 `2025-20226学年` 是否修正。第二轮规模变大，问题清单同步变长、四问解决：**跨目录归属**（两个来源目录是各自建 `试卷\` 还是并到一个——只有用户能定）、**无标识文件名**（约 14 个名字里没有学校/考试信息的文件，平铺进同一文件夹后单看名字分不清是哪套卷，是否补身份）、**名实不符**（内部名与压缩包名不一致时以谁为准）、**痕迹清理力度**（`+` 与连续双空格是否顺手清理）。**几十个文件按错规则跑完再返工，成本远高于问一句。**（提问一律用中文——见记忆 `feedback-ask-in-chinese`。）
- 源头瑕疵分两类处置：**能断言是笔误的**（`2025-20226学年`，而压缩包名本身写的是 `2025-2026学年`）经确认后修正；**疑似风格差异但无法断言是错的**（`…10月月考 化学试题` 里的空格、`山东省青岛市青岛市第一中学` 城市名重复）**原样保留并在总结里点出**，不擅自"顺手清理"。
- 规则移植到异形包时按**语义**而非字面套用，但标记必须分成两类实现（第二轮定型）：
  - **删词型**（把标记词从名字里删掉、再把归一后的标记提到最前）：`原卷版` / `试题版` / `考试版` → 一律提为 `（原卷版）`，`解析版` → `（解析版）`。注意 `考试版A3`/`考试版A4` **只删「考试版」、留下 `（A3）`/`（A4）`**——整段删掉的话同包的两个考试版会归并成同一个名字。
  - **保留型**（只加标记前缀、原词留在原位当区分器）：`答案及评分标准` / `参考答案` / `全解全析` / `复习题答案` → 前面加 `（解析版）`，**原词不删**（`（解析版）数学（答案及评分标准）-….docx`）。
  - `答题卡` 既不提前也不加标记，保持原位（第一轮 学易金卷 的 `…（答题卡）A4版` 就是这样保留的），缺身份时只在末尾补身份。
- **第二轮实测：区分器一删就撞名，且只有"查重"能发现**。`数学（答案及评分标准）.docx` 与 `数学（解析版）.docx` 在第一版规则下都归并成「（解析版）数学-<ID>」，`Group-Object New` 当场报出重名（`考试版A3`/`考试版A4` 若整段删除同样会撞）。**归并类改名必须保留原词作区分器**——这正是 §2 查重步骤的存在意义：它把"规则看着对、实际不可逆"的错误挡在落盘之前。
- **源文件没有的标记不发明**：第二轮有两份正卷是纯 PDF、名字里没有任何「原卷版」注释，我只用压缩包名补了身份、**没有替它加 `（原卷版）`**（§六「改动要最小化」）。用户要的是"把已有注释移位"，不是"补全语义"——这类判断要么不做，要么明确告知用户后由他定。
- 源名痕迹的清理清单（第二轮经用户确认"一并清理"）：`+` 当空格（`…高一数学上学期+期中自编模拟卷`）、连续双空格（`期中考试  化学试题`）、尾部重复下载后缀 `(2)`。**删 `(2)` 的正则必须限定括号内是纯数字**（`\s*\(\d+\)\s*$`），否则会误伤 `…卷02(天津专用)`（ASCII 括号！）与 `（2025.11）`（全角）这类有意义的括号。**无法断言是错的就保留**：`附件高一英语月考第三次月考英语听力` 里重复的「月考」原样留着，只在总结里点出。

### 4. 本机文件搬运的完整性判据（归档元数据 + 容器可开性）

- **逐文件比对解压后 `Length` 与 `ZipArchiveEntry.Length` 一一相等**（第一轮 32/32 全等）；**文件一多就改用总量对账**：来源包**全部**条目的字节总和 vs 落盘文件的字节总和 + 条目数（第二轮 62 个 / 91,578,936 字节两侧全等）。只数"文件个数对上了"不够——静默产出 0 字节文件在本机是老坑（§四-6：PowerShell `$args` 四次调用全产出 0 字节且不报任何错）。
- **绝不能靠关键词启发式筛"哪些包属于本轮"**：第二轮我先用「条目名含 `考试版|解析版|原卷版|…`」筛来源包，`山东省青岛市城阳第一高级中学…期中数学复习题.zip` 因为两个文件叫「高一期中复习题 / …复习题答案」、不含任何标记词而被**整包漏掉**，对账差额恰好是它的 1,214,337 字节。发现信号就是"总量对不上"。同族：§五-33（`rg -r` 误用）、§五-36（tsv + awk 切字段）——**启发式筛选会静默漏项，一律显式列出清单**（第二轮改为从脚本里正则读出那 27 个包名后对账即通过）。
- **docx/pptx/xlsx 再当 zip 容器重开一次**：`ZipFile::OpenRead` 成功即证明包结构未截断，能抓出流式复制被中途打断的半成品（两轮均 0 损坏）。非 zip 的按魔数验：PDF 前 4 字节 `%PDF`、MP3 头 `ID3` 或 `0xFF`。
- 复核输出把 `长度 + 文件名` 全部打印给用户看，让命名与排序结果可见——比只说一句"完成"有用得多。

### 5. 两轮结果

- **第一轮**：`D:\xwechat_files\…\2026-09\试卷\` 平铺 32 个文件、无子文件夹，14 个 zip 原件保留：13 套 ×(原卷版 + 解析版) + 学易金卷 6 个（考试版→`（原卷版）`、参考答案 / 全解全析→`（解析版）`、答题卡 docx + pdf 原样）。
- **第二轮**：`…\2026-08\试卷\` 平铺 62 个文件（27 个包跨 2026-07/2026-08 两目录，按用户选择合并到一处），zip 原件保留；其中 54 份是常规 原卷版/解析版 配对，8 份是异形（学易金卷款 7 个：考试版 A3/A4、答案及评分标准、答题卡 docx+pdf、解析版；两份听力 mp3 附件；两份无标记正卷 PDF）。
- **两轮最终合并到 `…\2026-09\试卷\`（94 个文件，第一轮 32 + 第二轮 62）**，复核用名字集合对差：仅第一轮独有 32、仅第二轮独有 0、共有 62（62 个共有名的字节长度两侧全等，是同一份拷贝）。**跨轮并入同一文件夹没有产生任何撞名**——§3 的「`<身份>-<来源包名>` 复合命名」让不同轮次的文件天然不重名，这也顺带验证了命名规则的可扩展性。
- 命名规则在第二轮**从"逐条手改"变成"一个带 §3 分类规则的脚本"**，脚本留在 `%TEMP%\papers-2026.ps1`：默认只打印映射表 + 查重结果，加 `-Apply` 才落盘——§2 的"两次跑"就固化在 `-Apply` 开关里。
- 排序效果：`（解析版）*` 与 `（原卷版）*` 各自聚成一段，且解析版段在前——中文按拼音排序，解 jiě < 原 yuán（PowerShell `Sort-Object` 与资源管理器一致）；第二轮里 `（答题卡）` 未提前（按 §3 保持原位），排序上落在 `（` 段之后、中文名之前。
