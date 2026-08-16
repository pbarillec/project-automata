[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $PSCommandPath
$RepoRoot = Resolve-Path -LiteralPath (Join-Path $ScriptDir "..\..")

function Resolve-GodotExecutable {
    if ($env:GODOT_BIN) {
        if (Test-Path -LiteralPath $env:GODOT_BIN -PathType Leaf) {
            return (Resolve-Path -LiteralPath $env:GODOT_BIN).Path
        }

        Write-Error "GODOT_BIN is set but does not point to a file: $env:GODOT_BIN"
    }

    $repoRelativeFallback = Join-Path $RepoRoot "..\tools\godot-4.6.3\Godot_v4.6.3-stable_win64_console.exe"
    if (Test-Path -LiteralPath $repoRelativeFallback -PathType Leaf) {
        return (Resolve-Path -LiteralPath $repoRelativeFallback).Path
    }

    $pathCommand = Get-Command "Godot_v4.6.3-stable_win64_console.exe" -ErrorAction SilentlyContinue
    if ($pathCommand) {
        return $pathCommand.Source
    }

    Write-Error "Godot 4.6.3 console executable not found. Set GODOT_BIN to the Godot console executable path."
}

$Godot = Resolve-GodotExecutable
$GutRunner = "res://addons/gut/gut_cmdln.gd"

$ImportArgs = @(
    "--headless",
    "--path", $RepoRoot.Path,
    "--import"
)

$GodotArgs = @(
    "--headless",
    "--path", $RepoRoot.Path,
    "--script", $GutRunner,
    "-gdir=res://tests",
    "-ginclude_subdirs",
    "-gprefix=test_",
    "-gsuffix=.gd",
    "-glog=1",
    "-gexit"
)

Write-Host "Importing Godot project metadata with $Godot"
& $Godot @ImportArgs
$importExit = $LASTEXITCODE
if ($importExit -ne 0) {
    exit $importExit
}

Write-Host "Running GUT tests with $Godot"
$gutOutput = & $Godot @GodotArgs 2>&1
$gutExit = $LASTEXITCODE
$gutOutputLines = @($gutOutput | ForEach-Object { $_.ToString() })
$gutOutputLines | ForEach-Object { Write-Host $_ }

if ($gutExit -ne 0) {
    exit $gutExit
}

$gutOutputText = $gutOutputLines -join [Environment]::NewLine
$testDiscoveryFailurePatterns = @(
    "Parse Error",
    "Failed to load script",
    "could not be loaded",
    "Ignoring script .* because it does not extend GutTest"
)

foreach ($pattern in $testDiscoveryFailurePatterns) {
    if ($gutOutputText -match $pattern) {
        Write-Error "GUT reported a test discovery/load failure matching pattern '$pattern'."
        exit 1
    }
}

exit 0
