# OS Isolation for Validation Commands

**Status:** Approved on 2026-09-29

**Date:** 2026-09-29

**Goal:** Let the host run post-import lint, test, and build in an OS sandbox that denies network access and denies writes outside the staging worktree.

**Approach:** Opt-in `validationIsolation: "os"`. The default remains today's scrubbed process. If the operating system cannot provide the sandbox, validation is blocked and the commands do not run.

---

## 1. Context

`runValidation` in `src/validation.mjs` executes the commands captured from the trusted pre-import tree. It scrubs the environment, caps output, enforces a timeout, and kills the process tree. The child still has the user's normal rights. A returned change can open the network or write outside the staging directory.

Package-configuration changes already block validation before any command starts. `validationPolicy: "skip"` does not run commands. Those behaviors stay.

## 2. Chosen approach

Add isolation as a second axis beside validation policy.

| Value | Behavior |
| --- | --- |
| `process` | Current behavior. Scrubbed environment, timeout, output cap, process-tree kill. Default when the setting is omitted. |
| `os` | Run each command inside a platform sandbox that denies network and denies writes outside the staging worktree. |

Rejected alternatives:

- Always-on isolation with a silent fall back to `process`. The host could not tell which imports were sandboxed.
- Requiring Docker. That adds a runtime dependency to every import.
- Treating a Windows Job Object as a sandbox. A job can kill the process tree. It does not deny network or filesystem writes. This slice does not call that a sandbox.

## 3. Precedence

The setting lives in git-excluded `.agent-task-bridge/config.json` as `validationIsolation`. Allowed strings are `process` and `os`. An omitted key means `process`. A present value other than those two strings is `INVALID_PROJECT_CONFIG`. Unknown keys still fail.

CLI `--validation-isolation <process|os>` overrides the file. An omitted flag uses the file. An omitted file uses `process`. Any other CLI value throws `INVALID_PROJECT_CONFIG` before commands start. Resolution matches `resolveValidationPolicy`: a non-empty CLI value wins, otherwise the file value, otherwise `process`.

`validationPolicy` and `validationIsolation` are independent. `skip` does not create a sandbox. `prompt` still requires confirmation before any sandbox or command is created. A changed package-manager config still blocks validation first, with `VALIDATION_CONFIG_CHANGED`, and does not start a sandbox.

## 4. Platform behavior for `os`

The sandbox must do both of the following, or it is not available:

- Deny outbound network.
- Deny writes outside the staging worktree. Reads of the Node.js binary and the system libraries it needs are allowed. Writes to the scrubbed temporary home used for `HOME` and `USERPROFILE` are allowed.

Platforms:

- **Linux:** `bwrap` with a network namespace off, a read-write bind of the staging worktree, a read-write bind of the scrubbed home, and read-only binds for `process.execPath` plus the loader and system libraries required to start it. The repository outside the staging worktree stays unreachable for writes. If `bwrap` is not on `PATH`, cannot be spawned, or exits without starting the child command, isolation is unavailable. A denial that kills a child that did start is a command `FAIL`.
- **macOS:** `sandbox-exec` with a profile that denies the network and denies writes outside the staging worktree and the scrubbed home. If `sandbox-exec` is missing or refuses the profile, isolation is unavailable.
- **Windows:** No mechanism in this slice meets both requirements without an extra install or administrator rights. `os` is unavailable on Windows. `process` is unchanged.

Unavailable isolation does not run the command and does not fall back to `process`.

## 5. Report and errors

When `os` is unavailable, validation is blocked:

```text
{
  passed: null,
  blocked: true,
  reason: "SANDBOX_UNAVAILABLE",
  isolation: "os",
  networkDenied: false,
  results: []
}
```

A successful `os` run records:

```text
isolation: "os"
networkDenied: true
```

A `process` run records:

```text
isolation: "process"
networkDenied: false
```

Each command result keeps the current status fields (`PASS`, `FAIL`, `TIMEOUT`, `SKIPPED`). A sandbox that kills the child on a network or write violation is a `FAIL`, with the sandbox diagnostic in `stderr`. It is not reported as `PASS`.

`isolation` and `networkDenied` live on `report.validation`. Importer order, after the current policy resolution:

1. A changed package-manager config stores the existing `VALIDATION_CONFIG_CHANGED` object and does not start a sandbox.
2. Policy `prompt` without confirmation stores the existing `VALIDATION_CONFIRMATION_REQUIRED` object and does not start a sandbox.
3. Policy `skip` calls `runValidation`, which returns today's skipped object (`passed: null`, `skipped: true`, empty `results`) and does not create a sandbox or report `SANDBOX_UNAVAILABLE`.
4. Isolation `os` when the platform cannot provide it stores the blocked object above and does not call `runValidation`. This branch matches the config-changed branch, so the importer's later `report.validation.blocked = false` assignment does not run.
5. Otherwise `runValidation` receives isolation `process` or `os` and returns `isolation` plus `networkDenied` with the current result fields. The importer may set `blocked: false` as it does today.

`runValidation` returns the blocked object when `os` is unavailable. It does not throw `SANDBOX_UNAVAILABLE`. The `validate` command calls `runValidation` directly and prints that object. Import still persists `REPORT.md`, the review, and the receipt for this blocked result, as it does for the other blocked validation objects.

## 6. What does not change

- Default imports stay on `process`.
- Protocol `1.0` and schema `1.1` are unchanged. Isolation is host-side.
- The active worktree is still not modified by import.
- Privacy blocking, archive limits, and the embedded-byte ceiling stay in code. `validationIsolation` is the only new config key.

## 7. Tests

- Omitted config and omitted CLI use `process` and record `networkDenied: false`.
- CLI `os` overrides a config value of `process`, and the reverse.
- `skip` does not spawn a sandbox. Policy `skip` with isolation `os` returns the skipped object and does not report `SANDBOX_UNAVAILABLE`.
- `VALIDATION_CONFIG_CHANGED` does not spawn a sandbox.
- The importer leaves `blocked: true` on `SANDBOX_UNAVAILABLE`.
- An invalid `--validation-isolation` value throws `INVALID_PROJECT_CONFIG` before commands start.
- On Linux, with `bwrap` present, a fixture command that writes outside the staging worktree fails, and a fixture that only writes inside the worktree can pass.
- On macOS, the same pair runs under `sandbox-exec` when it is present.
- When the helper is absent, or the platform is Windows and the requested mode is `os`, the result is `SANDBOX_UNAVAILABLE`, `blocked: true`, and an empty `results` array.
- An invalid config value fails closed with `INVALID_PROJECT_CONFIG` before import starts commands.
- Provider import skills name `--validation-isolation` as an optional override. They keep omitting it so the repo file can apply.

Tests that need `bwrap` or `sandbox-exec` skip only when that helper is missing and `ATB_REQUIRE_OS_SANDBOX` is unset. When `ATB_REQUIRE_OS_SANDBOX=1`, a missing helper fails the test.

## 8. Modules

- `src/config.mjs` allowlists `validationIsolation`.
- `src/validation.mjs` selects the launcher.
- `src/importer.mjs` resolves the setting next to validation policy and stores the blocked sandbox result.
- `bin/agent-task-bridge.mjs` accepts `--validation-isolation`.
- `examples/project-config.example.json` shows the key set to `process`.
- `npm run bundle:plugins` refreshes both provider runtimes.
