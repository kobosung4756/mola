# molanote launcher (molanote.cmd runs this). Checks what the app needs, installs what is missing,
# then starts the app in a hidden window (scripts/launch.mjs) and lets this console close.
#   1. Node.js 20.19+ / 22.12+ (what Vite needs). Missing or too old: offers to install the LTS with winget.
#   2. The npm packages in package-lock.json. Missing, or the lock file changed since the last install: npm ci.
# Failures are checked one by one (exit codes), so a tool printing to stderr is not an error.
$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$Host.UI.RawUI.WindowTitle = 'molanote'

function Stop-WithMessage([string]$text) {
  Write-Host ''
  Write-Host $text -ForegroundColor Red
  Write-Host ''
  Read-Host 'Enter 키를 누르면 창이 닫힙니다' | Out-Null
  exit 1
}

function Update-PathFromSystem {
  # A fresh install changes PATH only for new windows; read it again so this one sees node too.
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

function Find-Node {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $usual = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (Test-Path $usual) { return $usual }
  return $null
}

function Test-NodeVersion([string]$node) {
  try { $v = (& $node -p 'process.versions.node').Trim() } catch { return $null }
  $p = $v.Split('.') | ForEach-Object { [int]$_ }
  $ok = ($p[0] -eq 20 -and $p[1] -ge 19) -or ($p[0] -eq 22 -and $p[1] -ge 12) -or $p[0] -ge 23
  return @{ Version = $v; Ok = $ok }
}

# ---------- 1. Node.js ----------
$node = Find-Node
$info = if ($node) { Test-NodeVersion $node } else { $null }
if (-not $info -or -not $info.Ok) {
  if ($info) { Write-Host "설치된 Node.js $($info.Version)는 너무 오래되었습니다. (20.19 이상이 필요합니다)" -ForegroundColor Yellow }
  else { Write-Host 'molanote를 실행하려면 Node.js가 필요한데, 이 PC에는 설치되어 있지 않습니다.' -ForegroundColor Yellow }
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if (-not $winget) {
    Start-Process 'https://nodejs.org/ko/download'
    Stop-WithMessage '열린 페이지에서 Node.js LTS를 설치한 뒤 molanote.cmd를 다시 실행해 주세요.'
  }
  $answer = Read-Host '지금 Node.js LTS를 자동으로 설치할까요? (Y/N)'
  if ($answer -notmatch '^\s*[yY예ㅛ]') {
    Start-Process 'https://nodejs.org/ko/download'
    Stop-WithMessage '설치하지 않았습니다. 열린 페이지에서 Node.js LTS를 설치한 뒤 molanote.cmd를 다시 실행해 주세요.'
  }
  Write-Host 'Node.js를 설치하는 중입니다. 관리자 권한을 묻는 창이 뜨면 "예"를 눌러 주세요...'
  & $winget.Source install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  Update-PathFromSystem
  $node = Find-Node
  $info = if ($node) { Test-NodeVersion $node } else { $null }
  if (-not $info -or -not $info.Ok) {
    Start-Process 'https://nodejs.org/ko/download'
    Stop-WithMessage 'Node.js를 자동으로 설치하지 못했습니다. 열린 페이지에서 직접 설치한 뒤 molanote.cmd를 다시 실행해 주세요.'
  }
  Write-Host "Node.js $($info.Version) 설치 완료." -ForegroundColor Green
}
$nodeDir = Split-Path -Parent $node
$env:Path = "$nodeDir;$env:Path"
$npm = Join-Path $nodeDir 'npm.cmd'
if (-not (Test-Path $npm)) { $npm = 'npm.cmd' }

# ---------- 2. Packages ----------
# The lock file's hash is kept in node_modules after each install, so a newer beta with
# different packages installs again even though node_modules is already there.
$stamp = Join-Path $root 'node_modules\.board-studio-lock'
$lockHash = (Get-FileHash (Join-Path $root 'package-lock.json') -Algorithm SHA256).Hash
$have = if (Test-Path $stamp) { (Get-Content $stamp -Raw).Trim() } else { '' }
if ($have -ne $lockHash) {
  $ready = $false
  if (-not $have -and (Test-Path (Join-Path $root 'node_modules\vite'))) {
    # Installed before this check existed: keep it if it already matches the lock file.
    & $npm ls --depth=0 --silent *> $null
    $ready = $LASTEXITCODE -eq 0
  }
  if (-not $ready) {
    Write-Host '필요한 패키지를 내려받는 중입니다. 처음 한 번만 1~3분 정도 걸립니다(인터넷 필요)...'
    & $npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) {
      Stop-WithMessage '패키지를 설치하지 못했습니다. 인터넷 연결을 확인하고 molanote.cmd를 다시 실행해 주세요. (molanote가 이미 열려 있다면 stop.cmd로 먼저 끄세요.)'
    }
  }
  Set-Content -Path $stamp -Value $lockHash -Encoding ascii
}

# ---------- 3. Data folder ----------
# Not asked here any more: the first time, the app opens with the default folder
# (C:\Users\<name>\molanote-data) and asks in its own window where the data should be kept
# (Google Drive first, when it is on this PC). The choice goes to %APPDATA%\molanote\config.json.

# ---------- 4. Shortcuts with the molanote icon ----------
# A .cmd file cannot carry an icon, so "molanote" shortcuts with the logo open the app: one on the
# desktop and one in the Start menu (so it can be found by typing "molanote").
# They are pointed at this copy on every start, so after unzipping a new version, starting it once
# makes the desktop icon open the new one.
function Set-MolanoteShortcut([string]$file) {
  try {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($file)
    $link.TargetPath = Join-Path $root 'molanote.cmd'
    $link.WorkingDirectory = $root
    $link.IconLocation = (Join-Path $root 'scripts\molanote.ico') + ',0'
    $link.Description = 'molanote 열기'
    $link.WindowStyle = 7 # the short-lived console starts minimised
    $link.Save()
  } catch {
    # A shortcut that cannot be made (a locked desktop, say) is not worth stopping for.
  }
}
if ($env:MOLANOTE_SHORTCUT_DIR) {
  $shortcutDirs = @($env:MOLANOTE_SHORTCUT_DIR) # for automated checks
} else {
  $shortcutDirs = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
}
foreach ($d in $shortcutDirs) {
  if ($d -and (Test-Path $d)) { Set-MolanoteShortcut (Join-Path $d 'molanote.lnk') }
}

# ---------- 5. Start ----------
# The app gets its own hidden window, so this console can close.
Start-Process -WindowStyle Hidden -FilePath $node -ArgumentList 'scripts/launch.mjs' -WorkingDirectory $root
