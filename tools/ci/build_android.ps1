[CmdletBinding()]
param(
    [ValidateSet("Apk", "Aab")]
    [string] $Format = "Apk",

    [switch] $SkipPageSizeCheck,

    [switch] $RequirePageSizeCheck,

    [ValidateRange(60, 7200)]
    [int] $ExportTimeoutSeconds = 300,

    [ValidateRange(1, 60)]
    [int] $ArtifactStabilitySeconds = 5
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $PSCommandPath
$RepoRoot = Resolve-Path -LiteralPath (Join-Path $ScriptDir "..\..")
$TargetApi = 36
$ArtifactRoot = Join-Path $RepoRoot.Path "build\android"
$AndroidBuildDir = Join-Path $RepoRoot.Path "android\build"
$DebugKeystorePath = Join-Path $ArtifactRoot "debug.keystore"
$DebugKeystoreAlias = "androiddebugkey"
$DebugKeystorePassword = "android"

function Resolve-GodotExecutable {
    if ($env:GODOT_BIN) {
        if (Test-Path -LiteralPath $env:GODOT_BIN -PathType Leaf) {
            return (Resolve-Path -LiteralPath $env:GODOT_BIN).Path
        }

        Write-Error "GODOT_BIN is set but does not point to a file: $env:GODOT_BIN"
    }

    $repoRelativeFallback = Join-Path $RepoRoot.Path "..\tools\godot-4.6.3\Godot_v4.6.3-stable_win64_console.exe"
    if (Test-Path -LiteralPath $repoRelativeFallback -PathType Leaf) {
        return (Resolve-Path -LiteralPath $repoRelativeFallback).Path
    }

    $pathCommand = Get-Command "Godot_v4.6.3-stable_win64_console.exe" -ErrorAction SilentlyContinue
    if ($pathCommand) {
        return $pathCommand.Source
    }

    Write-Error "Godot 4.6.3 console executable not found. Set GODOT_BIN to the Godot console executable path."
}

function Resolve-AndroidSdk {
    $candidates = @()
    if ($env:ANDROID_SDK_ROOT) {
        $candidates += $env:ANDROID_SDK_ROOT
    }
    if ($env:ANDROID_HOME) {
        $candidates += $env:ANDROID_HOME
    }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        if ([string]::IsNullOrWhiteSpace($candidate)) {
            continue
        }

        if (Test-Path -LiteralPath (Join-Path $candidate "platform-tools\adb.exe") -PathType Leaf) {
            $resolved = (Resolve-Path -LiteralPath $candidate).Path
            $targetPlatform = Join-Path $resolved "platforms\android-$TargetApi"
            if (-not (Test-Path -LiteralPath $targetPlatform -PathType Container)) {
                Write-Error "Android SDK found at '$resolved', but platform android-$TargetApi is missing."
            }

            return $resolved
        }
    }

    Write-Error "Android SDK not found. Set ANDROID_SDK_ROOT or ANDROID_HOME to an SDK containing platform-tools and platforms\android-$TargetApi."
}

function Resolve-JavaHome {
    if ($env:JAVA_HOME) {
        $javaExe = Join-Path $env:JAVA_HOME "bin\java.exe"
        if (Test-Path -LiteralPath $javaExe -PathType Leaf) {
            return (Resolve-Path -LiteralPath $env:JAVA_HOME).Path
        }

        Write-Error "JAVA_HOME is set but does not contain bin\java.exe: $env:JAVA_HOME"
    }

    $keytool = Get-Command "keytool.exe" -ErrorAction SilentlyContinue
    if ($keytool) {
        $binDir = Split-Path -Parent $keytool.Source
        $javaHome = Split-Path -Parent $binDir
        if (Test-Path -LiteralPath (Join-Path $javaHome "bin\java.exe") -PathType Leaf) {
            return (Resolve-Path -LiteralPath $javaHome).Path
        }
    }

    Write-Error "JDK not found. Set JAVA_HOME to a JDK installation; Godot 4.6 Android export is expected to use OpenJDK 17 or compatible."
}

