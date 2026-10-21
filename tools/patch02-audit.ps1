# Patch 02: read-only audit + isolated safe extraction for V11 -> V12.7.
# No code execution, Git changes, build, Cloudflare deployment, or save edits.
[CmdletBinding()]
param(
    [string]$ZipPath = "D:\thuan\VOLAM_V11_TO_V12_7_COMBINED_PATCH.zip",
    [string]$StagingDir = "D:\thuan\VLI-PATCH02-STAGING",
    [string]$RepoRoot = "C:\Users\amecopain\VLI\vo-lam-idle",
    [string]$ReportPath = "D:\thuan\patch02-audit.txt"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipPathResolved = (Resolve-Path -LiteralPath $ZipPath).ProviderPath
if (Test-Path -LiteralPath $StagingDir) {
    throw "Staging directory already exists. Inspect/remove manually before rerunning: $StagingDir"
}
[IO.Directory]::CreateDirectory($StagingDir) | Out-Null
$stageRoot = [IO.Path]::GetFullPath($StagingDir).TrimEnd([char]92, [char]47) + [IO.Path]::DirectorySeparatorChar
$archive = [IO.Compression.ZipFile]::OpenRead($zipPathResolved)
$files = New-Object 'System.Collections.Generic.List[object]'

try {
    foreach ($entry in $archive.Entries) {
        if (-not $entry.Name) { continue }
        $raw = $entry.FullName
        if ($raw -match '(^|/)__MACOSX/' -or
            $raw -match '(^|/)\._' -or
            $raw -match '(^|/)\.DS_Store$') { continue }

        $relative = $raw.Replace('/', [IO.Path]::DirectorySeparatorChar)
        $destination = [IO.Path]::GetFullPath((Join-Path $StagingDir $relative))
        if (-not $destination.StartsWith($stageRoot, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Unsafe ZIP path: $raw"
        }
        if ($entry.Length -gt 100MB) { throw "Unexpected large ZIP member: $raw" }
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
        [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $false)

        $relativeUnix = $raw.Replace('\', '/')
        $possible = Join-Path $RepoRoot ($relativeUnix.Replace('/', [IO.Path]::DirectorySeparatorChar))
        $status = "NO_DIRECT_MATCH"
        if (Test-Path -LiteralPath $possible -PathType Leaf) {
            $current = Get-Item -LiteralPath $possible
            if ($current.Length -ne $entry.Length) {
                $status = "DIRECT_PATH_DIFF_SIZE"
            } else {
                $a = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
                $b = (Get-FileHash -LiteralPath $possible -Algorithm SHA256).Hash
                $status = if ($a -eq $b) { "DIRECT_PATH_IDENTICAL" } else { "DIRECT_PATH_DIFF_HASH" }
            }
        }
        $files.Add([PSCustomObject]@{
            File = $relativeUnix
            Bytes = $entry.Length
            Ext = [IO.Path]::GetExtension($entry.Name).ToLowerInvariant()
            Target = $status
        })
    }
}
finally {
    $archive.Dispose()
}

$report = New-Object 'System.Collections.Generic.List[string]'
$report.Add("=== PATCH 02: V11 -> V12.7 ZIP AUDIT ===")
$report.Add("Zip: $zipPathResolved")
$report.Add("Staging: $StagingDir")
$report.Add("Source: $RepoRoot")
$report.Add("Files: $($files.Count)")
$report.Add("Uncompressed bytes: $(($files | Measure-Object Bytes -Sum).Sum)")
$report.Add("")
$report.Add("=== FILE TYPES ===")
$report.Add(($files | Group-Object Ext | Sort-Object Count -Descending |
    Select-Object Count, Name | Format-Table -AutoSize | Out-String))
$report.Add("=== DIRECT PATH COMPARISON ===")
$report.Add(($files | Group-Object Target | Sort-Object Name |
    Select-Object Count, Name | Format-Table -AutoSize | Out-String))
$report.Add("=== FILE INVENTORY (every file) ===")
$report.Add(($files | Sort-Object File | Select-Object File, Bytes, Target |
    Format-Table -AutoSize -Wrap | Out-String -Width 250))
$report.Add("=== README / INSTALL / CHANGELOG / MANIFEST / PATCH NOTES ===")
$textCandidates = @($files | Where-Object {
    $_.File -match '(?i)(readme|install|how.to|huong.dan|change.log|patch.note|manifest|version|release)' -and
    $_.Ext -in @(".md", ".txt", ".json", ".yml", ".yaml", ".sh", ".ps1", ".py")
} | Select-Object -First 12)
foreach ($f in $textCandidates) {
    $filePath = Join-Path $StagingDir ($f.File.Replace('/', [IO.Path]::DirectorySeparatorChar))
    $report.Add("--- $($f.File) ---")
    $report.Add((Get-Content -LiteralPath $filePath -TotalCount 140 -ErrorAction SilentlyContinue | Out-String))
}
$report.Add("=== FIRST LINES OF .PATCH / .DIFF ===")
foreach ($f in @($files | Where-Object { $_.Ext -in @(".patch",".diff") } | Select-Object -First 12)) {
    $filePath = Join-Path $StagingDir ($f.File.Replace('/', [IO.Path]::DirectorySeparatorChar))
    $report.Add("--- $($f.File) ---")
    $report.Add((Get-Content -LiteralPath $filePath -TotalCount 60 -ErrorAction SilentlyContinue | Out-String))
}
$report | Set-Content -LiteralPath $ReportPath -Encoding UTF8
Write-Host "Patch02 files: $($files.Count)"
Write-Host "Report: $ReportPath"
Write-Host "Staging: $StagingDir"
Write-Host ""
Write-Host "Top-level members:"
$files | Group-Object { ($_.File -split '/')[0] } |
    Sort-Object Count -Descending | Select-Object -First 20 Count, Name | Format-Table
Write-Host ""
Write-Host "README / patch notes:"
$textCandidates | Select-Object File, Bytes | Format-Table -AutoSize
Write-Host "No source, Git branch, Cloudflare deployment, or localStorage save changed."
