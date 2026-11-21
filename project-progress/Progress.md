---
provider_last_used: claude-code
session_id: 2f9afbe2-f1aa-4b11-8e34-3247b3d6f7eb
checkpoint_at: 2026-11-21T11:06:42Z
worktree_dirty: true
base_branch: main
base_commit: c845dd99b2c73a5e89c4795485b51500e33b2500
handoff: clean
gate_deploy: not-started
gate_review: not-started
gate_tests: done
gate_implementation: done
project: agent-task-bridge
progress_schema_version: 1
status: active
path: D:/depot/agent-task-bridge
agent_last_used: unknown
updated: 2026-11-21
last_milestone: Round-trip integration fixes implemented, uncommitted
deployed: true
deployment_url: https://github.com/AndriiLavrekha/task-bridge
sensitivity: normal
commit_progress: true
---

# agent-task-bridge

## Resume Snapshot

Uncommitted on `main` (2026-11-21): round-trip integration fixes from an audit. Packer script embedded in the capsule, text-reply import, elision detection, three-way merge, dependency-linked multi-language validation, follow-up re-export, integrate cwd fix plus branch commit, `--brief` review, and a task-id check. Protocol `1.0` and schema `1.1` are unchanged. `bridge_version` is still `0.2.3`; there has been no release or version bump.

## Current State

The working tree has uncommitted round-trip fixes on top of `v0.2.3`.

Verification:
- `npm test`: 171 tests, 164 passed, 7 skipped, 0 failed. Pristine HEAD also has 7 skips, out of 157 tests.
- `npm run smoke` passed.
- `npm pack --dry-run`: 136 files, package size 118.1 kB.

Live checks:
- A real xUnit solution passed `dotnet test` in staging, with CRLF line endings restored.
- A repository with a git-ignored dependency in `node_modules` passed `npm test` in staging.
- `cmake` is not installed on this host, so C++ validation is unverified.

Bug fixed this session: staging cleanup used `git worktree remove --force`, which follows Windows junctions and deleted the real `node_modules`. Cleanup now detaches links first. Regression test: `test/round-trip.test.mjs`.

## Last Session

The audit found the following, and all of it is now fixed:

- Staging validation lacked git-ignored dependencies. Reproduced.
- The worker hand-computed hashes and the base commit.
- Abbreviated files were staged silently. `--allow-elision` now overrides after review.
- `LOCAL_CHANGED` files were withheld whole instead of three-way merged.
- `follow-up` embedded the stale baseline.
- `integrate` ran `git worktree add` without `cwd`. Branch mode now commits and removes its temporary worktree.
- Validation discovery was Node-only.
- The review dumped full logs. `--brief` now gives a compact view.
- `task_id` reached `loadStoredTask` without a format check.

New this session: a junction-safe staging cleanup. New modules: `src/elision.mjs`, `src/merge.mjs`, `src/reply.mjs`, `src/packer.mjs`. New tests: `test/round-trip.test.mjs`. The approved live round-trip spec gained "Validation executed" and "Return transport" rows; its preconditions still pin `v0.2.2`.

## Next Action

1. The owner reviews and commits the uncommitted round-trip fixes. Suggested split: validation, transport, import checks, integrate/follow-up, docs.
2. Bump the version and release.
3. Run the live round-trip spec on ChatGPT Plus against a repository that has installed dependencies. The spec gained "Validation executed" and "Return transport" rows.
4. Optional later: a read-only ChatGPT developer-mode MCP connector (`get_task`). Plus may not allow write actions, so results still return via ZIP or text reply.

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

Published release: https://github.com/AndriiLavrekha/task-bridge/releases/tag/v0.2.3
Annotated tag `v0.2.3` points at `004d995` on `main`. Tag `v0.2.2` remains at `3dfa986`.

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