function ConvertTo-GodotSettingString {
    param([Parameter(Mandatory = $true)][string] $Value)

    $escaped = ($Value -replace '\\', '\\') -replace '"', '\"'
    return '"' + $escaped + '"'
}

function Set-GodotEditorSetting {
    param(
        [AllowEmptyCollection()][AllowEmptyString()][string[]] $Lines = @(),
        [Parameter(Mandatory = $true)][string] $Key,
        [Parameter(Mandatory = $true)][string] $Value
    )

    $line = "$Key = $(ConvertTo-GodotSettingString $Value)"
    $pattern = "^\s*$([regex]::Escape($Key))\s*="

    for ($i = 0; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i] -match $pattern) {
            $Lines[$i] = $line
            return $Lines
        }
    }

    return @($Lines + $line)
}

function Initialize-GodotAndroidEditorSettings {
    param(
        [Parameter(Mandatory = $true)][string] $AndroidSdk,
        [Parameter(Mandatory = $true)][string] $JavaHome,
        [Parameter(Mandatory = $true)][string] $DebugKeystore
    )

    if (-not $env:APPDATA) {
        Write-Warning "APPDATA is not set; skipping Godot editor Android path bootstrap."
        return
    }

    $settingsDir = Join-Path $env:APPDATA "Godot"
    $settingsPath = Join-Path $settingsDir "editor_settings-4.6.tres"

    New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null

    if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
        $lines = @(Get-Content -LiteralPath $settingsPath)
    } else {
        $lines = @(
            '[gd_resource type="EditorSettings" format=3]',
            '',
            '[resource]'
        )
    }

    $lines = Set-GodotEditorSetting -Lines $lines -Key "export/android/android_sdk_path" -Value $AndroidSdk
    $lines = Set-GodotEditorSetting -Lines $lines -Key "export/android/java_sdk_path" -Value $JavaHome
    $lines = Set-GodotEditorSetting -Lines $lines -Key "export/android/debug_keystore" -Value $DebugKeystore
    $lines = Set-GodotEditorSetting -Lines $lines -Key "export/android/debug_keystore_user" -Value $DebugKeystoreAlias
    $lines = Set-GodotEditorSetting -Lines $lines -Key "export/android/debug_keystore_pass" -Value $DebugKeystorePassword

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllLines($settingsPath, $lines, $utf8NoBom)
    Write-Host "Godot Android editor settings prepared at $settingsPath"
}

