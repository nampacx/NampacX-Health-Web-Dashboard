<#
.SYNOPSIS
  One-time setup for the GitHub Actions -> Azure OIDC trust used by
  .github/workflows/deploy-function.yml. Creates the app registration and
  service principal, registers the federated credentials, grants the roles the
  Bicep template needs, and writes AZURE_CLIENT_ID / AZURE_TENANT_ID /
  AZURE_SUBSCRIPTION_ID as repository secrets.

  Safe to re-run: every step checks for what it would create first.

.DESCRIPTION
  Two details make this fiddly enough to be worth a script rather than a
  checklist, and both are silent failures if you get them wrong:

  1. THE SUBJECT MUST MATCH THE JOB'S TRIGGER, NOT THE BRANCH.
     When a workflow job declares `environment: <name>`, GitHub puts the
     environment in the OIDC `sub` claim *instead of* the ref:

         repo:OWNER/REPO:environment:production     <- what our job sends
         repo:OWNER/REPO:ref:refs/heads/main        <- what it does NOT send

     deploy-function.yml declares `environment: production`, so a credential
     registered against refs/heads/main never matches and login fails with
     AADSTS700213. That is why -Environments, not -Branches, is the default.

  2. THE SUBJECT MAY OR MAY NOT CARRY NUMERIC IDS.
     GitHub is mid-migration to "immutable" subjects, which pin the owner and
     repo by ID so a renamed or recycled repo cannot inherit the trust:

         repo:OWNER/REPO:environment:production                  (mutable)
         repo:OWNER@8090625/REPO@1335896422:environment:production  (immutable)

     Per GitHub's docs, repositories created after 2026-07-15 default to the
     immutable form; older ones keep the mutable form unless opted in. The REST
     field `use_immutable_subject` is supposed to report which applies -- but it
     is NOT reliable here: it reads false for repositories created after that
     cutoff, which by the documented rule should be immutable.

     Evidence from this account, rather than from the flag: nampacx/BulletinBoard
     (created 2026-08-11, also post-cutoff, also reporting the flag as false)
     authenticates through azure/login OIDC on every push to main, its runs are
     green, and the only credential that can be matching them is the immutable
     one -- repo:nampacx@8090625/BulletinBoard@1330769284:environment:dev.
     So GitHub is issuing immutable subjects while the flag says otherwise, and
     this repository (created 2026-08-16) should behave the same way.

     Default is therefore -SubjectForm Both: register the credential twice, once
     per form, so the run cannot fail on a wrong guess. The immutable one is the
     one expected to match. They identify the same repository and Entra permits
     20 credentials per app, so the spare costs nothing. After a confirmed green
     run, re-run with -SubjectForm Immutable and delete the mutable credential to
     drop the namespace-recycling risk it carries.

.PARAMETER ResourceGroup
  Narrows the role assignments to one resource group. Omit to grant at
  subscription scope, which azd requires when it has to create the group
  itself (it does for any environment it has not provisioned before).

.EXAMPLE
  ./scripts/bootstrap-github-oidc.ps1 -WhatIf
  Shows every change without making any.

.EXAMPLE
  ./scripts/bootstrap-github-oidc.ps1 -ResourceGroup rg-hlth-dshbrd-dev
  Least-privilege variant, for when the resource group already exists.
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [string]$Owner,
  [string]$Repo,
  [string]$AppName,
  [string]$SubscriptionId,
  [string]$ResourceGroup,

  # Environments whose deployments may assume the identity. Must match the
  # `environment:` key of the job, byte for byte, including case.
  [string[]]$Environments = @('production'),

  # Branches to additionally trust. Only needed for jobs with no `environment:`
  # key -- ours has one, so this is empty by default.
  [string[]]$Branches = @(),

  [ValidateSet('Both', 'Mutable', 'Immutable')]
  [string]$SubjectForm = 'Both',

  # The template in infra/ creates role assignments (Storage Blob Data Owner,
  # Key Vault Secrets User), which Contributor alone cannot do.
  [string[]]$Roles = @('Contributor', 'User Access Administrator'),

  [switch]$SkipGitHubSecrets
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------

