# Patch 02 Phase 1: deploy ONLY the verified Next.js port to Cloudflare Pages.
# Included: V12.7 dungeon semantics/maps + V12.4 React activity dropdown.
# NOT included: upstream mp-online.js, original V22 CSS/layout, auto-mode pilot.
# Requires Cloudflare Wrangler authentication on this PC.
[CmdletBinding()]
param(
    [string]$RepoRoot = "C:\Users\amecopain\VLI\vo-lam-idle",
    [string]$ProjectName = "vli-thuan-2026",
    [string]$Domain = "thuanlam.qzz.io",
    [switch]$Deploy
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function CheckExit([string]$step) {
    if ($LASTEXITCODE -ne 0) {
        throw "$step failed (exit $LASTEXITCODE). Production unchanged."
    }
}

$root = (Resolve-Path -LiteralPath $RepoRoot).ProviderPath
$web = Join-Path $root 'web'
$testArtifact = Join-Path $root 'patch02-test-out'
if (-not (Test-Path -LiteralPath (Join-Path $web 'package.json') -PathType Leaf) -or
    -not (Test-Path -LiteralPath (Join-Path $web 'scripts\sync-android.mjs') -PathType Leaf)) {
    throw "Invalid repository root: $RepoRoot"
}
if (-not (Get-Command 'npm.cmd' -ErrorAction SilentlyContinue) -or
    -not (Get-Command 'npx.cmd' -ErrorAction SilentlyContinue)) {
    throw "npm and npx required."
}

Push-Location $root
try {
    $branch = (& git branch --show-current).Trim()
    CheckExit 'git branch'
    if ($branch -ne 'patch/volam-v12-7-port') {
        throw "Wrong branch '$branch'. Expected patch/volam-v12-7-port."
    }
    $sha = (& git rev-parse --short HEAD).Trim()
    CheckExit 'git rev-parse'
    Write-Host "Patch 02 Phase 1 source: $branch at $sha"

    Push-Location $web
    try {
        Write-Host '=== TypeScript ==='
        & npm.cmd run typecheck
        CheckExit 'TypeScript'

        Write-Host '=== Fresh isolated production build (never rewrites game/) ==='
        & npm.cmd run android:sync -- --out patch02-test-out
        CheckExit 'Next.js build'

        foreach ($rel in @('index.html', '_next', 'jdata\jx.json', 'img')) {
            if (-not (Test-Path -LiteralPath (Join-Path $testArtifact $rel))) {
                throw "Build output missing '$rel'. Production unchanged."
            }
        }

        $files = @(Get-ChildItem -LiteralPath $testArtifact -Recurse -File)
        if ($files.Count -eq 0 -or $files.Count -gt 20000) {
            throw "Invalid Cloudflare Pages file count $($files.Count). Production unchanged."
        }
        $large = @($files | Where-Object { $_.Length -gt 25MB })
        if ($large.Count) {
            throw "$($large.Count) files exceed 25MiB Cloudflare Pages per-file limit. Production unchanged."
        }

        Write-Host '=== Regression tests against exactly this output ==='
        $prior = [Environment]::GetEnvironmentVariable('VLI_PATCH02_TEST', 'Process')
        try {
            [Environment]::SetEnvironmentVariable('VLI_PATCH02_TEST', '1', 'Process')
            & npx.cmd playwright test --workers=8
            CheckExit '78-test regression suite'
        }
        finally {
            [Environment]::SetEnvironmentVariable('VLI_PATCH02_TEST', $prior, 'Process')
        }

        Write-Host "Validated $($files.Count) files from $testArtifact"
        if (-not $Deploy) {
            Write-Host 'DRY RUN completed. No Cloudflare upload. To publish, repeat with -Deploy.'
            return
        }

        Write-Host '=== Cloudflare Pages production deployment (main) ==='
        & npx.cmd wrangler pages deploy "$testArtifact" --project-name=$ProjectName --branch=main --commit-dirty=true
        CheckExit 'Cloudflare Pages upload'

        foreach ($url in @("https://$ProjectName.pages.dev/", "https://$Domain/")) {
            $status = & curl.exe -L -sS -o NUL -w "%{http_code}" --max-time 30 $url
            if ($LASTEXITCODE -ne 0 -or $status -ne '200') {
                Write-Warning "$url returned $status; inspect Pages deployment and browser before announcing success."
            } else {
                Write-Host "$url -> HTTP 200"
            }
        }
        Write-Host 'Phase 1 deployed. Manually verify character, dungeon, menu and .jxsave import/export.'
    }
    finally {
        Pop-Location
    }
}
finally {
    Pop-Location
}
