# Build a GitHub release asset for MidiPult.
#
#   powershell -ExecutionPolicy Bypass -File deploy/build-release.ps1 -Version 0.4.45
#
# Produces in .release/:
#   midipult-<version>.tar.gz
#   midipult-<version>.tar.gz.sha256
param(
    [Parameter(Mandatory = $true)][string]$Version
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$out = Join-Path $root '.release'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$archive = Join-Path $out "midipult-$Version.tar.gz"
$shaFile = "$archive.sha256"

$items = @(
    'index.html', 'index.py', 'manifest.json', 'version.json',
    'favicon.ico', 'icon-192.png', 'icon-512.png', 'icon.png', 'icon-circle.png',
    'cgi-bin', 'service', 'init.d', 'lighttpd', 'deploy'
) | Where-Object { Test-Path (Join-Path $root $_) }

if ($items -notcontains 'version.json' -or $items -notcontains 'cgi-bin' -or
    $items -notcontains 'deploy' -or $items -notcontains 'init.d' -or
    $items -notcontains 'lighttpd') {
    throw 'Release archive is missing required files'
}
$actual = (Get-Content (Join-Path $root 'version.json') -Raw | ConvertFrom-Json).version
if ($actual -ne $Version) {
    throw "version.json is $actual, requested $Version"
}

Push-Location $root
try {
    if (Test-Path $archive) { Remove-Item -LiteralPath $archive -Force }
    $args = @('-czf', $archive) + $items
    & tar.exe @args
    if ($LASTEXITCODE -ne 0) { throw 'tar failed' }
} finally {
    Pop-Location
}

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $archive).Hash.ToLowerInvariant()
$name = [IO.Path]::GetFileName($archive)
Set-Content -LiteralPath $shaFile -Value "$hash  $name" -Encoding ASCII
Get-Item $archive, $shaFile | Select-Object FullName, Length
