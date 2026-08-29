#!/usr/bin/env pwsh
<#
  Android 发布签名一键配置（多仓库批量，无硬编码项目名）

  每个目标仓库的流程：
    keytool -genkeypair  ->  <project>-release.jks
    keytool -list        ->  校验 alias / 密码
    Base64 编码          ->  gh secret set
                             KEYSTORE_BASE64 / KEYSTORE_PASSWORD / KEY_ALIAS / KEY_PASSWORD

  默认模式：每个仓库各自生成/复用各自的 keystore。
  共享模式（-Shared / SHARED_KEYSTORE=1）：多仓库共用同一把密钥。
     - KEYSTORE_FILE 指向已存在的 .jks  -> 直接复用该"已有密钥"（不重新生成）
     - 否则生成一把新的共享密钥          -> "当前生成"
     生成新密钥时逐项询问 Alias / 文件名 / DName（回车用默认值）；
     也可用 KEY_ALIAS / KEYSTORE_FILE / DNAME 等环境变量直接指定，跳过询问。
     同一份 Base64 / alias / 密码写入全部仓库的 Secrets。
     共享密钥默认放在运行根目录（当前目录，可用 KEYSTORE_DIR / KEYSTORE_FILE 指定位置）。

  命名一律推导，不写死：project = GitHub 仓库名（无 remote 时用目录名），
  keystore = <project>-release.jks，alias = <project>，dname = CN=<project>, OU=Dev, ...

  用法：
    pwsh -File setup-android-signing.ps1                       # 交互模式，全程回车用当前目录
    pwsh -File setup-android-signing.ps1 <仓库目录> [...]      # 可多个，可从资源管理器拖拽
    pwsh -File setup-android-signing.ps1 -Yes <仓库目录>       # 跳过 YES 确认
    pwsh -File setup-android-signing.ps1 -Shared <仓库目录> [...]  # 多仓库共用一把密钥
  传入的目录若不是仓库，则展开其下一层的 Android 仓库（含 gradle 标记的 git 仓库）。

  环境变量可覆盖：
    PROJECT_NAME KEYSTORE_FILE KEY_ALIAS DNAME KEYSTORE_DIR REPO
    KEY_ALG KEY_SIZE VALIDITY_DAYS KEYSTORE_PASSWORD KEY_PASSWORD
    SECRET_KEYSTORE_BASE64 SECRET_KEYSTORE_PASSWORD SECRET_KEY_ALIAS SECRET_KEY_PASSWORD
    SAVE_BASE64 ASSUME_YES VERBOSE GH_PATH SHARED_KEYSTORE
#>
param(
  [switch]$Yes,
  [switch]$Shared,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$Targets
)

$ErrorActionPreference = 'Stop'
# 本脚本自行检查 $LASTEXITCODE（gh / git 的非零退出是正常分支），不让宿主默认值把它变成异常
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -Scope Global -ErrorAction SilentlyContinue) {
  $PSNativeCommandUseErrorActionPreference = $false
}
$utf8NoBom = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8NoBom
$OutputEncoding = $utf8NoBom

if ($PSVersionTable.PSVersion.Major -lt 7) {
  Write-Host '[错误] 请使用 PowerShell 7 或更高版本运行此脚本。' -ForegroundColor Red
  Write-Host '       示例: pwsh -File .\setup-android-signing.ps1'
  exit 1
}

# ---------------------------------------------------------------------------
# 配置（留空的项按仓库推导；PowerShell 需先定义再引用，故取值函数在前）
# ---------------------------------------------------------------------------
function Get-EnvOrDefault {
  param([string]$Name, [string]$Default = '')

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) { return $Default }
  return $value.Trim()
}

$CONFIG = @{
  projectName   = (Get-EnvOrDefault 'PROJECT_NAME')   # 空 = GitHub 仓库名 / 目录名
  keystoreFile  = (Get-EnvOrDefault 'KEYSTORE_FILE')  # 空 = <project>-release.jks
  keyAlias      = (Get-EnvOrDefault 'KEY_ALIAS')      # 空 = <project>
  dname         = (Get-EnvOrDefault 'DNAME')          # 空 = CN=<project>, OU=Dev, O=<project>, ...
  keystoreDir   = (Get-EnvOrDefault 'KEYSTORE_DIR')   # 空 = 仓库根目录
  repo          = (Get-EnvOrDefault 'REPO')           # 空 = 优先本地自有 fork，再 gh repo view / origin；多目标时忽略
  keyAlg        = (Get-EnvOrDefault 'KEY_ALG' 'RSA')
  keySize       = [int](Get-EnvOrDefault 'KEY_SIZE' '2048')
  validityDays  = [int](Get-EnvOrDefault 'VALIDITY_DAYS' '10000')
  storePassword = (Get-EnvOrDefault 'KEYSTORE_PASSWORD')
  keyPassword   = (Get-EnvOrDefault 'KEY_PASSWORD')
  secretNames   = @{
    keystore      = (Get-EnvOrDefault 'SECRET_KEYSTORE_BASE64' 'KEYSTORE_BASE64')
    storePassword = (Get-EnvOrDefault 'SECRET_KEYSTORE_PASSWORD' 'KEYSTORE_PASSWORD')
    alias         = (Get-EnvOrDefault 'SECRET_KEY_ALIAS' 'KEY_ALIAS')
    keyPassword   = (Get-EnvOrDefault 'SECRET_KEY_PASSWORD' 'KEY_PASSWORD')
  }
  saveBase64 = (Get-EnvOrDefault 'SAVE_BASE64') -eq '1'
  verbose    = (Get-EnvOrDefault 'VERBOSE') -eq '1'
  assumeYes  = $Yes.IsPresent -or (Get-EnvOrDefault 'ASSUME_YES') -eq '1'
  shared     = $Shared.IsPresent -or (Get-EnvOrDefault 'SHARED_KEYSTORE') -eq '1'
}

