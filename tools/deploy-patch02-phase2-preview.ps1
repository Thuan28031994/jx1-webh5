# Patch 02 Phase 2: isolated Cloudflare Pages PREVIEW deployment.
# Does NOT publish the production branch. Default is dry run.
# Uses the same build for 80+ Playwright tests and preview upload.
[CmdletBinding()]
param(
    [string]$RepoRoot = "C:\Users\amecopain\VLI\vo-lam-idle",
    [string]$ProjectName = "vli-thuan-2026",
    [string]$PreviewBranch = "patch02-phase2",
    [switch]$PublishPreview
)
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Assert-Exit([string]$label) {
    if ($LASTEXITCODE -ne 0) {
        throw "$label failed (exit $LASTEXITCODE). No preview upload was attempted."
    }
}
if ($PreviewBranch -eq 'main') {
    throw "Safety: preview branch must never be main."
}
$root = (Resolve-Path -LiteralPath $RepoRoot).ProviderPath
$web = Join-Path $root 'web'
$artifact = Join-Path $root 'patch02-test-out'
if (!(Test-Path -LiteralPath (Join-Path $web 'scripts\sync-android.mjs') -PathType Leaf)) {
    throw "Expected game Next.js repository at $root"
}
foreach ($exe in @('git.exe','npm.cmd','npx.cmd')) {
    if (!(Get-Command $exe -ErrorAction SilentlyContinue)) {
        throw "Missing dependency: $exe"
    }
}

Push-Location $root
try {
    $gitBranch = (& git branch --show-current).Trim()
    Assert-Exit 'git branch'
    if ($gitBranch -ne 'patch/volam-v12-7-phase2') {
        throw "Expected patch/volam-v12-7-phase2; currently on '$gitBranch'"
    }
    $head = (& git rev-parse --short HEAD).Trim()
    Assert-Exit 'git revision'
    Write-Host "V12.7 phase 2 HEAD: $head (preview only)"

    Push-Location $web
    try {
        Write-Host '=== TypeScript ==='
        & npm.cmd run typecheck
        Assert-Exit 'TypeScript'

        Write-Host '=== Fresh isolated static bundle ==='
        & npm.cmd run android:sync -- --out patch02-test-out
        Assert-Exit 'Next.js static build'

        foreach ($rel in @('index.html','_next','img','jdata\jx.json')) {
            if (!(Test-Path -LiteralPath (Join-Path $artifact $rel))) {
                throw "Missing artifact path: $rel"
            }
        }
        $files = @(Get-ChildItem -LiteralPath $artifact -Recurse -File)
        if ($files.Count -lt 1000 -or $files.Count -gt 20000) {
            throw "Unexpected Pages file count $($files.Count)"
        }
        if (@($files | Where-Object { $_.Length -gt 25MB }).Count) {
            throw 'An asset exceeds the Pages 25MiB per-file limit.'
        }
        Write-Host "Artifact: $artifact ($($files.Count) files)"

        Write-Host '=== Regression against this exact bundle ==='
        $before = [Environment]::GetEnvironmentVariable('VLI_PATCH02_TEST','Process')
        try {
            [Environment]::SetEnvironmentVariable('VLI_PATCH02_TEST','1','Process')
            & npx.cmd playwright test --workers=8
            Assert-Exit 'Playwright regression'
        }
        finally {
            [Environment]::SetEnvironmentVariable('VLI_PATCH02_TEST',$before,'Process')
        }

        if (!$PublishPreview) {
            Write-Host 'DRY RUN OK. No upload. Pass -PublishPreview to deploy a non-production Pages preview.'
            return
        }

        Write-Host '=== Uploading PREVIEW, never --branch=main ==='
        & npx.cmd wrangler pages deploy "$artifact" --project-name=$ProjectName --branch=$PreviewBranch --commit-dirty=true
        Assert-Exit 'Cloudflare Pages preview upload'
        Write-Host 'Preview upload finished. Use the exact URL reported by Wrangler.'
        Write-Host 'Do not promote to production until Worker owner, CORS, two real browser sessions and saved characters are verified.'
    }
    finally { Pop-Location }
}
finally { Pop-Location }
