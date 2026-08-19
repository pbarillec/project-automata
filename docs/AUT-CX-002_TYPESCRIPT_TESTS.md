# AUT-CX-002 TypeScript Tests

## Runner Selection

- Selected runner: Node.js built-in `node:test`.
- Verified local runner version: Node.js 24.14.1.
- Runner license: MIT, inherited from Node.js.
- Third-party test dependencies: none.

Node's built-in test runner was selected because Node 24.14.1 can execute erasable TypeScript test files directly and headlessly. This keeps the AUT-CX-002 baseline independent of Cocos Creator, scenes, rendering, Android, native platform code, and external test framework packages.

## Execution Assumptions

- Cocos Creator remains locked to 3.8.8 through `package.json`.
- Node.js is pinned to 24.14.1 in `.nvmrc` and `.node-version`.
- `tools/ci/test.ps1` requires Node.js 24.x or newer and runs `node --test` directly.
- TypeScript tests must use erasable TypeScript syntax supported by Node's built-in type stripping.
- No `typescript` package or compiler step is required for the normal test runner.
- Pure TypeScript tests must not import `cc` or load Cocos runtime modules.

## Commands

Normal TypeScript test suite:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\ci\test.ps1
```

Current baseline project check:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\ci\check.ps1
```

`check.ps1` currently invokes only the mandatory implemented validation stage: the pure TypeScript test suite. It does not pretend that config validation, simulation regressions, Android builds, or Cocos scene automation exist yet.

## Intentional Failure Probe

AUT-CX-002 requires a controlled non-zero exit validation. The probe is performed by creating a temporary failing `.test.ts` file outside the normal passing suite, running `tools/ci/test.ps1`, recording the non-zero exit code, and then removing that temporary failing test before final validation.

## Cocos Automation Limitation

This task does not add Cocos scene runtime automation. The pure TypeScript suite is intentionally independent of Cocos Creator and does not prove that `assets/scenes/app/Main.scene` can be opened, previewed, or rendered. Manual Cocos validation from AUT-CX-001 remains required for scene behavior.
