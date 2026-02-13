param(
  [string]$BaseBranch = "master"
)

$ErrorActionPreference = "Stop"

function Test-RefExists {
  param([string]$RefName)
  git show-ref --verify --quiet $RefName
  return $LASTEXITCODE -eq 0
}

$repoRoot = git rev-parse --show-toplevel
if ($LASTEXITCODE -ne 0) {
  throw "Not inside a git repository."
}

Set-Location $repoRoot

$baseRef = if (Test-RefExists "refs/remotes/origin/$BaseBranch") {
  "origin/$BaseBranch"
} elseif (Test-RefExists "refs/heads/$BaseBranch") {
  $BaseBranch
} else {
  throw "Base branch '$BaseBranch' was not found locally or on origin."
}

$parent = Split-Path $repoRoot -Parent
$targets = @(
  @{ Name = "a1"; Branch = "feat/tetris-a1-product" },
  @{ Name = "a2"; Branch = "feat/tetris-a2-engine" },
  @{ Name = "a3"; Branch = "feat/tetris-a3-ui" },
  @{ Name = "a4"; Branch = "feat/tetris-a4-qa" }
)

foreach ($t in $targets) {
  $path = Join-Path $parent ("vibe-terminal-" + $t.Name)
  if (Test-Path $path) {
    Write-Host "Skip existing path: $path"
    continue
  }

  Write-Host "Create worktree $path on branch $($t.Branch) from $baseRef"
  git worktree add $path -b $t.Branch $baseRef
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create worktree for $($t.Name)."
  }
}

Write-Host ""
Write-Host "Done. Open one terminal per path:"
foreach ($t in $targets) {
  Write-Host ("- " + (Join-Path $parent ("vibe-terminal-" + $t.Name)))
}
Write-Host ""
Write-Host "Then follow:"
Write-Host "- a1: worklist/tetris-4-agent/01-agent-product-scope.md"
Write-Host "- a2: worklist/tetris-4-agent/02-agent-core-engine.md"
Write-Host "- a3: worklist/tetris-4-agent/03-agent-ui-input.md"
Write-Host "- a4: worklist/tetris-4-agent/04-agent-qa-release.md"