function Invoke-Native {
  param([string]$Exe, [string[]]$Arguments, [switch]$AllowFailure)
  $output = & $Exe @Arguments 2>&1
  if ($LASTEXITCODE -ne 0 -and -not $AllowFailure) {
    throw "$Exe $($Arguments -join ' ') failed:`n$output"
  }
  return ($output | Out-String).Trim()
}

# Takes one array rather than loose arguments on purpose: PowerShell would
# otherwise try to bind az's own `-o` as the common parameter -OutVariable.
function Invoke-Az {
  param([Parameter(Mandatory, Position = 0)][string[]]$Arguments)
  Invoke-Native -Exe 'az' -Arguments (@($Arguments) + '--only-show-errors')
}

function Write-Step { param([string]$Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Write-Info { param([string]$Message) Write-Host "    $Message" }
function Write-Ok { param([string]$Message) Write-Host "    $Message" -ForegroundColor Green }
function Write-Skip { param([string]$Message) Write-Host "    $Message" -ForegroundColor DarkGray }

# --------------------------------------------------------------------------
# preflight
# --------------------------------------------------------------------------

Write-Step 'Checking prerequisites'

foreach ($tool in 'az', 'gh') {
  if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) {
    throw "'$tool' is not on PATH. Install the Azure CLI and the GitHub CLI first."
  }
}

$account = Invoke-Az @('account', 'show', '-o', 'json') | ConvertFrom-Json
if (-not $SubscriptionId) { $SubscriptionId = $account.id }
$tenantId = $account.tenantId
Write-Ok "Azure: $($account.name) / $SubscriptionId (tenant $tenantId)"

Invoke-Native -Exe 'gh' -Arguments @('auth', 'status') | Out-Null

# Default the repo from the origin remote, so the common case needs no args.
if (-not $Owner -or -not $Repo) {
  $originUrl = Invoke-Native -Exe 'git' -Arguments @('remote', 'get-url', 'origin')
  if ($originUrl -notmatch 'github\.com[:/]([^/]+)/(.+?)(\.git)?$') {
    throw "Could not parse an owner/repo out of the origin remote '$originUrl'. Pass -Owner and -Repo."
  }
  if (-not $Owner) { $Owner = $Matches[1] }
  if (-not $Repo) { $Repo = $Matches[2] }
}
$repoSlug = "$Owner/$Repo"
if (-not $AppName) { $AppName = "gh-oidc-$Repo" }
Write-Ok "GitHub: $repoSlug"

# --------------------------------------------------------------------------
# work out the subject(s) GitHub will actually send
# --------------------------------------------------------------------------

Write-Step 'Resolving the OIDC subject format'

$repoInfo = Invoke-Native -Exe 'gh' -Arguments @('api', "/repos/$repoSlug", '--jq', '{id:.id, owner_id:.owner.id}') | ConvertFrom-Json
$subConfig = Invoke-Native -Exe 'gh' -Arguments @('api', "/repos/$repoSlug/actions/oidc/customization/sub") -AllowFailure

$reportsImmutable = $false
if ($subConfig -and $subConfig -notmatch 'Not Found') {
  $parsed = $subConfig | ConvertFrom-Json
  if ($parsed.PSObject.Properties.Name -contains 'use_immutable_subject') {
    $reportsImmutable = [bool]$parsed.use_immutable_subject
  }
  if (-not $parsed.use_default) {
    Write-Warning "This repository uses a CUSTOM OIDC subject template (use_default=false). The subjects below are built from the standard template and may not match. Inspect: gh api /repos/$repoSlug/actions/oidc/customization/sub"
  }
}

$mutablePrefix = "repo:$Owner/$Repo"
$immutablePrefix = "repo:$Owner@$($repoInfo.owner_id)/$Repo@$($repoInfo.id)"

Write-Info "GitHub reports use_immutable_subject = $reportsImmutable"
Write-Info "mutable prefix   $mutablePrefix"
Write-Info "immutable prefix $immutablePrefix"

$prefixes = switch ($SubjectForm) {
  'Mutable' { @($mutablePrefix) }
  'Immutable' { @($immutablePrefix) }
  default { @($mutablePrefix, $immutablePrefix) }
}

# name suffix keeps the two forms distinguishable in the portal
$credentials = @()
foreach ($prefix in $prefixes) {
  $tag = if ($prefix -eq $immutablePrefix) { 'imm' } else { 'mut' }
  foreach ($env in $Environments) {
    $credentials += [pscustomobject]@{
      Name    = "gh-$tag-env-$($env -replace '[^A-Za-z0-9-]', '-')"
      Subject = "${prefix}:environment:$env"
    }
  }
  foreach ($branch in $Branches) {
    $credentials += [pscustomobject]@{
      Name    = "gh-$tag-branch-$($branch -replace '[^A-Za-z0-9-]', '-')"
      Subject = "${prefix}:ref:refs/heads/$branch"
    }
  }
}

if (-not $credentials) { throw 'Nothing to register: pass -Environments and/or -Branches.' }
foreach ($c in $credentials) { Write-Info "will trust  $($c.Subject)" }

# --------------------------------------------------------------------------
# app registration + service principal
# --------------------------------------------------------------------------

Write-Step "Application registration '$AppName'"

$appId = Invoke-Az @('ad', 'app', 'list', '--display-name', $AppName, '--query', '[0].appId', '-o', 'tsv')
if ($appId) {
  Write-Skip "already exists ($appId)"
}
elseif ($PSCmdlet.ShouldProcess($AppName, 'Create Entra application registration')) {
  $appId = Invoke-Az @('ad', 'app', 'create', '--display-name', $AppName, '--query', 'appId', '-o', 'tsv')
  Write-Ok "created ($appId)"
}
else {
  $appId = '<app-id-pending>'
}

$spObjectId = $null
if ($appId -ne '<app-id-pending>') {
  $spObjectId = Invoke-Az @('ad', 'sp', 'list', '--filter', "appId eq '$appId'", '--query', '[0].id', '-o', 'tsv')
  if ($spObjectId) {
    Write-Skip "service principal already exists ($spObjectId)"
  }
  elseif ($PSCmdlet.ShouldProcess($appId, 'Create service principal')) {
    $spObjectId = Invoke-Az @('ad', 'sp', 'create', '--id', $appId, '--query', 'id', '-o', 'tsv')
    Write-Ok "service principal created ($spObjectId)"
  }
}

# --------------------------------------------------------------------------
# federated credentials
# --------------------------------------------------------------------------

Write-Step 'Federated credentials'

$existing = @()
if ($appId -ne '<app-id-pending>') {
  $raw = Invoke-Az @('ad', 'app', 'federated-credential', 'list', '--id', $appId, '-o', 'json')
  if ($raw) { $existing = @($raw | ConvertFrom-Json) }
}

foreach ($cred in $credentials) {
  $match = $existing | Where-Object { $_.subject -eq $cred.Subject }
  if ($match) {
    Write-Skip "exists  $($cred.Subject)"
    continue
  }
  if (-not $PSCmdlet.ShouldProcess($cred.Subject, 'Add federated credential')) { continue }

  $body = @{
    name        = $cred.Name
    issuer      = 'https://token.actions.githubusercontent.com'
    subject     = $cred.Subject
    description = "GitHub Actions OIDC for $repoSlug"
    audiences   = @('api://AzureADTokenExchange')
  } | ConvertTo-Json -Compress

  # az wants this as a file on Windows -- inline JSON gets mangled by quoting.
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    Set-Content -Path $tmp -Value $body -Encoding utf8
    Invoke-Az @('ad', 'app', 'federated-credential', 'create', '--id', $appId, '--parameters', "@$tmp") | Out-Null
    Write-Ok "added   $($cred.Subject)"
  }
  finally {
    Remove-Item $tmp -Force -ErrorAction SilentlyContinue
  }
}

