# AUT-075 — intentional-break drill. For each critical subsystem: apply a small mutation, run the gate,
# require a FAIL in the expected stage, then restore the file byte-for-byte. Slow (one gate run per case);
# manual/occasional, not part of `npm run check`. Aborts if the working tree is dirty.
$ErrorActionPreference = 'Stop'
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Push-Location $RepoRoot
try {
    if (git status --porcelain) { throw 'Working tree must be clean before the drill.' }

    $cases = @(
        @{ Name = 'config schema';   File = 'data\economy\producers.json'; Find = '"kind": "producers"'; Replace = '"kind": "producerz"'; Stage = 'config' },
        @{ Name = 'economy values';  File = 'data\economy\producers.json'; Find = '"baseCost": 10,'; Replace = '"baseCost": 100000,'; Stage = 'pacing' },
        @{ Name = 'economy formula'; File = 'assets\scripts\economy\ProducerCost.ts'; Find = 'Math.pow'; Replace = 'Math.sqrt'; Stage = 'tests' },
        @{ Name = 'persistence';     File = 'assets\scripts\persistence\PersistenceCoordinator.ts'; Find = 'saveVersion: CURRENT_SAVE_VERSION,'; Replace = 'saveVersion: 0,'; Stage = 'tests' },
        @{ Name = 'scene wiring';    File = 'assets\scenes\factory\FactoryWorld.scene'; Find = '"_name": "Zone_AutomatedCell"'; Replace = '"_name": "Zone_AutomatedCellX"'; Stage = 'tests' },
        @{ Name = 'android ads';     File = 'native\engine\android\app\AndroidManifest.xml'; Find = 'tools:node="remove"'; Replace = 'tools:node="merge"'; Stage = 'ads' },
        @{ Name = 'android billing'; File = 'native\engine\android\app\build.gradle'; Find = 'billing'; Replace = 'billinx'; Stage = 'billing' }
    )

    $failures = @()
    foreach ($c in $cases) {
        $path = Join-Path $RepoRoot $c.File
        $original = [System.IO.File]::ReadAllBytes($path)
        $text = [System.IO.File]::ReadAllText($path)
        if (-not $text.Contains($c.Find)) { $failures += "$($c.Name): mutation target '$($c.Find)' not found in $($c.File)"; continue }
        $idx = $text.IndexOf($c.Find)
        $mutated = $text.Substring(0, $idx) + $c.Replace + $text.Substring($idx + $c.Find.Length)
        try {
            [System.IO.File]::WriteAllText($path, $mutated, (New-Object System.Text.UTF8Encoding($false)))
            Write-Host "--- drill: $($c.Name) (expect FAIL in '$($c.Stage)')"
            $ErrorActionPreference = 'Continue'; & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $RepoRoot 'tools\ci\check.ps1') *> $null; $ErrorActionPreference = 'Stop'; 
            $code = $LASTEXITCODE
            $report = Get-Content -Raw (Join-Path $RepoRoot 'temp\ci\check_report.json') | ConvertFrom-Json
            $stage = $report.stages | Where-Object { $_.id -eq $c.Stage }
            if ($code -eq 0) { $failures += "$($c.Name): gate PASSED despite the break" }
            elseif ($stage.status -ne 'FAIL') { $failures += "$($c.Name): gate failed but not in expected stage '$($c.Stage)'" }
            else { Write-Host "    OK: gate exit $code, stage '$($c.Stage)' FAIL" }
        }
        finally {
            [System.IO.File]::WriteAllBytes($path, $original)
        }
    }
    if (git status --porcelain) { $failures += 'working tree dirty after drill (restore failed)' }
    if ($failures.Count -gt 0) { $failures | ForEach-Object { Write-Host "DRILL FAIL: $_" }; exit 1 }
    Write-Host 'DRILL PASS: every intentional break failed the gate in its expected stage.'
}
finally { Pop-Location }
