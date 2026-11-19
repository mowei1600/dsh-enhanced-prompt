#!/usr/bin/env pwsh
# Install dsh-enhanced-prompt from GitHub (clone + local installer).
#
#   irm https://raw.githubusercontent.com/<owner>/<repo>/main/scripts/install.ps1 | iex
#
# Optional overrides:
#   $env:DSH_PROFILE = 'desktop'   profile to install into
#   $env:DSH_REPO    = 'owner/repo'
#   $env:DSH_REF     = 'main'
#
# Prefer this over piping when you want to inspect the script first:
#   git clone https://github.com/<owner>/<repo>.git; cd <repo>; node bin/install.mjs install --profile desktop

$ErrorActionPreference = 'Stop'

$profileName = if ($env:DSH_PROFILE) { $env:DSH_PROFILE } elseif ($args.Count -ge 1 -and $args[0]) { $args[0] } else { 'desktop' }
$repo = if ($env:DSH_REPO) { $env:DSH_REPO } else { 'mowei1600/dsh-enhanced-prompt' }
$ref = if ($env:DSH_REF) { $env:DSH_REF } else { 'main' }

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'git is required: https://git-scm.com/downloads'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Node.js >= 18 is required: https://nodejs.org'
}

$dest = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-enhanced-prompt-' + [Guid]::NewGuid().ToString('N'))
Write-Host "cloning $repo ($ref) -> $dest"
git clone --depth 1 --branch $ref "https://github.com/$repo.git" $dest
if ($LASTEXITCODE -ne 0) { throw "git clone failed for https://github.com/$repo" }

try {
  Write-Host "installing into profile '$profileName'"
  & node (Join-Path $dest 'bin/install.mjs') install --profile $profileName
  if ($LASTEXITCODE -ne 0) { throw 'installer failed' }
  Write-Host ''
  Write-Host 'Installed. Refresh the DSH window (Ctrl+R) to load the composer button.'
  Write-Host 'Verify with /enhance status in a chat, and check the Host log for [enhanced-prompt] lines.'
} finally {
  Remove-Item -Recurse -Force $dest -ErrorAction SilentlyContinue
}
