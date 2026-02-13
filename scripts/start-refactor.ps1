$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command wt -ErrorAction SilentlyContinue)) {
  Write-Error "Windows Terminal (wt) is not installed or not in PATH."
}

function Open-RefactorTab {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][string]$Banner,
    [AllowEmptyString()][string]$Run = ""
  )

  $cmd = "$Host.UI.RawUI.WindowTitle='$Title'; Write-Host '$Banner'; $Run"
  Start-Process wt -ArgumentList '-w', '0', 'new-tab', '-d', $projectRoot, 'powershell', '-NoExit', '-Command', $cmd
}

Open-RefactorTab -Title "T1-DEV" -Banner "[T1] Main Dev" -Run ""
Open-RefactorTab -Title "T2-TEST" -Banner "[T2] Test Watch" -Run "npm test -- --watch"
Open-RefactorTab -Title "T3-LINT" -Banner "[T3] Lint Watch" -Run "npm run lint -- --watch"
Open-RefactorTab -Title "T4-DEVSERVER" -Banner "[T4] Dev Server" -Run "npm run dev"
Open-RefactorTab -Title "T5-GIT" -Banner "[T5] Git Ops" -Run ""
Open-RefactorTab -Title "T6-SEARCH" -Banner "[T6] Search/Refactor Support" -Run ""

Write-Host "Opened 6 refactor tabs in Windows Terminal."
