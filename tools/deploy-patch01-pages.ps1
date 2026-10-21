# Deploy Patch 01 (safe missing-media-only) to Cloudflare Pages production.
# Requires: verified staging ZIP extracted, Node/npm, Cloudflare Wrangler login.
# Does not import legacy JS or change save-state format.
[CmdletBinding()]
param(
    [string]$RepoRoot = "C:\Users\amecopain\VLI\vo-lam-idle",
    [string]$StagingDir = "D:\thuan\VLI-PATCH01-STAGING",
    [string]$ProjectName = "vli-thuan-2026",
    [string]$Domain = "thuanlam.qzz.io"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$mediaScript = Join-Path $PSScriptRoot "patch01-media.ps1"
if (!(Test-Path -LiteralPath $mediaScript -PathType Leaf)) {
    throw "Missing patch01-media.ps1 beside this script."
}
if (!(Test-Path -LiteralPath (Join-Path $StagingDir "index.html") -PathType Leaf)) {
    throw "Staging has no index.html."
}
$web = Join-Path $RepoRoot "web"
if (!(Test-Path -LiteralPath (Join-Path $web "scripts\sync-android.mjs") -PathType Leaf)) {
    throw "Not the expected Next.js repository: $web"
}
if (!(Get-Command "npm.cmd" -ErrorAction SilentlyContinue) -or
    !(Get-Command "npx.cmd" -ErrorAction SilentlyContinue)) {
    throw "Node.js npm/npx is not installed or not on PATH."
}

Write-Host "=== Patch 01: add only previously missing supported media ==="
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $mediaScript -StagingDir $StagingDir -RepoRoot $RepoRoot -Apply
if ($LASTEXITCODE -ne 0) { throw "Media import failed; production unchanged." }

Push-Location $web
try {
    Write-Host "=== TypeScript checks ==="
    & npm.cmd run typecheck
    if ($LASTEXITCODE -ne 0) { throw "typecheck failed; production unchanged." }

    Write-Host "=== Build static site ==="
    & npm.cmd run android:sync -- --out ../deploy
    if ($LASTEXITCODE -ne 0) { throw "Build failed; production unchanged." }

    Write-Host "=== Regression tests ==="
    & npm.cmd run test:regression
    if ($LASTEXITCODE -ne 0) { throw "Regression tests failed; production unchanged." }

    $deploy = (Resolve-Path -LiteralPath (Join-Path $RepoRoot "deploy")).ProviderPath
    foreach ($p in @("index.html", "_next", "jdata\jx.json", "img")) {
        if (!(Test-Path -LiteralPath (Join-Path $deploy $p))) {
            throw "Build output is incomplete ($p); production unchanged."
        }
    }

    $files = @(Get-ChildItem -LiteralPath $deploy -File -Recurse)
    if ($files.Count -gt 20000) {
        throw "More than 20000 files in Pages output; production unchanged."
    }
    $tooLarge = @($files | Where-Object { $_.Length -gt 25MB })
    if ($tooLarge.Count -gt 0) {
        throw "$($tooLarge.Count) files are over 25 MiB; production unchanged."
    }

    Write-Host "=== Upload to Cloudflare Pages PRODUCTION/main ==="
    & npx.cmd wrangler pages deploy "$deploy" --project-name=$ProjectName --branch=main --commit-dirty=true
    if ($LASTEXITCODE -ne 0) { throw "Cloudflare upload failed." }

    foreach ($url in @("https://$ProjectName.pages.dev/", "https://$Domain/")) {
        $status = & curl.exe -L -sS -o NUL -w "%{http_code}" --max-time 20 $url
        Write-Host "$url -> HTTP $status"
    }
    Write-Host "Completed Pages upload. Verify gameplay and local save using your browser."
}
finally {
    Pop-Location
}