function Initialize-DebugKeystore {
    param(
        [Parameter(Mandatory = $true)][string] $JavaHome,
        [Parameter(Mandatory = $true)][string] $KeystorePath
    )

    if (Test-Path -LiteralPath $KeystorePath -PathType Leaf) {
        return
    }

    $keytool = Join-Path $JavaHome "bin\keytool.exe"
    if (-not (Test-Path -LiteralPath $keytool -PathType Leaf)) {
        Write-Error "keytool.exe not found under JAVA_HOME: $JavaHome"
    }

    Write-Host "Generating local debug keystore at $KeystorePath"
    & $keytool `
        -keyalg RSA `
        -genkeypair `
        -alias $DebugKeystoreAlias `
        -keypass $DebugKeystorePassword `
        -keystore $KeystorePath `
        -storepass $DebugKeystorePassword `
        -dname "CN=Android Debug,O=Android,C=US" `
        -validity 10000 `
        -deststoretype pkcs12 | Out-Host

    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
}

function Find-ReadElf {
    param([Parameter(Mandatory = $true)][string] $AndroidSdk)

    $ndkRoot = Join-Path $AndroidSdk "ndk"
    if (Test-Path -LiteralPath $ndkRoot -PathType Container) {
        $ndkReadElf = Get-ChildItem -LiteralPath $ndkRoot -Recurse -Filter "llvm-readelf.exe" -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -like "*\toolchains\llvm\prebuilt\*\bin\llvm-readelf.exe" } |
            Sort-Object FullName -Descending |
            Select-Object -First 1

        if ($ndkReadElf) {
            return $ndkReadElf.FullName
        }
    }

    $pathReadElf = Get-Command "llvm-readelf.exe" -ErrorAction SilentlyContinue
    if ($pathReadElf) {
        return $pathReadElf.Source
    }

    $pathReadElf = Get-Command "readelf.exe" -ErrorAction SilentlyContinue
    if ($pathReadElf) {
        return $pathReadElf.Source
    }

    return $null
}

function Test-NativeLibraryPageSizeCompatibility {
    param(
        [Parameter(Mandatory = $true)][string] $ArtifactPath,
        [Parameter(Mandatory = $true)][string] $AndroidSdk
    )

    $readElf = Find-ReadElf $AndroidSdk
    if (-not $readElf) {
        return @{
            Status = "NotVerified"
            Message = "llvm-readelf/readelf was not found. Install Android NDK and rerun with -RequirePageSizeCheck to enforce 16 KB ELF alignment verification."
        }
    }

    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $checkRoot = Join-Path (Split-Path -Parent $ArtifactPath) ("page-size-check-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $checkRoot | Out-Null

    try {
        $zip = [System.IO.Compression.ZipFile]::OpenRead($ArtifactPath)
        try {
            $nativeEntries = @($zip.Entries | Where-Object {
                $_.FullName -match '(^|/)lib/[^/]+/[^/]+\.so$'
            })

            if ($nativeEntries.Count -eq 0) {
                return @{
                    Status = "NotVerified"
                    Message = "No native libraries were found in the Android artifact."
                }
            }

            $badLibraries = @()
            $uncheckedLibraries = @()

            foreach ($entry in $nativeEntries) {
                $safeName = ($entry.FullName -replace '[^A-Za-z0-9_.-]', '_')
                $extractPath = Join-Path $checkRoot $safeName
                [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $extractPath)

                $readElfOutput = & $readElf --program-headers --wide $extractPath 2>&1
                if ($LASTEXITCODE -ne 0) {
                    $uncheckedLibraries += $entry.FullName
                    continue
                }

                $alignments = @()
                foreach ($line in $readElfOutput) {
                    $text = $line.ToString()
                    if ($text -match '^\s*LOAD\s+.*\s(0x[0-9a-fA-F]+|\d+)\s*$') {
                        $alignText = $Matches[1]
                        if ($alignText.StartsWith("0x")) {
                            $alignments += [Convert]::ToInt64($alignText.Substring(2), 16)
                        } else {
                            $alignments += [int64]$alignText
                        }
                    }
                }

                if ($alignments.Count -eq 0) {
                    $uncheckedLibraries += $entry.FullName
                    continue
                }

                foreach ($alignment in $alignments) {
                    if ($alignment -lt 16384) {
                        $badLibraries += "$($entry.FullName) align=$alignment"
                        break
                    }
                }
            }

            if ($badLibraries.Count -gt 0) {
                return @{
                    Status = "Failed"
                    Message = "Native library LOAD segment alignment is below 16 KB: $($badLibraries -join '; ')"
                }
            }

            if ($uncheckedLibraries.Count -gt 0) {
                return @{
                    Status = "NotVerified"
                    Message = "Could not parse 16 KB alignment for: $($uncheckedLibraries -join ', ')"
                }
            }

            return @{
                Status = "Passed"
                Message = "All native library LOAD segment alignments are at least 16 KB."
            }
        } finally {
            $zip.Dispose()
        }
    } finally {
        if (Test-Path -LiteralPath $checkRoot -PathType Container) {
            Remove-Item -LiteralPath $checkRoot -Recurse -Force
        }
    }
}

function ConvertTo-ProcessArgument {
    param([Parameter(Mandatory = $true)][string] $Argument)

    if ($Argument -notmatch '[\s"]') {
        return $Argument
    }

    return '"' + $Argument.Replace('"', '\"') + '"'
}

function Read-AppendedLogText {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [Parameter(Mandatory = $true)][ref] $Position
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return ""
    }

    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        if ($stream.Length -lt $Position.Value) {
            $Position.Value = 0
        }

        $remaining = $stream.Length - $Position.Value
        if ($remaining -le 0) {
            return ""
        }

        $stream.Seek($Position.Value, [System.IO.SeekOrigin]::Begin) | Out-Null
        $buffer = New-Object byte[] ([int]$remaining)
        $read = $stream.Read($buffer, 0, $buffer.Length)
        $Position.Value += $read

        return [System.Text.Encoding]::UTF8.GetString($buffer, 0, $read)
    } finally {
        $stream.Dispose()
    }
}

function Write-GodotExportLogs {
    param(
        [Parameter(Mandatory = $true)][string] $StdoutPath,
        [Parameter(Mandatory = $true)][string] $StderrPath,
        [Parameter(Mandatory = $true)][ref] $StdoutPosition,
        [Parameter(Mandatory = $true)][ref] $StderrPosition,
        [Parameter(Mandatory = $true)][System.Text.StringBuilder] $Stdout,
        [Parameter(Mandatory = $true)][System.Text.StringBuilder] $Stderr
    )

    $stdoutText = Read-AppendedLogText $StdoutPath $StdoutPosition
    if ($stdoutText.Length -gt 0) {
        $Stdout.Append($stdoutText) | Out-Null
        Write-Host -NoNewline $stdoutText
    }

    $stderrText = Read-AppendedLogText $StderrPath $StderrPosition
    if ($stderrText.Length -gt 0) {
        $Stderr.Append($stderrText) | Out-Null
        [Console]::Error.Write($stderrText)
    }
}

function Remove-AnsiEscapeSequences {
    param([AllowNull()][string] $Text)

    if ($null -eq $Text) {
        return ""
    }

    $escape = [regex]::Escape([string][char]27)
    return [regex]::Replace($Text, "$escape\[[0-?]*[ -/]*[@-~]", "")
}

function Test-GodotExportCompleted {
    param([Parameter(Mandatory = $true)][string] $OutputText)

    $normalizedOutput = Remove-AnsiEscapeSequences $OutputText
    return $normalizedOutput -match '(?m)^\s*\[\s*DONE\s*\]\s+export\s*$'
}

function Test-GodotExportReportedError {
    param([Parameter(Mandatory = $true)][string] $OutputText)

    $normalizedOutput = Remove-AnsiEscapeSequences $OutputText
    return $normalizedOutput -match '(?im)^\s*(ERROR|SCRIPT ERROR):|failed to export|export failed|error exporting'
}

function Test-ArtifactCreatedForCurrentExport {
    param(
        [Parameter(Mandatory = $true)][string] $ArtifactPath,
        [Parameter(Mandatory = $true)][datetime] $ExportStartUtc
    )

    if (-not (Test-Path -LiteralPath $ArtifactPath -PathType Leaf)) {
        return $false
    }

    $artifact = Get-Item -LiteralPath $ArtifactPath
    return ($artifact.Length -gt 0 -and $artifact.LastWriteTimeUtc -ge $ExportStartUtc)
}

function Wait-ArtifactStable {
    param(
        [Parameter(Mandatory = $true)][string] $ArtifactPath,
        [Parameter(Mandatory = $true)][datetime] $ExportStartUtc,
        [Parameter(Mandatory = $true)][int] $StabilitySeconds
    )

    $lastLength = -1
    $stableSince = $null
    $deadline = [DateTime]::UtcNow.AddSeconds($StabilitySeconds + 30)

    while ([DateTime]::UtcNow -lt $deadline) {
        if (-not (Test-ArtifactCreatedForCurrentExport $ArtifactPath $ExportStartUtc)) {
            $lastLength = -1
            $stableSince = $null
            Start-Sleep -Milliseconds 500
            continue
        }

        $artifact = Get-Item -LiteralPath $ArtifactPath
        if ($artifact.Length -ne $lastLength) {
            $lastLength = $artifact.Length
            $stableSince = [DateTime]::UtcNow
        } elseif ((([DateTime]::UtcNow) - $stableSince).TotalSeconds -ge $StabilitySeconds) {
            return $true
        }

        Start-Sleep -Milliseconds 500
    }

    return $false
}

function Stop-SpawnedGodotProcess {
    param([Parameter(Mandatory = $true)][System.Diagnostics.Process] $Process)

    if ($Process.HasExited) {
        return
    }

    Stop-Process -Id $Process.Id -Force
    $Process.WaitForExit(10000) | Out-Null
}

function Invoke-GodotExport {
    param(
        [Parameter(Mandatory = $true)][string] $Godot,
        [Parameter(Mandatory = $true)][string[]] $GodotArgs,
        [Parameter(Mandatory = $true)][string] $WorkingDirectory,
        [Parameter(Mandatory = $true)][string] $ArtifactPath,
        [Parameter(Mandatory = $true)][datetime] $ExportStartUtc,
        [Parameter(Mandatory = $true)][int] $TimeoutSeconds,
        [Parameter(Mandatory = $true)][int] $StabilitySeconds,
        [Parameter(Mandatory = $true)][string] $LogRoot,
        [Parameter(Mandatory = $true)][string] $Format
    )

    $stdoutLog = Join-Path $LogRoot "godot-export-$($Format.ToLowerInvariant()).stdout.log"
    $stderrLog = Join-Path $LogRoot "godot-export-$($Format.ToLowerInvariant()).stderr.log"

    foreach ($logPath in @($stdoutLog, $stderrLog)) {
        if (Test-Path -LiteralPath $logPath -PathType Leaf) {
            Remove-Item -LiteralPath $logPath -Force
        }
    }

    $argumentText = ($GodotArgs | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join " "
    $process = Start-Process `
        -FilePath $Godot `
        -ArgumentList $argumentText `
        -WorkingDirectory $WorkingDirectory `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog `
        -WindowStyle Hidden `
        -PassThru

    $stdoutPosition = 0L
    $stderrPosition = 0L
    $stdout = New-Object System.Text.StringBuilder
    $stderr = New-Object System.Text.StringBuilder
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)

    while ($true) {
        Start-Sleep -Milliseconds 500
        Write-GodotExportLogs $stdoutLog $stderrLog ([ref]$stdoutPosition) ([ref]$stderrPosition) $stdout $stderr

        if ($process.HasExited) {
            $process.WaitForExit()
            Write-GodotExportLogs $stdoutLog $stderrLog ([ref]$stdoutPosition) ([ref]$stderrPosition) $stdout $stderr
            return @{
                ExitCode = $process.ExitCode
                HungAfterExport = $false
            }
        }

        $combinedOutput = $stdout.ToString() + [Environment]::NewLine + $stderr.ToString()
        if (
            (Test-GodotExportCompleted $combinedOutput) -and
            (-not (Test-GodotExportReportedError $combinedOutput)) -and
            (Test-ArtifactCreatedForCurrentExport $ArtifactPath $ExportStartUtc) -and
            (Wait-ArtifactStable $ArtifactPath $ExportStartUtc $StabilitySeconds)
        ) {
            Write-GodotExportLogs $stdoutLog $stderrLog ([ref]$stdoutPosition) ([ref]$stderrPosition) $stdout $stderr

            if ($process.HasExited) {
                $process.WaitForExit()
                Write-GodotExportLogs $stdoutLog $stderrLog ([ref]$stdoutPosition) ([ref]$stderrPosition) $stdout $stderr
                return @{
                    ExitCode = $process.ExitCode
                    HungAfterExport = $false
                }
            }

            Write-Warning "Godot 4.6.3 reported export completion and produced a fresh stable artifact, but the export process did not exit. Terminating only spawned Godot process ID $($process.Id) due to the known post-export hang."
            Stop-SpawnedGodotProcess $process
            Write-GodotExportLogs $stdoutLog $stderrLog ([ref]$stdoutPosition) ([ref]$stderrPosition) $stdout $stderr
            return @{
                ExitCode = 0
                HungAfterExport = $true
            }
        }

        if ([DateTime]::UtcNow -ge $deadline) {
            Write-GodotExportLogs $stdoutLog $stderrLog ([ref]$stdoutPosition) ([ref]$stderrPosition) $stdout $stderr
            Stop-SpawnedGodotProcess $process
            Write-Error "Godot export did not complete within $TimeoutSeconds seconds. The spawned process was terminated."
        }
    }
}

$Godot = Resolve-GodotExecutable
$AndroidSdk = Resolve-AndroidSdk
$JavaHome = Resolve-JavaHome

New-Item -ItemType Directory -Force -Path $ArtifactRoot | Out-Null
Initialize-DebugKeystore $JavaHome $DebugKeystorePath
Initialize-GodotAndroidEditorSettings $AndroidSdk $JavaHome $DebugKeystorePath

$env:ANDROID_HOME = $AndroidSdk
$env:ANDROID_SDK_ROOT = $AndroidSdk
$env:JAVA_HOME = $JavaHome
$env:GODOT_ANDROID_KEYSTORE_DEBUG_PATH = $DebugKeystorePath
$env:GODOT_ANDROID_KEYSTORE_DEBUG_USER = $DebugKeystoreAlias
$env:GODOT_ANDROID_KEYSTORE_DEBUG_PASSWORD = $DebugKeystorePassword

$extension = if ($Format -eq "Aab") { "aab" } else { "apk" }
$presetName = if ($Format -eq "Aab") { "Android Debug AAB" } else { "Android Debug APK" }
$artifactPath = Join-Path $ArtifactRoot "project-automata-debug-api$TargetApi.$extension"

if (Test-Path -LiteralPath $artifactPath -PathType Leaf) {
    Write-Host "Removing existing Android artifact before export: $artifactPath"
    Remove-Item -LiteralPath $artifactPath -Force
}

$exportStartUtc = [DateTime]::UtcNow

$godotArgs = @(
    "--headless",
    "--path", $RepoRoot.Path
)

if (-not (Test-Path -LiteralPath (Join-Path $AndroidBuildDir "config.gradle") -PathType Leaf)) {
    $godotArgs += "--install-android-build-template"
}

$godotArgs += @(
    "--export-debug", $presetName, $artifactPath
)

Write-Host "Exporting $presetName with $Godot"
Write-Host "Artifact path: $artifactPath"
$exportResult = Invoke-GodotExport `
    -Godot $Godot `
    -GodotArgs $godotArgs `
    -WorkingDirectory $RepoRoot.Path `
    -ArtifactPath $artifactPath `
    -ExportStartUtc $exportStartUtc `
    -TimeoutSeconds $ExportTimeoutSeconds `
    -StabilitySeconds $ArtifactStabilitySeconds `
    -LogRoot $ArtifactRoot `
    -Format $Format

$exportExit = $exportResult.ExitCode
if ($exportExit -ne 0) {
    exit $exportExit
}

if (-not (Test-Path -LiteralPath $artifactPath -PathType Leaf)) {
    Write-Error "Godot export completed but artifact was not found: $artifactPath"
}

$artifact = Get-Item -LiteralPath $artifactPath
if ($artifact.Length -le 0) {
    Write-Error "Godot export completed but artifact is empty: $artifactPath"
}

if ($artifact.LastWriteTimeUtc -lt $exportStartUtc) {
    Write-Error "Godot export completed but artifact is older than the current export start: $artifactPath"
}

if (-not $SkipPageSizeCheck) {
    $pageSizeResult = Test-NativeLibraryPageSizeCompatibility $artifactPath $AndroidSdk
    if ($pageSizeResult.Status -eq "Failed") {
        Write-Error $pageSizeResult.Message
    }

    if ($pageSizeResult.Status -eq "Passed") {
        Write-Host "16 KB page-size check: $($pageSizeResult.Message)"
    } elseif ($RequirePageSizeCheck) {
        Write-Error "16 KB page-size check was required but not completed: $($pageSizeResult.Message)"
    } else {
        Write-Warning "16 KB page-size check not completed: $($pageSizeResult.Message)"
    }
}

Write-Host "Android $Format debug export complete: $artifactPath"
exit 0