# --------------------------------------------------------------------------
# role assignments
# --------------------------------------------------------------------------

$scope = if ($ResourceGroup) {
  "/subscriptions/$SubscriptionId/resourceGroups/$ResourceGroup"
}
else {
  "/subscriptions/$SubscriptionId"
}

Write-Step "Role assignments at $scope"

if ($ResourceGroup) {
  $rgExists = Invoke-Az @('group', 'exists', '--name', $ResourceGroup, '--subscription', $SubscriptionId)
  if ($rgExists -ne 'true') {
    throw "Resource group '$ResourceGroup' does not exist. Create it first, or omit -ResourceGroup so the roles are granted at subscription scope (azd needs that to create the group itself)."
  }
}
else {
  Write-Info 'Subscription scope: azd can create new resource groups. Pass -ResourceGroup to narrow this.'
}

foreach ($role in $Roles) {
  if (-not $spObjectId) {
    Write-Skip "would assign '$role' (service principal not created yet)"
    continue
  }

  $already = Invoke-Az @('role', 'assignment', 'list', '--assignee', $spObjectId, '--scope', $scope, '--role', $role, '--query', '[0].id', '-o', 'tsv')
  if ($already) {
    Write-Skip "exists  $role"
    continue
  }
  if (-not $PSCmdlet.ShouldProcess("$role at $scope", 'Assign role')) { continue }

  # A freshly created service principal is not immediately visible to ARM.
  $assigned = $false
  foreach ($attempt in 1..6) {
    try {
      Invoke-Az @(
        'role', 'assignment', 'create',
        '--assignee-object-id', $spObjectId,
        '--assignee-principal-type', 'ServicePrincipal',
        '--role', $role,
        '--scope', $scope) | Out-Null
      $assigned = $true
      break
    }
    catch {
      if ($attempt -eq 6) { throw }
      Write-Info "directory replication lag, retrying ($attempt/5)…"
      Start-Sleep -Seconds 10
    }
  }
  if ($assigned) { Write-Ok "granted $role" }
}

