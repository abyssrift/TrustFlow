[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$adapter = Join-Path $root 'scripts/claude-challenge.ps1'
$temp = Join-Path ([IO.Path]::GetTempPath()) "trustflow-claude-challenge-$([guid]::NewGuid())"
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  $promptFile = Join-Path $temp 'prompt.txt'
  'Challenge this packet.' | Set-Content $promptFile
  $fake = Join-Path $temp 'fake-claude.cmd'
  $success = '{"structured_output":{"summary":"No issues found.","findings":[]}}'
  "@echo $success" | Set-Content $fake -Encoding ASCII
  $out = Join-Path $temp 'success'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $adapter -Phase plan -PromptFile $promptFile -OutputDir $out -ClaudeCommand $fake
  if ($LASTEXITCODE -ne 0) { throw "success case exited $LASTEXITCODE" }
  if ((Get-Content (Join-Path $out 'report.json') -Raw | ConvertFrom-Json).status -ne 'accepted') { throw 'success report was not accepted' }
  $adapterText = Get-Content $adapter -Raw
  if ($adapterText -notmatch "--allowedTools.*Read Bash\(git diff \*\) Bash\(git status \*\)" -or $adapterText -match "Edit|Write|Commit|Reset|migrate") { throw 'challenge adapter was not read-only' }

  $critical = '{"structured_output":{"summary":"Unsafe.","findings":[{"severity":"critical","claim":"The plan permits a data leak.","evidence":"plan.md:12","recommendation":"Remove the unrestricted read path."}]}}'
  "@echo $critical" | Set-Content $fake -Encoding ASCII
  $blockedOut = Join-Path $temp 'blocked'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $adapter -Phase implementation -PromptFile $promptFile -OutputDir $blockedOut -ClaudeCommand $fake
  if ($LASTEXITCODE -ne 10) { throw "critical case exited $LASTEXITCODE" }
  if (-not (Select-String -LiteralPath (Join-Path $blockedOut 'report.md') -Pattern 'CRITICAL')) { throw 'critical finding missing from report' }

  $bad = Join-Path $temp 'bad.cmd'
  '@echo not-json' | Set-Content $bad -Encoding ASCII
  $badOut = Join-Path $temp 'bad'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $adapter -Phase plan -PromptFile $promptFile -OutputDir $badOut -ClaudeCommand $bad
  if ($LASTEXITCODE -ne 3) { throw "malformed case exited $LASTEXITCODE" }

  $missingOut = Join-Path $temp 'missing'
  & powershell -NoProfile -ExecutionPolicy Bypass -File $adapter -Phase plan -PromptFile $promptFile -OutputDir $missingOut -ClaudeCommand (Join-Path $temp 'does-not-exist.cmd')
  if ($LASTEXITCODE -ne 2) { throw "missing executable case exited $LASTEXITCODE" }

  Write-Output 'claude-challenge fixture tests passed'
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}
