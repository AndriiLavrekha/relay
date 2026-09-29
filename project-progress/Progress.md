---
session_id: 01a0ed26-f5b9-7453-afa7-8b41fcc221b0
checkpoint_at: 2026-09-29T15:14:11Z
worktree_dirty: true
base_branch: main
base_commit: 78171cc76c5265b0944e86649487f5c880a65325
handoff: clean
gate_deploy: not-started
gate_review: done
gate_tests: done
gate_implementation: done
project: agent-task-bridge
progress_schema_version: 1
status: active
path: D:/depot/agent-task-bridge
agent_last_used: unknown
updated: 2026-09-29
last_milestone: local project config implemented
deployed: true
deployment_url: https://github.com/AndriiLavrekha/task-bridge
sensitivity: normal
commit_progress: true
---

# agent-task-bridge

## Resume Snapshot

v0.2.2 adds git-excluded `.agent-task-bridge/config.json` for `maxTokens`, `validationPolicy`,
and `extraHostOwnedSteps`. CLI flags and an explicit delegation `host_owned_steps` field win.
Protocol `1.0` and schema `1.1` are unchanged. Install docs pin `v0.2.2`.

## Current State

Package version is `0.2.2`. Marketplace catalogs and plugin manifests declare `0.2.2`.
`npm test` passed 152 tests with 5 intentional Windows symlink skips and 0 failures. Smoke passed
both provider directions. `npm pack --dry-run` packed `agent-task-bridge@0.2.2` with 118 files.

## Last Session

Added local project configuration on top of the published v0.2.1 release. The file is
`.agent-task-bridge/config.json`. It cannot change privacy blocking or archive safety limits.

## Next Action

Push `main`, create annotated tag `v0.2.2`, and publish the GitHub release.

## Remaining Work

- [ ] Publish annotated tag `v0.2.2` and the GitHub release.

## Done

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

No technical blockers. Four Windows symlink/reparse-point tests remain intentionally skipped on
this host.

## Deployment

Published release: https://github.com/AndriiLavrekha/task-bridge/releases/tag/v0.2.1
Annotated tag `v0.2.1` points at `486408c` on `main`.

## Completion Criteria

- The approved v0.2.1 spec is implemented.
- Protocol, architecture, README, release notes, example delegation, and both provider skills describe the new behavior.
- `npm test`, `npm run smoke`, `npm run bundle:plugins`, and `npm pack --dry-run` pass for `0.2.1`.
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
