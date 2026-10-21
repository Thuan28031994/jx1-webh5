# Patch 01 - safe media-only import from VOLAM-IDLE-OFFLINE.
# This does not apply vanilla JavaScript to the Next.js/TypeScript game.
# Dry run by default. Use -Apply only after inspecting the report.
[CmdletBinding()]
param(
    [string]$StagingDir = "D:\thuan\VLI-PATCH01-STAGING",
    [string]$RepoRoot = "C:\Users\amecopain\VLI\vo-lam-idle",
    [string]$ReportPath = "",
    [switch]$Apply
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$staging = (Resolve-Path -LiteralPath $StagingDir).ProviderPath.TrimEnd([char]92, [char]47)
$repo = (Resolve-Path -LiteralPath $RepoRoot).ProviderPath.TrimEnd([char]92, [char]47)
$game = Join-Path $repo "game"
if (-not (Test-Path -LiteralPath (Join-Path $staging "index.html") -PathType Leaf)) {
    throw "Invalid staging: index.html missing."
}
if (-not (Test-Path -LiteralPath (Join-Path $repo "web\package.json") -PathType Leaf) -or
    -not (Test-Path -LiteralPath $game -PathType Container)) {
    throw "Invalid Next.js repository root: expected web/package.json and game/."
}
if ($staging.StartsWith($repo + [IO.Path]::DirectorySeparatorChar,
        [StringComparison]::OrdinalIgnoreCase)) {
    throw "Staging must not be inside repository root."
}
if (-not $ReportPath) {
    $ReportPath = Join-Path $staging "patch01-media-report.csv"
}

$mediaDirs = @("img", "fx", "snd", "music", "ui", "fonts")
$mediaExts = @(".webp", ".png", ".jpg", ".jpeg", ".gif", ".avif",
               ".mp3", ".ogg", ".wav", ".m4a", ".mp4", ".webm",
               ".woff", ".woff2", ".ttf", ".otf", ".ico")
$sourcePrefix = $staging + [IO.Path]::DirectorySeparatorChar
$destPrefix = ([IO.Path]::GetFullPath($game)).TrimEnd([char]92, [char]47) +
              [IO.Path]::DirectorySeparatorChar

$results = New-Object 'System.Collections.Generic.List[object]'
$added = 0

$files = Get-ChildItem -LiteralPath $staging -File -Recurse -Force
foreach ($file in $files) {
    if (-not $file.FullName.StartsWith($sourcePrefix,
            [StringComparison]::OrdinalIgnoreCase)) { continue }

    $relative = $file.FullName.Substring($sourcePrefix.Length)
    $parts = $relative -split '[\\/]'
    if ($parts.Count -lt 2 -or $parts[0] -notin $mediaDirs) { continue }
    if ($file.Name.StartsWith("._") -or
        $file.Extension.ToLowerInvariant() -notin $mediaExts) { continue }

    $destination = [IO.Path]::GetFullPath((Join-Path $game $relative))
    if (-not $destination.StartsWith($destPrefix,
            [StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe path in staging: $relative"
    }

    $existingBytes = $null
    if (Test-Path -LiteralPath $destination -PathType Leaf) {
        $existingBytes = (Get-Item -LiteralPath $destination).Length
        if ($existingBytes -ne $file.Length) {
            $status = "DIFFERENT_SIZE_KEPT"
        } else {
            $sourceHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
            $destHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
            $status = if ($sourceHash -eq $destHash) { "IDENTICAL" }
                      else { "DIFFERENT_HASH_KEPT" }
        }
    } else {
        $status = "MISSING"
        if ($Apply) {
            $parent = Split-Path -Parent $destination
            if (-not (Test-Path -LiteralPath $parent)) {
                New-Item -ItemType Directory -Path $parent -Force | Out-Null
            }
            # Never overwrite an existing file.
            Copy-Item -LiteralPath $file.FullName -Destination $destination -ErrorAction Stop
            $status = "ADDED"
            $added++
        }
    }

    $results.Add([PSCustomObject]@{
        Status = $status
        File = $relative
        PatchBytes = $file.Length
        CurrentBytes = $existingBytes
    })
}

$results | Export-Csv -LiteralPath $ReportPath -NoTypeInformation -Encoding UTF8
Write-Host ("Mode: " + $(if ($Apply) { "APPLY MISSING MEDIA" } else { "AUDIT ONLY" }))
Write-Host ("Scanned supported media: " + $results.Count)
$results | Group-Object Status | Sort-Object Name | Select-Object Count, Name | Format-Table
Write-Host ("New media copied: " + $added)
Write-Host ("Report: " + $ReportPath)
Write-Host "No .ts, .js, .json, .html, .css, save data, or existing media were overwritten."
if ($Apply) {
    Write-Host "Next: run web typecheck, build deploy, and regression tests before publishing."
}
