# Windows Symlink Tests in CI

**Status:** Approved on 2026-09-29

**Date:** 2026-09-29

**Goal:** Run the symlink and reparse-point tests on a Windows GitHub-hosted runner so a bridge that accepts a symlink fails CI. Developer machines that cannot create symlinks still skip those tests.

**Approach:** Remove the blanket Windows skips. Keep a runtime skip when fixture creation fails. Add GitHub Actions for Ubuntu and Windows, and make the Windows job fail if those tests were skipped.

---

## 1. Context

The repository has no `.github/workflows` directory. Five tests never run on Windows because they are declared with `skip: process.platform === 'win32'`:

- `export refuses a symlinked internal storage root` in `test/security.test.mjs`
- `export rejects selected context reached through a symlink` in `test/security.test.mjs`
- `import quarantines a returned file whose staging path crosses a repository symlink` in `test/security.test.mjs`
- `a symlinked project config is rejected` in `test/project-config.test.mjs`
- `assertOutsideRepository rejects a symbolic-link staging parent` in `test/staging.test.mjs`

Other symlink tests already try to create the fixture and call `t.skip` only when creation throws. That is the behavior the five blanket skips should use.

GitHub-hosted `windows-latest` runs with the right to create symlinks. A typical desktop Windows session often does not. CI is the place those five tests execute.

## 2. Chosen approach

Add `.github/workflows/test.yml` with one `test` job. Its matrix is `ubuntu-latest` and `windows-latest`. Both runners use Node.js 22, set `ATB_REQUIRE_SYMLINK_TESTS=1`, and run `npm test` then `npm run smoke`.

Rejected alternatives:

- A self-hosted Windows machine. It matches one desktop and becomes another system to maintain.
- Leaving the blanket skips. The release notes already name this as unfinished coverage.

## 3. Test changes

Delete `{ skip: process.platform === 'win32' }` from the five tests listed above. Do not change their assertions.

Wrap fixture creation in the existing try/catch pattern:

- On success, run the current assertions.
- On a creation failure (`EPERM`, privilege, or reparse-point errors), call `t.skip` with the platform message, unless `ATB_REQUIRE_SYMLINK_TESTS` is `1`.
- When `ATB_REQUIRE_SYMLINK_TESTS` is `1` and creation fails, fail the test with that error. Do not skip.

`npm test` is `node --test`. A skipped test does not fail that command. The variable fails the suite only because `skipOrFailSymlink` fails the test when creation fails.

Apply `skipOrFailSymlink` to these existing dynamic creation skips:

- `test/importer.test.mjs`: `importResult persists observed active-tree invariance when reconstruction fails`
- `test/staging.test.mjs`: `fingerprintActiveTree records Git-visible symlink metadata without reading its target`
- `test/staging.test.mjs`: `copySelectedWorkingPaths rejects selected symbolic links and reparse points`
- `test/staging.test.mjs`: `copySelectedWorkingPaths rejects a selected source path beneath a reparse ancestor`
- `test/staging.test.mjs`: `copySelectedWorkingPaths rejects a selected target path beneath a reparse ancestor`
- `test/staging.test.mjs`: `createIsolatedStaging removes its worktree when selected reconstruction fails`
- `test/staging.test.mjs`: `assertOutsideRepository rejects a physical repository child through a repository alias`
- `test/staging.test.mjs`: the inner junction-creation skip in `assertOutsideRepository rejects a Windows junction staging parent`. Its outer `{ skip: process.platform !== 'win32' }` stays.
- `test/staging.test.mjs`: the junction-creation skip inside `makeCrossDriveRepoAlias` (`Windows cannot create a cross-drive repository junction fixture`)

These skips stay skips when the variable is set, because they are layout or platform gates:

- `Distinct-drive fixture unavailable` and `Cannot create a writable external same-drive fixture` inside `makeCrossDriveRepoAlias`
- `{ skip: process.platform !== 'win32' }` on `resolveStagingParent uses the physical repository drive through a Windows junction alias`
- `{ skip: process.platform !== 'win32' }` on `resolveStagingParent derives a canonical fallback root on the non-Windows branch`

`test/validation.test.mjs` has Windows assertion branches and no symlink skip. Leave it alone.

## 4. Workflow

```yaml
name: test
on:
  push:
  pull_request:
jobs:
  test:
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm test
        env:
          ATB_REQUIRE_SYMLINK_TESTS: "1"
      - run: npm run smoke
```

`actions/checkout` uses the default fetch. The workflow does not publish a package and does not need repository secrets.

Both matrix runners set `ATB_REQUIRE_SYMLINK_TESTS`, so both fail the suite when a required symlink fixture cannot be created. Smoke runs after `npm test` on both runners.

## 5. What does not change

- Product behavior for real symlinks stays as the current tests describe: export refuses a symlinked storage root and a selected path through a symlink, import quarantines a staging path that crosses a symlink, a symlinked project config is `INVALID_PROJECT_CONFIG`, and a symbolic-link staging parent is outside the allowed staging location.
- Local Windows runs without the environment variable may still skip.
- Protocol `1.0` and schema `1.1` are unchanged.

## 6. Tests of the skip gate

A unit-level check is enough for the gate itself: a helper `skipOrFailSymlink(t, error)` skips when the variable is unset and throws when it is `1`. The five migrated tests use that helper. The workflow file is asserted by a small test that it exists, names both runners, and sets `ATB_REQUIRE_SYMLINK_TESTS`.

## 7. Modules

- `test/security.test.mjs`
- `test/project-config.test.mjs`
- `test/staging.test.mjs`
- `test/importer.test.mjs` for the dynamic reparse-point skip only
- `.github/workflows/test.yml`
- `test/windows-ci.test.mjs` for the workflow assertion and the helper