# --------------------------------------------------------------------------
# repository secrets
# --------------------------------------------------------------------------

if (-not $SkipGitHubSecrets) {
  Write-Step 'Repository secrets'
  $secrets = @{
    AZURE_CLIENT_ID       = $appId
    AZURE_TENANT_ID       = $tenantId
    AZURE_SUBSCRIPTION_ID = $SubscriptionId
  }
  foreach ($name in $secrets.Keys | Sort-Object) {
    if (-not $PSCmdlet.ShouldProcess("$name on $repoSlug", 'Set repository secret')) { continue }
    Invoke-Native -Exe 'gh' -Arguments @('secret', 'set', $name, '--repo', $repoSlug, '--body', $secrets[$name]) | Out-Null
    Write-Ok "set $name"
  }
}

# --------------------------------------------------------------------------

Write-Step 'Done'
Write-Info "AZURE_CLIENT_ID       $appId"
Write-Info "AZURE_TENANT_ID       $tenantId"
Write-Info "AZURE_SUBSCRIPTION_ID $SubscriptionId"
Write-Host ''
Write-Info 'Nothing here proves the trust works -- only a real token exchange does. Verify with:'
Write-Info "  gh workflow run deploy-function.yml --repo $repoSlug"
Write-Info "  gh run watch --repo $repoSlug"
Write-Info 'A failure at the "Log in to Azure (OIDC)" step with AADSTS700213 means no'
Write-Info 'federated credential matched the subject; compare the subject the error quotes'
Write-Info 'against the ones listed above.'