# ---------------------------------------------------------------------------
# 输出（批量时用 [i/N] 前缀区分每个仓库）
# ---------------------------------------------------------------------------
function Write-Log {
  param([string]$Tag, [string]$Message, [string]$Color)

  $text = if ($Tag) { "$Tag $Message" } else { $Message }
  if ($Color) { Write-Host $text -ForegroundColor $Color } else { Write-Host $text }
}

function Write-Section {
  param([string]$Message)

  Write-Host ''
  Write-Host $Message
}

function Write-Success {
  param([string]$Message, [string]$Tag)

  Write-Log -Tag $Tag -Message "  ✓ $Message" -Color 'Green'
}

function Write-WarningMessage {
  param([string]$Message, [string]$Tag)

  Write-Log -Tag $Tag -Message "[警告] $Message" -Color 'Yellow'
}

function Pause-ForUser {
  Write-Host ''
  Read-Host '按 Enter 键继续' | Out-Null
}

function Stop-WithError {
  param([string]$Message)

  Write-Host "[错误] $Message" -ForegroundColor Red
  Pause-ForUser
  exit 1
}

# ---------------------------------------------------------------------------
# 外部工具
# ---------------------------------------------------------------------------
function Get-PlainText {
  param([System.Security.SecureString]$SecureString)

  if (-not $SecureString) { return '' }
  $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
  try {
    [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Test-NativeCommand {
  param([string]$Command, [string[]]$Arguments)

  & $Command @Arguments *> $null
  return $LASTEXITCODE -eq 0
}

function Resolve-GhCommand {
  $gh = (Get-Command gh -ErrorAction SilentlyContinue).Source
  if ($gh) { return $gh }

  Write-WarningMessage -Message '在 PATH 中未找到 gh，正在检查常见安装位置...'
  $candidates = @(
    (Get-EnvOrDefault 'GH_PATH'),
    "$env:LOCALAPPDATA\Programs\GitHub CLI\gh.exe",
    "$env:ProgramFiles\GitHub CLI\gh.exe",
    "${env:ProgramFiles(x86)}\GitHub CLI\gh.exe",
    'D:\Program Files\GitHub CLI\gh.exe',
    'D:\Program Files (x86)\GitHub CLI\gh.exe'
  )
  return ($candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1)
}

function Set-GitHubSecret {
  param([string]$GhCommand, [string]$Repo, [string]$Name, [string]$Value)

  # 捕获真实 stderr（供失败消息回显），并重试以跨过 GitHub 瞬时限流（次级限流/5xx）
  $script:ghLastError = ''
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $result = ($Value | & $GhCommand secret set $Name --repo $Repo 2>&1)
    if ($LASTEXITCODE -eq 0) { return $true }
    $script:ghLastError = ($result | Out-String).Trim()
    if ($attempt -lt 3) { Start-Sleep -Seconds 3 }
  }
  return $false
}

# ---------------------------------------------------------------------------
# 目标解析：参数 / 拖拽 / 交互；非仓库目录则展开其下一层的 Android 仓库
# ---------------------------------------------------------------------------
$ANDROID_MARKERS = @('settings.gradle', 'settings.gradle.kts', 'build.gradle', 'build.gradle.kts', 'gradlew')

function Test-GitRepo {
  param([string]$Path)

  return (Test-Path -LiteralPath (Join-Path $Path '.git'))
}

function Test-AndroidRepo {
  param([string]$Path)

  if (-not (Test-GitRepo $Path)) { return $false }
  foreach ($marker in $ANDROID_MARKERS) {
    if (Test-Path -LiteralPath (Join-Path $Path $marker)) { return $true }
  }
  return $false
}

function Get-ChildAndroidRepos {
  param([string]$Path)

  return Get-ChildItem -LiteralPath $Path -Directory -ErrorAction SilentlyContinue |
    Where-Object { Test-AndroidRepo $_.FullName } |
    Sort-Object Name |
    ForEach-Object { $_.FullName }
}

# 把拖拽产生的带引号、空格分隔的多路径串拆成单个路径
function Split-PathTokens {
  param([string]$Line)

  $tokens = @()
  $i = 0
  while ($i -lt $Line.Length) {
    while ($i -lt $Line.Length -and [char]::IsWhiteSpace($Line[$i])) { $i++ }
    if ($i -ge $Line.Length) { break }

    $token = ''
    if ($Line[$i] -eq '"' -or $Line[$i] -eq "'") {
      $quote = $Line[$i]
      $i++
      while ($i -lt $Line.Length -and $Line[$i] -ne $quote) { $token += $Line[$i]; $i++ }
      if ($i -lt $Line.Length) { $i++ }  # 跳过闭合引号
    } else {
      while ($i -lt $Line.Length -and -not [char]::IsWhiteSpace($Line[$i])) { $token += $Line[$i]; $i++ }
    }
    $tokens += $token
  }
  return $tokens
}

function Resolve-Targets {
  param([string[]]$Arguments)

  $found = [System.Collections.Generic.List[string]]::new()
  $seen = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)

  $add = {
    param([string]$Raw)

    $raw = ($Raw -replace '^["'']|["'']$', '').Trim()
    if (-not $raw) { return }
    if (-not (Test-Path -LiteralPath $raw)) {
      Write-WarningMessage -Message "跳过（路径不存在）: $raw"
      return
    }
    $abs = (Resolve-Path -LiteralPath $raw).Path.TrimEnd('\', '/')
    if (Test-AndroidRepo $abs) {
      if ($seen.Add($abs)) { $found.Add($abs) }
      return
    }
    $children = @(Get-ChildAndroidRepos $abs)
    if ($children.Count -gt 0) {
      Write-Host "  $abs 本身不是 Android 仓库，展开其下 $($children.Count) 个仓库"
      foreach ($child in $children) { if ($seen.Add($child)) { $found.Add($child) } }
      return
    }
    if (Test-GitRepo $abs) {
      Write-WarningMessage -Message "$abs 未发现 gradle 标记，仍按仓库处理"
      if ($seen.Add($abs)) { $found.Add($abs) }
      return
    }
    Write-WarningMessage -Message "跳过（不是 git 仓库，其下也未发现 Android 仓库）: $abs"
  }

  if ($Arguments -and $Arguments.Count -gt 0) {
    foreach ($argument in $Arguments) {
      # 整个参数本身就是存在的路径（含空格的目录名）→ 原样收下
      $whole = ($argument -replace '^["'']|["'']$', '').Trim()
      if ($whole -and (Test-Path -LiteralPath $whole)) { & $add $whole }
      else { foreach ($token in (Split-PathTokens $argument)) { & $add $token } }
    }
  } else {
    Write-Host '交互模式：输入仓库目录（可拖拽，一次可拖多个），回车继续添加，再次回车结束；全程回车则用当前目录。'
    while ($true) {
      $answer = (Read-Host '仓库 > ').Trim()
      if (-not $answer) { break }
      foreach ($token in (Split-PathTokens $answer)) { & $add $token }
    }
    if ($found.Count -eq 0) { & $add (Get-Location).Path }
  }
  return $found.ToArray()
}

# ---------------------------------------------------------------------------
# 命名推导：project -> keystore 文件名 / alias / dname
# ---------------------------------------------------------------------------
function Get-SafeName {
  param([string]$Name)

  $safe = ($Name -replace '[^A-Za-z0-9._-]', '-').ToLowerInvariant()
  $safe = ($safe -replace '-{2,}', '-').Trim('-.')
  if (-not $safe) { $safe = 'app' }
  return $safe
}

function Resolve-RepoSlug {
  param([string]$Root, [string]$GhCommand)

  # 若本地配置了当前登录用户自有的仓库 remote，一律优先推给自己 fork：
  # fork 场景下 origin/upstream/parent 指向上游时，gh repo view 可能解析到无权写入的上游仓库。
  $me = (& $GhCommand api user --jq .login 2>$null | Select-Object -First 1).Trim()
  if ($me) {
    $remoteNames = @(& git -C $Root remote 2>$null)
    $ordered = @($remoteNames | Where-Object { $_ -ieq 'origin' }) + @($remoteNames | Where-Object { $_ -ine 'origin' })
    foreach ($remoteName in $ordered) {
      $url = (& git -C $Root config --get "remote.$remoteName.url" 2>$null | Select-Object -First 1).Trim()
      if ($url -match 'github\.com[:/](?<owner>[^/]+)/(?<repo>[^/]+?)(?:\.git)?/?$' -and $Matches.owner -ieq $me) {
        return "$($Matches.owner)/$($Matches.repo)"
      }
    }
  }

  $output = & $GhCommand repo view --json nameWithOwner -q .nameWithOwner 2>$null
  if ($LASTEXITCODE -eq 0 -and $output) { return ($output | Select-Object -First 1).Trim() }

  $remote = & git -C $Root config --get remote.origin.url 2>$null
  if ($LASTEXITCODE -eq 0 -and $remote) {
    $remote = ($remote | Select-Object -First 1).Trim()
    if ($remote -match 'github\.com[:/](?<repo>[^/]+/[^/]+?)(?:\.git)?/?$') { return $Matches.repo }
  }
  return $null
}

function New-TargetPlan {
  param([string]$Root, [string]$GhCommand, [bool]$AllowRepoOverride, [pscustomobject]$SharedPlan)

  if ($AllowRepoOverride -and $CONFIG.repo) {
    $repo = $CONFIG.repo
  } else {
    Push-Location -LiteralPath $Root
    try { $repo = Resolve-RepoSlug -Root $Root -GhCommand $GhCommand } finally { Pop-Location }
  }

  $dirName = Split-Path -Leaf $Root
  $repoName = if ($repo) { $repo.Split('/')[-1] } else { $dirName }
  $project = if ($CONFIG.projectName) { $CONFIG.projectName } else { Get-SafeName $repoName }
  $reason = if ($repo) { '' } else { '未检测到 GitHub 仓库（可在单目标时用 REPO 环境变量指定）' }

  if ($SharedPlan) {
    return [pscustomobject]@{
      Root         = $Root
      Name         = $dirName
      Repo         = $repo
      Project      = $project
      KeystorePath = $SharedPlan.KeystorePath
      Alias        = $SharedPlan.Alias
      Dname        = $SharedPlan.Dname
      Existing     = $SharedPlan.Existing
      Shared       = $true
      Skip         = (-not $repo)
      Reason       = $reason
    }
  }

  $alias = if ($CONFIG.keyAlias) { $CONFIG.keyAlias } else { $project }
  $dname = if ($CONFIG.dname) { $CONFIG.dname } else { "CN=$project, OU=Dev, O=$project, L=Unknown, ST=Unknown, C=US" }

  $fileName = if ($CONFIG.keystoreFile) { $CONFIG.keystoreFile } else { "$project-release.jks" }
  $keystoreDir = if ($CONFIG.keystoreDir) { $CONFIG.keystoreDir } else { $Root }
  $keystorePath = if ([System.IO.Path]::IsPathRooted($fileName)) { $fileName } else { Join-Path $keystoreDir $fileName }

  return [pscustomobject]@{
    Root         = $Root
    Name         = $dirName
    Repo         = $repo
    Project      = $project
    KeystorePath = $keystorePath
    Alias        = $alias
    Dname        = $dname
    Existing     = (Test-Path -LiteralPath $keystorePath)
    Shared       = $false
    Skip         = (-not $repo)
    Reason       = $reason
  }
}

function Read-WithDefault {
  param([string]$Prompt, [string]$Default)

  $answer = (Read-Host "$Prompt (回车=$Default)").Trim()
  if (-not $answer) { return $Default }
  return $answer
}

function New-SharedPlan {
  # Alias：KEY_ALIAS 环境变量优先，否则交互询问（默认 PROJECT_NAME 或 shared）
  $alias = $CONFIG.keyAlias
  if (-not $alias) {
    $defaultAlias = if ($CONFIG.projectName) { Get-SafeName $CONFIG.projectName } else { 'shared' }
    $alias = Read-WithDefault -Prompt '共享密钥 Alias' -Default $defaultAlias
  }

  # Keystore 路径：KEYSTORE_FILE 固定；否则交互询问文件名（默认 <alias>-release.jks，放在运行根目录）
  $keystoreDir = if ($CONFIG.keystoreDir) { $CONFIG.keystoreDir } else { (Get-Location).Path }
  if ($CONFIG.keystoreFile) {
    $fileName = $CONFIG.keystoreFile
  } else {
    $defaultName = "$(Get-SafeName $alias)-release.jks"
    $fileName = Read-WithDefault -Prompt '共享 Keystore 文件名' -Default $defaultName
  }
  $keystorePath = if ([System.IO.Path]::IsPathRooted($fileName)) { $fileName } else { Join-Path $keystoreDir $fileName }

  $existing = Test-Path -LiteralPath $keystorePath

  # DName：DNAME 环境变量优先；生成新密钥时逐项询问，复用已有密钥时无需填写
  $dname = $CONFIG.dname
  if (-not $dname) {
    if ($existing) {
      $dname = "CN=$alias, OU=Dev, O=$alias, L=Unknown, ST=Unknown, C=US"
    } else {
      $cn  = Read-WithDefault -Prompt 'DName CN（常用名，如公司/产品名）' -Default $alias
      $ou  = Read-WithDefault -Prompt 'DName OU（部门）' -Default 'Dev'
      $o   = Read-WithDefault -Prompt 'DName O（组织）' -Default $alias
      $loc = Read-WithDefault -Prompt 'DName L,ST,C（城市,省份,国家，逗号分隔）' -Default 'Unknown,Unknown,US'
      $locParts = $loc -split ','
      $l = if ($locParts[0]) { $locParts[0].Trim() } else { 'Unknown' }
      $st = if ($locParts[1]) { $locParts[1].Trim() } else { 'Unknown' }
      $c = if ($locParts[2]) { $locParts[2].Trim() } else { 'US' }
      $dname = "CN=$cn, OU=$ou, O=$o, L=$l, ST=$st, C=$c"
    }
  }

  return [pscustomobject]@{
    KeystorePath = $keystorePath
    Alias        = $alias
    Dname        = $dname
    Existing     = $existing
  }
}

# ---------------------------------------------------------------------------
# 单仓库执行：生成 keystore -> 校验 -> Base64 -> 推送 secrets
# ---------------------------------------------------------------------------
function Invoke-TargetSetup {
  param(
    [pscustomobject]$Plan,
    [string]$Tag,
    [string]$StorePassword,
    [string]$KeyPassword,
    [string]$GhCommand
  )

  Write-Log -Tag $Tag -Message "$($Plan.Repo)  ($($Plan.Root))"

  # keytool -genkeypair 会往已存在的 keystore 追加条目（同名 alias 直接报错），故备份后移除原文件
  if (Test-Path -LiteralPath $Plan.KeystorePath) {
    $backup = "$($Plan.KeystorePath).bak-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item -LiteralPath $Plan.KeystorePath -Destination $backup -Force
    Remove-Item -LiteralPath $Plan.KeystorePath -Force
    Write-WarningMessage -Tag $Tag -Message "原 keystore 已备份为 $(Split-Path -Leaf $backup)"
  }

  $keytoolArgs = @(
    '-genkeypair',
    '-keystore', $Plan.KeystorePath,
    '-alias', $Plan.Alias,
    '-keyalg', $CONFIG.keyAlg,
    '-keysize', "$($CONFIG.keySize)",
    '-validity', "$($CONFIG.validityDays)",
    '-storepass', $StorePassword,
    '-keypass', $KeyPassword,
    '-dname', $Plan.Dname
  )
  if ($CONFIG.verbose) { $keytoolArgs += '-v' }

  $keytoolOutput = & keytool @keytoolArgs 2>&1
  if ($LASTEXITCODE -ne 0) { throw "生成 keystore 失败: $($keytoolOutput -join ' ')" }
  Write-Success -Tag $Tag -Message "keystore: $($Plan.KeystorePath)"

  $listArgs = @('-list', '-keystore', $Plan.KeystorePath, '-alias', $Plan.Alias, '-storepass', $StorePassword)
  if (-not (Test-NativeCommand -Command 'keytool' -Arguments $listArgs)) {
    throw 'keystore 校验失败（alias 或密码不匹配）'
  }
  Write-Success -Tag $Tag -Message "校验通过: alias=$($Plan.Alias), $($CONFIG.keyAlg)/$($CONFIG.keySize), 有效期 $($CONFIG.validityDays) 天"

  if ($Plan.KeystorePath.StartsWith($Plan.Root, [StringComparison]::OrdinalIgnoreCase)) {
    & git -C $Plan.Root check-ignore -q -- $Plan.KeystorePath 2>$null
    if ($LASTEXITCODE -ne 0) {
      Write-WarningMessage -Tag $Tag -Message "$(Split-Path -Leaf $Plan.KeystorePath) 未被 .gitignore 忽略，建议追加一行: *.jks"
    }
  }

  $base64 = [System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes($Plan.KeystorePath))
  if ([string]::IsNullOrWhiteSpace($base64)) { throw 'Base64 内容为空' }
  Write-Success -Tag $Tag -Message "Base64 编码完成（$($base64.Length) 字符，值已隐藏）"

  if ($CONFIG.saveBase64) {
    $base64Path = "$($Plan.KeystorePath).base64.txt"
    [System.IO.File]::WriteAllText($base64Path, $base64, $utf8NoBom)
    Write-WarningMessage -Tag $Tag -Message "SAVE_BASE64=1，已落盘 $base64Path（等同私钥，用后请删除）"
  }

  Push-TargetSecrets -Plan $Plan -Tag $Tag -Base64 $base64 -StorePassword $StorePassword -KeyPassword $KeyPassword -GhCommand $GhCommand
}

function Push-TargetSecrets {
  param(
    [pscustomobject]$Plan,
    [string]$Tag,
    [string]$Base64,
    [string]$StorePassword,
    [string]$KeyPassword,
    [string]$GhCommand
  )

  $secrets = @(
    @{ Name = $CONFIG.secretNames.keystore;      Value = $Base64 },
    @{ Name = $CONFIG.secretNames.storePassword; Value = $StorePassword },
    @{ Name = $CONFIG.secretNames.alias;         Value = $Plan.Alias },
    @{ Name = $CONFIG.secretNames.keyPassword;   Value = $KeyPassword }
  )
  foreach ($secret in $secrets) {
    if (-not (Set-GitHubSecret -GhCommand $GhCommand -Repo $Plan.Repo -Name $secret.Name -Value $secret.Value)) {
      throw "设置 secret $($secret.Name) 失败: $script:ghLastError"
    }
    Write-Success -Tag $Tag -Message "secret $($secret.Name)"
  }
}

function New-SharedKeystore {
  param(
    [pscustomobject]$SharedPlan,
    [string]$StorePassword,
    [string]$KeyPassword,
    [string]$Tag
  )

  if ($SharedPlan.Existing) {
    Write-Log -Tag $Tag -Message "复用已有共享 keystore: $($SharedPlan.KeystorePath)"
  } else {
    $keytoolArgs = @(
      '-genkeypair',
      '-keystore', $SharedPlan.KeystorePath,
      '-alias', $SharedPlan.Alias,
      '-keyalg', $CONFIG.keyAlg,
      '-keysize', "$($CONFIG.keySize)",
      '-validity', "$($CONFIG.validityDays)",
      '-storepass', $StorePassword,
      '-keypass', $KeyPassword,
      '-dname', $SharedPlan.Dname
    )
    if ($CONFIG.verbose) { $keytoolArgs += '-v' }
    $output = & keytool @keytoolArgs 2>&1
    if ($LASTEXITCODE -ne 0) { throw "生成共享 keystore 失败: $($output -join ' ')" }
    Write-Success -Tag $Tag -Message "生成共享 keystore: $($SharedPlan.KeystorePath)"
  }

  $listArgs = @('-list', '-keystore', $SharedPlan.KeystorePath, '-alias', $SharedPlan.Alias, '-storepass', $StorePassword)
  if (-not (Test-NativeCommand -Command 'keytool' -Arguments $listArgs)) {
    throw '共享 keystore 校验失败（alias 或密码与现有文件不匹配）'
  }
  Write-Success -Tag $Tag -Message "校验通过: alias=$($SharedPlan.Alias), $($CONFIG.keyAlg)/$($CONFIG.keySize), 有效期 $($CONFIG.validityDays) 天"

  $base64 = [System.Convert]::ToBase64String([System.IO.File]::ReadAllBytes($SharedPlan.KeystorePath))
  if ([string]::IsNullOrWhiteSpace($base64)) { throw 'Base64 内容为空' }
  Write-Success -Tag $Tag -Message "Base64 编码完成（$($base64.Length) 字符，值已隐藏）"

  if ($CONFIG.saveBase64) {
    $base64Path = "$($SharedPlan.KeystorePath).base64.txt"
    [System.IO.File]::WriteAllText($base64Path, $base64, $utf8NoBom)
    Write-WarningMessage -Tag $Tag -Message "SAVE_BASE64=1，已落盘 $base64Path（等同私钥，用后请删除）"
  }
  return $base64
}

# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host '========================================'
Write-Host '  Android 发布签名一键配置'
Write-Host '========================================'

Write-Section '[1/6] 检查依赖工具...'

if (-not (Get-Command keytool -ErrorAction SilentlyContinue)) {
  Stop-WithError '未找到 keytool，请安装 JDK 并添加到 PATH。下载地址: https://www.oracle.com/java/technologies/downloads/'
}
Write-Success -Message 'keytool 已安装'

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Stop-WithError '未找到 git，无法检测仓库与 .gitignore。'
}
Write-Success -Message 'git 可用'

$ghCommand = Resolve-GhCommand
if (-not $ghCommand) {
  Write-Host '[错误] 未找到 GitHub CLI 安装' -ForegroundColor Red
  Write-Host ''
  Write-Host '请执行以下操作之一:'
  Write-Host '  1. 下载并安装: https://cli.github.com/'
  Write-Host '  2. 使用 winget 安装: winget install --id GitHub.cli'
  Write-Host '  3. 使用 scoop 安装: scoop install gh'
  Write-Host '  4. 已安装则设置 GH_PATH 环境变量指向 gh.exe'
  Pause-ForUser
  exit 1
}
Write-Success -Message "GitHub CLI: $ghCommand"
Write-Success -Message "PowerShell $($PSVersionTable.PSVersion) 可用"

Write-Section '[2/6] 检查 GitHub 登录状态...'

if (-not (Test-NativeCommand -Command $ghCommand -Arguments @('auth', 'status'))) {
  if ($env:GH_TOKEN) {
    Write-Host '[错误] GH_TOKEN 无效或已过期' -ForegroundColor Red
    Write-Host ''
    Write-Host '请执行以下操作之一:'
    Write-Host '  1. 清除环境变量后重新登录: Remove-Item Env:\GH_TOKEN 然后 gh auth login'
    Write-Host '  2. 更新 GH_TOKEN 为有效的 Personal Access Token: https://github.com/settings/tokens'
  } else {
    Write-Host '[错误] 未登录 GitHub CLI' -ForegroundColor Red
    Write-Host ''
    Write-Host '请先登录:'
    Write-Host "  `"$ghCommand`" auth login"
    Write-Host '  依次选择 GitHub.com / HTTPS / Login with a web browser'
  }
  Pause-ForUser
  exit 1
}
Write-Success -Message $(if ($env:GH_TOKEN) { '已通过 GH_TOKEN 认证' } else { '已登录 GitHub' })

Write-Section '[3/6] 解析目标仓库...'

$targetRoots = @(Resolve-Targets -Arguments $Targets)
if ($targetRoots.Count -eq 0) { Stop-WithError '没有可处理的仓库。' }
Write-Success -Message "目标 $($targetRoots.Count) 个"

Write-Section '[4/6] 推导命名并检测仓库...'

$single = $targetRoots.Count -eq 1
if ($CONFIG.repo -and -not $single) { Write-WarningMessage -Message '多目标时忽略 REPO 环境变量，按各仓库 remote 检测' }
if (-not $CONFIG.shared -and -not $single) {
  foreach ($name in @('PROJECT_NAME', 'KEYSTORE_FILE', 'KEY_ALIAS', 'DNAME', 'KEYSTORE_DIR')) {
    if (Get-EnvOrDefault $name) { Write-WarningMessage -Message "环境变量 $name 会同时作用于全部 $($targetRoots.Count) 个目标" }
  }
}

$sharedPlan = $null
if ($CONFIG.shared) {
  $sharedPlan = New-SharedPlan
  if ($sharedPlan.Existing) {
    Write-Log -Message "共享模式：复用已有密钥 -> $($sharedPlan.KeystorePath)  alias=$($sharedPlan.Alias)（请确保 Alias 与密码与该 keystore 一致）" -Color 'Yellow'
  } else {
    Write-Log -Message "共享模式：将生成一把新密钥 -> $($sharedPlan.KeystorePath)  alias=$($sharedPlan.Alias)"
  }
}

$plans = @()
for ($i = 0; $i -lt $targetRoots.Count; $i++) {
  $tag = "[$($i + 1)/$($targetRoots.Count)]"
  $plan = New-TargetPlan -Root $targetRoots[$i] -GhCommand $ghCommand -AllowRepoOverride $single -SharedPlan $sharedPlan
  if ($plan.Skip) {
    Write-WarningMessage -Tag $tag -Message "$($plan.Name): $($plan.Reason)"
  } else {
    Write-Log -Tag $tag -Message "$($plan.Name) -> $($plan.Repo)  alias=$($plan.Alias)  keystore=$(Split-Path -Leaf $plan.KeystorePath)"
  }
  $plans += $plan
}

$ready = @($plans | Where-Object { -not $_.Skip })
if ($ready.Count -eq 0) { Stop-WithError '没有可处理的仓库（均未检测到 GitHub remote）。' }

Write-Section '密码（全部目标共用，可用 KEYSTORE_PASSWORD / KEY_PASSWORD 环境变量提供）'

$storePassword = $CONFIG.storePassword
if ($storePassword) {
  Write-Success -Message '使用环境变量 KEYSTORE_PASSWORD'
} else {
  Write-Host '请输入 keystore 密码（至少 6 位）:'
  $storePassword = Get-PlainText (Read-Host '> ' -AsSecureString)
}
if ([string]::IsNullOrWhiteSpace($storePassword) -or $storePassword.Length -lt 6) {
  Stop-WithError 'keystore 密码不能为空，且长度至少为 6 位。'
}

$keyPassword = $CONFIG.keyPassword
if (-not $keyPassword) {
  if ($CONFIG.storePassword) {
    $keyPassword = $storePassword  # 全环境变量模式不再交互
  } else {
    Write-Host ''
    Write-Host '请输入 key 密码（直接回车则使用与 keystore 相同的密码）:'
    $keyPassword = Get-PlainText (Read-Host '> ' -AsSecureString)
  }
}
if ([string]::IsNullOrWhiteSpace($keyPassword)) { $keyPassword = $storePassword }
if ($keyPassword.Length -lt 6) { Stop-WithError 'key 密码长度至少为 6 位。' }

Write-Section '[5/6] 确认执行计划...'
Write-Host '========================================'
if ($CONFIG.shared) {
  Write-Host ''
  Write-Host "共享 keystore: $($sharedPlan.KeystorePath)$(if ($sharedPlan.Existing) { '   [已存在 → 直接复用]' } else { '   [不存在 → 将生成一把新密钥]' })"
  Write-Host "共享 alias   : $($sharedPlan.Alias)"
  Write-Host "共享 DName   : $($sharedPlan.Dname)"
}
foreach ($plan in $ready) {
  Write-Host ''
  Write-Host "仓库    : $($plan.Repo)"
  Write-Host "目录    : $($plan.Root)"
  if ($CONFIG.shared) {
    Write-Host "将写入  : 上述共享密钥的 4 个 Secrets（Base64 / 密码 / alias 全部相同）"
  } else {
    Write-Host "Keystore: $($plan.KeystorePath)$(if ($plan.Existing) { '   [已存在 → 备份后重新生成，签名密钥会变更]' } else { '' })"
    Write-Host "Alias   : $($plan.Alias)"
    Write-Host "DName   : $($plan.Dname)"
  }
  Write-Host "Secrets : $($CONFIG.secretNames.keystore), $($CONFIG.secretNames.storePassword), $($CONFIG.secretNames.alias), $($CONFIG.secretNames.keyPassword)"
}
Write-Host ''
Write-Host '========================================'
Write-WarningMessage -Message '以上 keystore 与密码将被写入对应仓库的 GitHub Secrets（密码值不回显）'

if ($CONFIG.assumeYes) {
  Write-Host '已指定 -Yes / ASSUME_YES=1，跳过确认'
} else {
  $confirm = Read-Host '确认执行? (输入 YES 继续)'
  if ($confirm -cne 'YES') {
    Write-Host ''
    Write-Host '[已取消] 未生成任何 keystore，未推送任何 secret'
    Pause-ForUser
    exit 0
  }
}

Write-Section '[6/6] 执行...'

$sharedBase64 = $null
if ($CONFIG.shared) {
  Write-Host ''
  try {
    $sharedBase64 = New-SharedKeystore -SharedPlan $sharedPlan -StorePassword $storePassword -KeyPassword $keyPassword -Tag '[共享]'
    $gitRoot = @($targetRoots | Where-Object { $sharedPlan.KeystorePath.StartsWith($_, [StringComparison]::OrdinalIgnoreCase) } | Select-Object -First 1)[0]
    if ($gitRoot) {
      & git -C $gitRoot check-ignore -q -- $sharedPlan.KeystorePath 2>$null
      if ($LASTEXITCODE -ne 0) {
        Write-WarningMessage -Message "$(Split-Path -Leaf $sharedPlan.KeystorePath) 未被 .gitignore 忽略，建议追加一行: *.jks"
      }
    }
  } catch {
    Write-Log -Message "[失败] 共享 keystore 未就绪: $($_.Exception.Message)" -Color 'Red'
  }
}

$results = @()
for ($i = 0; $i -lt $ready.Count; $i++) {
  $tag = "[$($i + 1)/$($ready.Count)]"
  $plan = $ready[$i]
  Write-Host ''
  if ($CONFIG.shared -and -not $sharedBase64) {
    Write-Log -Tag $tag -Message "[失败] $($plan.Name): 共享 keystore 未就绪，跳过" -Color 'Red'
    $results += [pscustomobject]@{ Ok = $false; Plan = $plan; Error = '共享 keystore 未就绪' }
    continue
  }
  try {
    if ($CONFIG.shared) {
      Push-TargetSecrets -Plan $plan -Tag $tag -Base64 $sharedBase64 -StorePassword $storePassword -KeyPassword $keyPassword -GhCommand $ghCommand
    } else {
      Invoke-TargetSetup -Plan $plan -Tag $tag -StorePassword $storePassword -KeyPassword $keyPassword -GhCommand $ghCommand
    }
    $results += [pscustomobject]@{ Ok = $true; Plan = $plan; Error = '' }
  } catch {
    Write-Log -Tag $tag -Message "[失败] $($plan.Name): $($_.Exception.Message)" -Color 'Red'
    $results += [pscustomobject]@{ Ok = $false; Plan = $plan; Error = $_.Exception.Message }
  }
}

$succeeded = @($results | Where-Object { $_.Ok })
$failed = @($results | Where-Object { -not $_.Ok })
$skipped = @($plans | Where-Object { $_.Skip })

Write-Host ''
Write-Host '================ 批量完成 ================'
Write-Host "成功 $($succeeded.Count) 个，失败 $($failed.Count) 个，跳过 $($skipped.Count) 个"
foreach ($result in $succeeded) {
  Write-Host "  ✔ $($result.Plan.Repo)"
  Write-Host "    keystore: $($result.Plan.KeystorePath)"
  Write-Host "    alias   : $($result.Plan.Alias)"
}
foreach ($result in $failed) { Write-Host "  ✘ $($result.Plan.Name): $($result.Error)" -ForegroundColor Red }
foreach ($plan in $skipped) { Write-Host "  - $($plan.Name): $($plan.Reason)" -ForegroundColor Yellow }
if ($CONFIG.shared -and $sharedPlan) {
  Write-Host ''
  Write-Host "共享 keystore（全部仓库共用）: $($sharedPlan.KeystorePath)"
}
Write-Host '=========================================='
Write-Host ''
Write-Host '[重要提示]'
if ($CONFIG.shared) {
  Write-Host '  1. 共享模式下所有仓库共用同一签名，请务必离线多地备份该 .jks'
  Write-Host '  2. 确认 .jks 与 *.base64.txt 已被 .gitignore 忽略，切勿提交'
  Write-Host '  3. 现在可以运行 GitHub Actions 构建签名的 APK/AAB'
} else {
  Write-Host '  1. 离线备份生成的 .jks；丢失后无法再发布同一签名的更新'
  Write-Host '  2. 确认 .jks 与 *.base64.txt 已被 .gitignore 忽略，切勿提交'
  Write-Host '  3. 现在可以运行 GitHub Actions 构建签名的 APK/AAB'
}

Pause-ForUser
if ($failed.Count -gt 0) { exit 1 }
exit 0
