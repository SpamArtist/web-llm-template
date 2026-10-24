# No package installation, network access, or scheduler mutation occurs here.
$ErrorActionPreference = 'Stop'
try {
    if (-not (Get-Command git -ErrorAction SilentlyContinue) -or
        -not (Get-Command node -ErrorAction SilentlyContinue)) {
        throw 'Missing Git or Node.js'
    }
    $planningRoot = & git rev-parse --show-toplevel 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Repository root unavailable' }
    Set-Location -LiteralPath $planningRoot
    & node (Join-Path $planningRoot 'meta/spec-planning/hooks/session-start.js')
    if ($LASTEXITCODE -ne 0) { throw 'Hook helper unavailable' }
} catch {
    Write-Output '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Local spec-planning setup is incomplete: Git, Node.js, or the repository root is unavailable. Continue unrelated work. Restore the prerequisite and start or resume Codex to retry; do not configure an external scheduler."}}'
}
exit 0
