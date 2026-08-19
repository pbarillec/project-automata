$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$TestsRoot = Join-Path $RepoRoot 'tests'

Push-Location $RepoRoot
try {
    $nodeVersion = (& node -p "process.versions.node") 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Node.js is required to run the TypeScript test suite. $nodeVersion"
        exit 127
    }

    $nodeMajor = [int](($nodeVersion.Trim() -split '\.')[0])
    if ($nodeMajor -lt 24) {
        Write-Error "Node.js 24.x is required for deterministic built-in TypeScript test execution. Found $nodeVersion."
        exit 1
    }

    $testFiles = @(Get-ChildItem -Path $TestsRoot -Recurse -Filter '*.test.ts' -File |
        Sort-Object FullName |
        ForEach-Object { $_.FullName })

    if (-not $testFiles -or $testFiles.Count -eq 0) {
        Write-Error 'No TypeScript test files found under tests/**/*.test.ts.'
        exit 1
    }

    $ccImportPattern = "from\s+['""]cc['""]|require\(\s*['""]cc['""]\s*\)"
    foreach ($testFile in $testFiles) {
        if (Select-String -Path $testFile -Pattern $ccImportPattern -Quiet) {
            Write-Error "Pure TypeScript tests must not import the Cocos runtime module: $testFile"
            exit 1
        }
    }

    $nodeArgs = @('--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', '--test') + $testFiles
    & node @nodeArgs
    exit $LASTEXITCODE
}
finally {
    Pop-Location
}
