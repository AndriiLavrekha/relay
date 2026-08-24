# Agent Task Bridge Readiness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix Windows validation execution, prevent returned configuration from controlling validation commands, remove the brittle Node-version assertion, and document a verifiable Codex marketplace workflow.

**Architecture:** Keep the shared runtime and provider bundles unchanged in shape. Resolve package-manager shims at the process boundary, snapshot validation commands from the trusted repository before result files are applied, and let the existing staging runner execute only that snapshot.

**Tech Stack:** Node.js 22+, native ESM, `node:test`, Git worktrees, Claude Code and Codex plugin manifests.

## Global Constraints

- Preserve the protocol v1 capsule formats.
- Do not add runtime dependencies.
- Keep the active worktree untouched during import.
- Do not add CI in this change.
- Regenerate both provider runtime copies after canonical runtime changes.

### Task 1: Windows-safe validation command resolution

**Files:**
- Modify: `src/validation.mjs`
- Test: `test/validation.test.mjs`

- [x] Add a regression test asserting npm commands use a Windows command shim and retain `npm` elsewhere.
- [x] Run the focused test and observe the expected failure.
- [x] Implement the smallest platform-aware invocation change.
- [x] Run focused validation tests and the full suite.

### Task 2: Trusted validation command snapshot

**Files:**
- Modify: `src/importer.mjs`
- Test: `test/e2e.test.mjs` or `test/security.test.mjs`

- [x] Add a regression case where a returned `package.json` attempts to alter validation scripts, and assert validation is blocked.
- [x] Run the focused test and observe the expected failure.
- [x] Discover commands and package configuration before staging returned files; block validation when configuration changes.
- [x] Run E2E and security tests.

### Task 3: Supported Node-version assertion

**Files:**
- Modify: `test/context.test.mjs`

- [x] Replace the exact `v22` assertion with an assertion compatible with the declared `>=22` engine requirement.
- [x] Run the focused context test and the full suite.

### Task 4: Codex marketplace documentation and verification

**Files:**
- Modify: `plugins/codex/README.md`
- Modify: `README.md`
- Test: `test/plugin-adapters.test.mjs`

- [x] Document adding the local marketplace with `codex plugin marketplace add <repository-path>` and installing the plugin with the current CLI commands.
- [x] Add a documentation assertion for the explicit marketplace workflow.
- [x] Run Claude manifest validation, package checks, and the complete test suite.

### Task 5: Bundle and handoff verification

- [x] Run `npm run bundle:plugins`.
- [x] Verify both generated runtimes match `src/`.
- [x] Run `npm test`, `npm run smoke`, and `npm pack --dry-run`.
- [x] Review the final diff and record results in project progress and audit notes.
