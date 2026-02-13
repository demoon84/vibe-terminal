param(
  [string]$InstructionPath = "worklist/tetris-4-agent/01-agent-product-scope.md",
  [string]$OnChangeCommand = "",
  [int]$PollSeconds = 2,
  [switch]$RunAtStart,
  [switch]$ShowContent
)

$ErrorActionPreference = "Stop"

function Get-SafeHash {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) {
    return ""
  }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash
}

if (-not (Test-Path -LiteralPath $InstructionPath)) {
  throw "Instruction file not found: $InstructionPath"
}

$resolvedInstruction = (Resolve-Path -LiteralPath $InstructionPath).Path
$lastHash = Get-SafeHash -Path $resolvedInstruction

Write-Host "Watching instruction file: $resolvedInstruction"
Write-Host "Poll interval (sec): $PollSeconds"
if ([string]::IsNullOrWhiteSpace($OnChangeCommand)) {
  Write-Host "OnChangeCommand: (none, manual processing)"
} else {
  Write-Host "OnChangeCommand: $OnChangeCommand"
}
Write-Host "Stop with Ctrl+C."
Write-Host ""

function Invoke-ProcessStep {
  param(
    [string]$Path,
    [string]$Command,
    [switch]$PrintContent
  )

  $now = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$now] Change detected."
  if ($PrintContent) {
    Write-Host "--- Updated instruction ---"
    Get-Content -LiteralPath $Path
    Write-Host "---------------------------"
  }

  if ([string]::IsNullOrWhiteSpace($Command)) {
    Write-Host "No OnChangeCommand configured. Process the instruction manually."
    Write-Host ""
    return
  }

  Write-Host "Running OnChangeCommand..."
  try {
    Invoke-Expression $Command
    Write-Host "OnChangeCommand completed."
  } catch {
    Write-Host "OnChangeCommand failed: $($_.Exception.Message)"
  }
  Write-Host ""
}

if ($RunAtStart) {
  Invoke-ProcessStep -Path $resolvedInstruction -Command $OnChangeCommand -PrintContent:$ShowContent
}

while ($true) {
  Start-Sleep -Seconds $PollSeconds

  if (-not (Test-Path -LiteralPath $resolvedInstruction)) {
    Write-Host "Instruction file missing: $resolvedInstruction"
    continue
  }

  $newHash = Get-SafeHash -Path $resolvedInstruction
  if ($newHash -ne $lastHash) {
    $lastHash = $newHash
    Invoke-ProcessStep -Path $resolvedInstruction -Command $OnChangeCommand -PrintContent:$ShowContent
  }
}

