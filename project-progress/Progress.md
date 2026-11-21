---
provider_last_used: claude-code
session_id: 2f9afbe2-f1aa-4b11-8e34-3247b3d6f7eb
checkpoint_at: 2026-11-21T11:13:16Z
worktree_dirty: false
base_branch: fix/round-trip-integration
base_commit: 8f2c894b43248ff68630574a2330178b4b99cb60
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
updated: 2026-11-21
last_milestone: v0.3.0 released: round-trip integration fixes
deployed: true
deployment_url: https://github.com/AndriiLavrekha/relay
sensitivity: normal
commit_progress: true
---

# agent-task-bridge

## Resume Snapshot

v0.3.0 ships the round-trip integration fixes:

- Worker side: `pack_result.py`, the text-reply transport, and the Integration Contract.
- Import: elision detection, three-way merge, line-ending restore, and `--brief`.
- Validation: dependency links, multi-language discovery, junction-safe cleanup.
- Follow-up re-export and branch-mode integrate that commits.

Protocol `1.0` and schema `1.1` are unchanged. `bridge_version` is `0.3.0`. Install docs pin `AndriiLavrekha/relay@v0.3.0`. The repository is private.

## Current State

Package version is `0.3.0`. Marketplace catalogs and plugin manifests declare `0.3.0`.

Verification:
- `npm test`: 171 tests, 164 passed, 7 skipped (Windows symlink/reparse fixtures), 0 failed.
- `npm run smoke` passed.
- `npm pack --dry-run`: `agent-task-bridge@0.3.0`, 137 files, package size 119.3 kB, shasum `f5320c6622beb8b767ab8bbdc4232a3a9f79d6af`.
- `claude plugin validate .` passed.
- A real xUnit solution passed `dotnet test` in staging.

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

Install v0.3.0 in Claude Code and Codex. Then run the live round-trip spec on ChatGPT Plus against a repository that has installed dependencies, and record the "Validation executed" and "Return transport" rows. Optional later: a read-only ChatGPT developer-mode MCP connector (`get_task`).

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
