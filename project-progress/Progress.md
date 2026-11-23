---
provider_last_used: gemini
session_id: 939ef4e6-bba0-475d-82af-f4d1a95521a3
checkpoint_at: 2026-11-23T22:25:14Z
worktree_dirty: true
base_branch: feat/metrics
base_commit: 42e89decf3ea93c34baa70c6601ed12ec16155ba
handoff: clean
gate_deploy: done
gate_review: done
gate_tests: done
gate_implementation: done
project: agent-task-bridge
progress_schema_version: 1
status: deployed
path: C:/depot/relay
agent_last_used: Antigravity
model_last_used: gemini-4-argon
effort_last_used: medium
updated: 2026-11-23
last_milestone: v0.3.4 released: Gemini host-agent support and cross-provider plan-chatgpt skill
deployed: true
deployment_url: https://github.com/AndriiLavrekha/relay
sensitivity: normal
commit_progress: true
---

# agent-task-bridge

## Resume Snapshot

Branch feat/metrics (uncommitted, nothing committed): added `agent-task-bridge metrics` (src/metrics.mjs) plus a Claude Code Stop hook (plugins/claude-code/hooks/hooks.json). It reads Claude Code transcripts, attributes tokens and list-price cost to prep/export/import/plan per task id, keeps an append-only ledger at .agent-task-bridge/metrics.jsonl (ids, timestamps, counts only), and supports `metrics note <task-id> --claude-estimate <usd>` for a saving %. Verified: cost matches true session cost exactly on 19 real headless runs (18 bench + 1 live hook session); Sonnet 5.5 rates fitted exactly from 100 runs (input 2 and 5m cache write 2.5 are assumptions). npm test now `node --test "test/**/*.test.mjs"` (bench/ fixtures fail by design and were being picked up): 182 tests, 175 pass, 7 skipped, 0 fail; smoke PASS; plugin bundles regenerated. Also uncommitted: bench/ harness (arms, relay, chatgpt) and its README results. Finding from the live run: the export prep phase is about 80% of orchestration cost.

## Current State

Package version is `0.3.4`. Marketplace catalogs, plugin manifests, and `gemini-extension.json` declare `0.3.4`.

Verification:
- `npm test`: 184 tests, 177 passed, 7 skipped (Windows symlink/reparse fixtures), 0 failed.
- `npm run smoke` passed across `claude-code`, `codex`, and `gemini`.
- `npm pack --dry-run`: `agent-task-bridge@0.3.4`, 195 files.
- `agy plugin validate --strict plugins/gemini`, `gemini extensions validate plugins/gemini`, and `gemini extensions validate .` all passed.

## Last Session

Designed, independently reviewed, planned, implemented, verified, and released v0.3.4 with Gemini host-agent support (`plugins/gemini`, root Gemini CLI extension files, `.agents/plugins.json`) and the `plan-chatgpt` task-breakdown skill across Gemini, Claude Code, and Codex (`docs/releases/v0.3.4.md`).

## Next Action

Review and commit on feat/metrics (metrics feature, bench harness, package.json test glob). Install the branch plugin (/plugin marketplace add with the local path), use the plugin for a while, then run `metrics --repo .` and record `metrics note <task-id> --claude-estimate <usd>` per task to get real saving percentages. Consider a release note and version bump if merged.

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

Published release: https://github.com/AndriiLavrekha/relay/releases/tag/v0.3.4 (annotated tag `v0.3.4` on `main`). The repository is private, so installs need the user's Git credentials.

- Claude Code: `/plugin marketplace add AndriiLavrekha/relay@v0.3.4`, then `/plugin install task-bridge@awesome-task-bridge`.
- Codex: `codex plugin marketplace add AndriiLavrekha/relay --ref v0.3.4`, then `codex plugin add task-bridge@awesome-task-bridge`.
- Gemini CLI: `gemini extensions install https://github.com/AndriiLavrekha/relay --ref v0.3.4`.
- Antigravity CLI/IDE: `agy plugin install https://github.com/AndriiLavrekha/relay/tree/v0.3.4/plugins/gemini`.

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
