---
provider_last_used: claude-code
session_id: c445b617-7a99-47ef-9003-9e74a6263c89
checkpoint_at: 2026-11-22T01:24:25Z
worktree_dirty: true
base_branch: main
base_commit: 2caa69ad579809e58f35c88b77801105e71f2a14
handoff: clean
gate_deploy: done
gate_review: done
gate_tests: done
gate_implementation: done
project: agent-task-bridge
progress_schema_version: 1
status: deployed
path: D:/depot/agent-task-bridge
agent_last_used: unknown
updated: 2026-11-22
last_milestone: v0.3.0 released: round-trip integration fixes
deployed: true
deployment_url: https://github.com/AndriiLavrekha/relay
sensitivity: normal
commit_progress: true
---

# agent-task-bridge

## Resume Snapshot

v0.3.3 released: import now accepts ChatGPT's Markdown-escaped Copy-button replies (unescapes only `<<<ATB_` marker lines), and adds the experimental Claude Code skill `delegate-chatgpt-browser` (user-invoked only, caution gate every run, drives the developer's logged-in Chrome; OpenAI ToS risk documented in README and skill). Protocol 1.0 and schema 1.1 unchanged; bridge_version 0.3.3. Install docs pin AndriiLavrekha/relay@v0.3.3. Prototype findings: browser route worked end to end on a fixture capsule; `codex exec` could not be tested because the ChatGPT account hit its Codex usage limit (reset Nov 25 2026). npm test: 168 pass, 0 fail, 7 skipped. The repository is private.

## Current State

Package version is `0.3.0`. Marketplace catalogs and plugin manifests declare `0.3.0`.

Verification:
- `npm test`: 171 tests, 164 passed, 7 skipped (Windows symlink/reparse fixtures), 0 failed.
- `npm run smoke` passed.
- `npm pack --dry-run`: `agent-task-bridge@0.3.0`, 137 files, package size 119.3 kB, shasum `f5320c6622beb8b767ab8bbdc4232a3a9f79d6af`.
- `claude plugin validate .` passed.
- A real xUnit solution passed `dotnet test` in staging.

## Last Session

Live ChatGPT round trip succeeded (Task 2 of agentic-wars-game clan hall; ZIP via pack_result.py, imported and pushed by another agent). Found and fixed: (1) process.mjs appendBounded counted the cap's remaining budget instead of kept bytes, so validation output after the first chunk was dropped and flagged truncated (build/test diagnostics lost in import reports); regression test added. (2) Timeout lines in the import report now hint at validationTimeoutMs / validationCommands. Earlier: kickoff.md uses `task.md` (committed 98bfb16). Runtimes rebuilt; npm test 165 pass, 0 fail, 7 skipped. Process/reporting fixes uncommitted.

## Next Action

User installs v0.3.3 and tries /task-bridge:delegate-chatgpt-browser end to end (the skill has not been run by a fresh agent yet). After the Codex limit resets (Nov 25 2026 2:36 PM), prototype `codex exec` on a capsule and consider `delegate --worker codex` tested against a stub codex binary. Also consider: making `integrate --mode in-place` refuse when staged validation failed; embedding type signatures automatically; cleaning leftover atb-integration worktrees in Temp.

## Remaining Work

The five approved specifications are not implemented. Order when implementation starts: live round
trip, related-file warnings, OS validation sandbox, Windows symlink CI, handoff commands.

## Done

- [x] Published annotated tag `v0.2.3` and the GitHub release. The five specifications are not implemented in that tag.
- [x] Approved the five 2026-09-29 specifications.
- [x] Published annotated tag `v0.2.2` and the GitHub release.
- [x] Added optional `.agent-task-bridge/config.json` defaults for token budget, validation policy, and extra host steps.
- [x] Published annotated tag `v0.2.1` and the GitHub release.
- [x] Implemented v0.2.1 context coverage, worker-report visibility, and host-owned steps.
- [x] Initialized project progress tracking.
- [x] Confirmed the current directory has no Git metadata.
- [x] Created the first commit on `main`.
- [x] Pushed `main` to the requested GitHub repository.
- [x] Confirmed generated provider runtimes are synchronized with `src/`.
- [x] Validated the Claude marketplace manifest.
- [x] Fixed Windows package-manager command execution.
- [x] Blocked validation when returned package-manager configuration changes.
- [x] Updated Codex local marketplace installation documentation.
- [x] Added public `task-bridge@awesome-task-bridge` installation documentation and marketplace entries.
- [x] Added complete Task Capsule privacy scanning, token budgeting, and schema 1.1 result integrity.
- [x] Added scrubbed bounded validation, lifecycle/receipt/review/follow-up workflow, and confirmation-gated integration.
- [x] Regenerated Claude/Codex runtimes and aligned v0.2.0 release metadata and documentation.

## Blockers

No technical blockers. Seven Windows symlink/reparse-point tests are skipped on this host; HEAD has the same skips. Not verified here: C++ (cmake is not installed), Rust, Go, and PHP validation. Discovery for those is unit-tested with a fake `cargo` on `PATH`. .NET and Node were verified with real fixtures.

## Deployment

Published release: https://github.com/AndriiLavrekha/relay/releases/tag/v0.3.0 (annotated tag `v0.3.0` on `main`). The repository is renamed from `task-bridge` to `relay` and is private, so installs need the user's Git credentials.

- Claude Code: `/plugin marketplace add AndriiLavrekha/relay@v0.3.0`, then `/plugin install task-bridge@awesome-task-bridge`.
- Codex: `codex plugin marketplace add AndriiLavrekha/relay --ref v0.3.0`, then `codex plugin add task-bridge@awesome-task-bridge`.

## Completion Criteria

- The five 2026-09-29 specifications are approved and packaged.
- `npm test`, `npm run smoke`, `npm run bundle:plugins`, and `npm pack --dry-run` pass for `0.2.3`.
- Annotated tag `v0.2.3` is the GitHub release.
- Older capsules without `host_owned_steps` keep their previous acceptance classification.

## Verification

Gates are set with the `set_project_gates` tool, not edited by hand. Each of
`implementation`, `tests`, `review`, and `deploy` takes one of `not-started`,
`in-progress`, `done`, `failing`, or `blocked`. An unset gate means unknown.

Checkpoint fields (`base_commit`, `base_branch`, `worktree_dirty`,
`checkpoint_at`) are stamped automatically when a session ends with this file
updated. Do not edit them by hand.

## Resume Instructions

Open this repository, read `project-progress/Progress.md`, then follow `Next Action`.
