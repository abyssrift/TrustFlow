[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('plan', 'implementation')]
  [string] $Phase,

  [Parameter(Mandatory = $true)]
  [ValidateScript({ Test-Path -LiteralPath $_ -PathType Leaf })]
  [string] $PromptFile,

  [Parameter(Mandatory = $true)]
  [string] $OutputDir,

  [string] $ClaudeCommand = 'claude'
)

$ErrorActionPreference = 'Stop'
$started = [DateTime]::UtcNow
$repo = (Get-Location).Path
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$schemaFile = Join-Path $scriptDir 'claude-challenge.schema.json'

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$prompt = Get-Content -LiteralPath $PromptFile -Raw
$schema = Get-Content -LiteralPath $schemaFile -Raw
$request = [ordered]@{
  phase = $Phase
  started_at = $started.ToString('o')
  repository = $repo
  prompt_sha256 = (Get-FileHash -LiteralPath $PromptFile -Algorithm SHA256).Hash
  prompt_length = $prompt.Length
  claude_command = $ClaudeCommand
  adapter = 'scripts/claude-challenge.ps1'
}
$request | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $OutputDir 'request.json') -Encoding UTF8
Copy-Item -LiteralPath $PromptFile -Destination (Join-Path $OutputDir 'prompt.txt') -Force

$stdoutFile = Join-Path $OutputDir 'claude.stdout'
$stderrFile = Join-Path $OutputDir 'claude.stderr'
$args = @(
  '--bare', '-p', $prompt,
  '--output-format', 'json',
  '--json-schema', $schema,
  '--allowedTools', 'Read Bash(git diff *) Bash(git status *)',
  '--permission-prompts', 'none'
)

$exitCode = 0
try {
  & $ClaudeCommand @args 1> $stdoutFile 2> $stderrFile
  $exitCode = $LASTEXITCODE
} catch {
  $_ | Out-String | Set-Content -LiteralPath $stderrFile -Encoding UTF8
  $exitCode = 127
}

$raw = if (Test-Path -LiteralPath $stdoutFile) { Get-Content -LiteralPath $stdoutFile -Raw } else { '' }
if ($raw.Trim().Length -eq 0) {
  $diagnostic = [ordered]@{ status = 'error'; error = 'Claude returned no JSON output'; process_exit_code = $exitCode }
  $diagnostic | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDir 'report.json') -Encoding UTF8
  '# Claude challenge failed' | Set-Content -LiteralPath (Join-Path $OutputDir 'report.md') -Encoding UTF8
  "`nClaude returned no JSON output. See claude.stderr." | Add-Content -LiteralPath (Join-Path $OutputDir 'report.md')
  exit 2
}

$raw | Set-Content -LiteralPath (Join-Path $OutputDir 'claude.json') -Encoding UTF8
try {
  $response = $raw | ConvertFrom-Json
  $structured = $response.structured_output
  if ($null -eq $structured -or $null -eq $structured.findings) { throw 'Missing structured_output.findings' }
  $findings = @($structured.findings)
  foreach ($finding in $findings) {
    if ($finding.severity -notin @('critical', 'warning', 'suggestion') -or
        [string]::IsNullOrWhiteSpace($finding.claim) -or
        [string]::IsNullOrWhiteSpace($finding.evidence) -or
        [string]::IsNullOrWhiteSpace($finding.recommendation)) {
      throw 'A finding is missing a valid severity, claim, evidence, or recommendation'
    }
  }
} catch {
  $diagnostic = [ordered]@{ status = 'error'; error = $_.Exception.Message; process_exit_code = $exitCode }
  $diagnostic | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDir 'report.json') -Encoding UTF8
  '# Claude challenge failed' | Set-Content -LiteralPath (Join-Path $OutputDir 'report.md') -Encoding UTF8
  "`nMalformed Claude response: $($_.Exception.Message)" | Add-Content -LiteralPath (Join-Path $OutputDir 'report.md')
  exit 3
}

$critical = @($findings | Where-Object severity -eq 'critical').Count
$report = [ordered]@{
  status = if ($critical -gt 0) { 'blocked' } else { 'accepted' }
  phase = $Phase
  started_at = $started.ToString('o')
  completed_at = [DateTime]::UtcNow.ToString('o')
  process_exit_code = $exitCode
  critical_count = $critical
  warning_count = @($findings | Where-Object severity -eq 'warning').Count
  suggestion_count = @($findings | Where-Object severity -eq 'suggestion').Count
  summary = [string]$structured.summary
  findings = $findings
}
$report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $OutputDir 'report.json') -Encoding UTF8

$lines = @('# Claude Challenge Report', '', "Phase: $Phase", "Status: $($report.status)", '', $report.summary, '')
if ($findings.Count -eq 0) { $lines += 'Stress test complete. Logic is airtight.' }
else {
  for ($i = 0; $i -lt $findings.Count; $i++) {
    $f = $findings[$i]
    $lines += "## $($i + 1). [$($f.severity.ToUpperInvariant())] $($f.claim)"
    $lines += "- Evidence: $($f.evidence)"
    $lines += "- Recommendation: $($f.recommendation)"
    $lines += '- Disposition: [ ] accepted  [ ] rejected with rationale  [ ] resolved'
    $lines += ''
  }
}
$lines | Set-Content -LiteralPath (Join-Path $OutputDir 'report.md') -Encoding UTF8
if ($critical -gt 0) { exit 10 }
if ($exitCode -ne 0) { exit 4 }
exit 0
