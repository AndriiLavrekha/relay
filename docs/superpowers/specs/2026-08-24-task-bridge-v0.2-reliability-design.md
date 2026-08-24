# Agent Task Bridge v0.2 Reliability Design

**Status:** Brainstormed and approved for written-spec review

**Date:** 2026-08-24

**Goal:** Make a real Export -> ChatGPT -> Import -> Review -> Follow-up cycle safe, explainable, recoverable, and honest about incomplete work without breaking the v0.1 manual capsule workflow.

**Approach:** Compatibility-first incremental hardening. Keep `atb_protocol: "1.0"`, preserve the human-readable Task Capsule and ZIP Result Capsule transports, and add an additive manifest schema version plus local workflow services. Existing capsules remain readable, but legacy capsules do not receive the strongest completeness or validation interpretation.

## Context and observed evidence

The v0.1 workflow is operationally healthy: `npm test` passes 49 of 52 tests with three intentional Windows skips, `npm run smoke` passes both provider directions, generated provider runtimes are tested for synchronization, and the v0.1.0 release is published.

The real full-cycle run exposed two product gaps:

1. ChatGPT returned only part of the requested work. A local coding agent had to evaluate the result, fix missing pieces, and finish integration.
2. Import validation created a duplicate repository under `.agent-task-bridge/staging`. The host project's normal pnpm lint and formatting commands discovered that duplicate tree.

The current implementation confirms both risks:

- `src/staging.mjs` creates staging inside the repository and copies all tracked and non-ignored untracked paths.
- `src/process.mjs` inherits the host environment and has no timeout, output limit, or process-tree termination.
- `src/secrets.mjs` scans only selected source paths with a small set of patterns.
- `src/context.mjs` estimates only selected file characters divided by four.
- `src/result-capsule.mjs` validates archive structure but not returned-file hashes, byte lengths, result status, or completeness evidence.
- `src/importer.mjs` reports base drift but uses a fixed `activeWorktreeModifiedByImport: false` value and has no transactional cleanup.
- `bin/agent-task-bridge.mjs` has no kickoff-bundle, task-show, follow-up, review, receipt, or integration lifecycle commands.

## v0.2 scope

The release has four connected pillars:

1. **Staging and import safety:** outside-repository selective staging, strict operation semantics, reparse-point handling, cleanup, drift policy, and active-tree assertions.
2. **Validation hardening:** trusted command snapshots, scrubbed execution, timeouts, output limits, process-tree termination, and explicit validation policy.
3. **Result privacy, integrity, and completeness:** metadata and returned-content scanning, hashes and lengths, structured status, report requirements, acceptance evidence, and worker-claim separation.
4. **Handoff, continuation, review, and receipts:** generated kickoff bundles, token/file summaries, task inspection, follow-up capsules, review output, lifecycle state, immutable receipts, and confirmation-gated integration.

The complete backlog disposition appears at the end of this document. It is a roadmap, not a promise to implement every item in v0.2.

## Design principles

- The active worktree is read-only during export and import.
- The external worker and all returned prose/code are untrusted.
- Local validation is authoritative only for what it actually executed.
- Worker-reported status, tests, model, and token usage are claims, never local evidence.
- Import never silently overwrites active files or silently ignores drift.
- Durable metadata may live under `.agent-task-bridge`, but executable staging never does.
- New protocol fields are additive; old capsules remain inspectable.
- Safety defaults must be deterministic and usable without third-party runtime dependencies.
- Every safety decision must be visible in the report and receipt.

## Architecture

The bridge remains a deterministic shared core with thin Claude Code and Codex adapters.

```text
Export
  delegation + selected repository files
    -> context/privacy scan
    -> project fingerprint and validation snapshot
    -> complete Task Capsule rendering
    -> rendered-capsule privacy scan and full-size estimate
    -> Task Capsule + kickoff bundle + task record

Import
  Result Capsule ZIP
    -> ZIP, path, schema, and UTF-8 validation
    -> result metadata/source/report privacy scan
    -> operation, hash, length, and scope validation
    -> task/baseline/drift comparison
    -> outside-repository staging worktree
    -> clean in-scope file application
    -> hardened local validation under explicit policy
    -> acceptance evidence and review report
    -> immutable receipt and optional follow-up capsule

Review and integration
  persisted import record
    -> diff/stat/conflict/validation/evidence review
    -> explicit confirmation
    -> named branch or reviewed integration
```

The implementation should keep responsibilities focused. The existing modules remain the starting points; new focused modules may be introduced for privacy policy, validation process policy, receipts, handoff generation, and review formatting rather than expanding `importer.mjs` into an unbounded orchestrator.

## Compatibility and protocol evolution

`atb_protocol` remains exactly `"1.0"` in v0.2. New Task and Result manifests add `schema_version: "1.1"`. A missing schema version is interpreted as legacy `"1.0"`.

New v0.2 manifests may include:

```json
{
  "schema_version": "1.1",
  "bridge_version": "0.2.0",
  "hash_algorithm": "sha256",
  "source_agent": "codex",
  "external_worker": "chatgpt",
  "model": "optional-worker-claim",
  "attempt_id": "attempt_01...",
  "continuation_of": "optional-import-id",
  "status": "complete|partial|blocked|research-only"
}
```

The `model`, worker validation, worker token usage, and worker acceptance claims are explicitly untrusted. The local receipt stores them under a worker-claims section separate from local evidence.

Every non-delete returned file declaration includes:

```json
{
  "path": "src/example.js",
  "operation": "modify",
  "sha256": "64-hex-character-content-hash",
  "size_bytes": 1234
}
```

For each non-delete file, the importer computes SHA-256 and byte length over the raw archive entry at `files/<path>` and compares those values with that file's manifest declaration before UTF-8 decoding or staging. The Result Capsule ZIP itself has no trusted worker-provided reference hash; the receipt records its observed hash for provenance only. Existing results without per-file fields remain readable as legacy results but receive a `legacy_integrity` warning and cannot produce an unqualified complete result.

## Pillar 1: staging and import safety

### Staging topology

The default staging directory is outside the repository, under the operating system temporary directory when that location is usable. Before creating the worktree, the bridge compares filesystem volume/device identity. If the OS temporary directory is on another Windows drive or otherwise causes a cross-device worktree/copy failure, the bridge falls back to a same-volume directory outside the repository, such as a sibling `.agent-task-bridge-staging` root, or to an explicit user-supplied staging directory. A custom staging directory must be outside the repository and pass the same real-directory/reparse-point checks. If no safe location is available, import fails with an actionable staging-location error rather than silently moving staging back inside the repository. `.agent-task-bridge` stores task metadata, candidates, reports, receipts, and lifecycle records only; it never stores a duplicate executable repository tree.

The staging worktree is created from the current integration `HEAD`, which is recorded separately from the Task Capsule source baseline. This allows the review diff to represent the current integration target while preserving the original baseline for drift analysis.

### Working-tree reconstruction

After creating the clean Git worktree, the bridge copies only:

- dirty files explicitly embedded in the Task Capsule;
- explicitly selected untracked files embedded in the Task Capsule;
- clean, in-scope result files;
- no unrelated untracked files;
- no ignored files by default;
- no active-tree symlink, junction, or reparse-point target.

The worktree policy records excluded dirty/untracked paths in the report when they could affect interpretation. It does not silently claim that validation represents the entire active working tree.

### Strict operation semantics

- `create` is valid only when the path was absent from the Task Capsule baseline and is absent from the current target.
- `modify` is valid only when the path existed in the Task Capsule baseline and the current target still matches that baseline.
- `delete` is valid only when the path existed in the baseline and the current target still matches that baseline.
- Any operation/precondition mismatch is rejected or withheld before validation.
- A returned path outside the editable scope is never staged.
- A path crossing a staging symlink, junction, or reparse point is never staged.

### Drift policy

The default base-drift policy is `review_required`: staging may be prepared, but automatic validation is blocked until the user explicitly allows validation against a changed base. A `block` policy is available for stricter environments, and an explicit `allow` policy records the decision in the receipt. Base drift is always visible.

### Transaction and active-tree invariance

Import uses a transaction boundary:

- validation failure before staging: no worktree is retained;
- staging or process failure: the worktree is removed when possible, and the result/failure record remains recoverable;
- successful import: the staging worktree remains available for review;
- interruption: the import is marked `interrupted` and cleanup is attempted;
- structural/privacy rejection: the lifecycle is marked `rejected` and the recoverable record contains no copied sensitive payload;
- staging or process failure: the lifecycle is marked `failed`, cleanup is attempted, and the result/failure record remains recoverable.

Before import, the bridge records a full Git-visible active-tree fingerprint: the sorted path/type set from tracked files plus non-ignored untracked files, and a content hash and byte length for every such regular file. It excludes the bridge metadata root and ignored files, which are outside the Git-visible worktree policy. The same full fingerprint is computed after import. The safety field is true only when both the path/type set and every recorded file hash/length match. This deliberate full scan provides a strong assertion that import did not mutate any Git-visible active file; a future scoped mode would have to report a weaker guarantee explicitly.

## Pillar 2: validation hardening

Validation commands come from the pre-import trusted snapshot. Returned package scripts and lockfiles cannot redefine commands for the same import. Relevant validation configuration is detected recursively across supported workspace/package boundaries, including nested package manifests and lockfiles.

The default validation policy is `safe`:

- use a scrubbed environment with platform execution variables and a temporary home/config location;
- exclude inherited credential, token, cloud, package-manager, and agent variables;
- apply per-command and total validation timeouts;
- cap stdout and stderr and mark truncation;
- terminate the full process tree on timeout or interruption; on Windows, launch validation in a tracked process group and use `taskkill.exe /PID <pid> /T /F` for tree termination, while POSIX uses a detached process group and negative-PID signal handling;
- record command, executable, arguments, working directory, environment policy, exit code, signal, duration, and truncation;
- continue through all declared validation checks unless the policy explicitly stops on first failure.

The CLI also exposes `prompt` and `skip` validation policies. `prompt` requires confirmation before repository scripts execute. `skip` records validation as not run. This is process-execution hardening, not an OS-level sandbox. Container/VM execution and optional network isolation remain later extensions.

If any returned file is withheld, validation is marked partial. A partial validation result cannot be summarized as validation of the complete returned result.

## Pillar 3: privacy, integrity, and completeness

### Privacy scanner

One policy-driven scanner is used at both boundaries.

Export scans selected paths/content, delegation text, fingerprint data, validation commands, and the fully rendered Task Capsule. Import scans all result manifest metadata, all returned file bytes, and `REPORT.md` before staging or durable copying.

Findings contain category, confidence, source location, and action. High-confidence private keys, credential files, known provider tokens, database connection strings, and equivalent secrets default to `block`. Absolute paths, URLs, IPs, project identifiers, generic credential-like assignments, and entropy candidates default to `warn` and require explicit confirmation. `allow` is recorded in the receipt. `redact` is limited to bridge-generated metadata/report copies; source code is never silently mutated into a redacted and potentially broken file.

### Result status and report contract

Every v0.2 result declares one status: `complete`, `partial`, `blocked`, or `research-only`. A research result uses `result_type: "research"` and must include `REPORT.md`.

`REPORT.md` is also required for non-complete code results. Its minimum headings are:

- Summary
- Returned or changed files
- Validation claims
- Assumptions
- Unresolved work / follow-up

Research reports additionally include Findings, Evidence or references, Recommendation, and Open questions. Heading validation is structural; prose remains untrusted.

Acceptance criteria are rendered and stored as three separate values:

- worker claim;
- local deterministic evidence;
- final review status.

The importer marks criteria `verified`, `unverified`, `unmet`, or `blocked`. It does not infer verification merely from a worker's `complete` status or a passing test command.

## Pillar 4: handoff, continuation, review, and receipts

### Handoff bundle

Every export writes a durable bundle containing:

- Task Capsule;
- generated kickoff prompt;
- upload checklist;
- expected Result Capsule contract;
- file and token summary with largest contributors;
- task metadata and initial lifecycle state.

The kickoff prompt requires complete resulting files, explicit status, required report headings, validation claims, assumptions, unresolved work, and acceptance evidence.

### Context accounting

The exporter estimates the complete serialized Task Capsule, including wrapper, metadata, prompt, framing, and safety margin. It exposes `--max-tokens`, reports per-file contributions, and labels token counts as estimates rather than billing data. Result payload, validation output, and review artifacts receive separate estimates where available.

### Lifecycle and commands

The persisted lifecycle is:

```text
exported -> result-received -> inspected -> staged -> reviewed -> integrated
                               |             |         |
                               |             |         +-> follow-up
                               |             +-> follow-up
                               +-> rejected
                               +-> failed/interrupted
```

`status` (`complete`, `partial`, `blocked`, or `research-only`) is orthogonal to lifecycle. A partial or worker-blocked result may still pass file-level privacy, integrity, scope, drift, and path checks and therefore proceed through `staged` and `reviewed` with its status and unmet criteria attached. A follow-up may be generated from `inspected`, `staged`, or `reviewed` whenever criteria remain unresolved. `rejected`, `failed`, and `interrupted` are recoverable terminal lifecycle states with receipts; they do not imply that the active worktree was modified.

The v0.2 CLI adds:

- `task show <task-id>` for objective, files, token estimate, baseline, lifecycle, and next action;
- `review <import-id>` for diff stat, changed/withheld files, drift, privacy findings, validation, report summary, and acceptance status;
- `follow-up <import-id>` for a continuation Task Capsule containing unresolved criteria, withheld candidates, failed/blocked validation, and the original contract;
- `integrate <import-id>` for confirmation-gated application or named-branch creation after review.

### Immutable receipt

Each import writes one immutable JSON receipt containing task hash, result hash, source baseline, target `HEAD`, import ID, staging policy, file decisions, privacy findings, worker claims, local validation provenance/results, acceptance status, lifecycle transitions, and active-tree before/after fingerprints.

## Error handling

Failures are actionable and categorized. The bridge must reject or preserve the input for:

- unsafe privacy findings;
- invalid schema, protocol, or result status;
- hash/length mismatch;
- operation precondition mismatch;
- scope expansion;
- base drift under a blocking policy;
- unsafe reparse-point path;
- validation configuration changes;
- missing required report sections;
- timeout, output truncation, or process termination;
- cleanup failure.

The active worktree must remain unchanged even when an import fails. A failed import keeps enough local metadata to explain what happened without copying sensitive payloads into the repository metadata store.

## Testing and release gates

Unit and integration tests cover:

- outside-repository staging;
- exclusion of unrelated untracked files;
- selected dirty/untracked reconstruction;
- symlink, junction, and reparse-point handling;
- failed/interrupted cleanup;
- strict create/modify/delete semantics;
- returned hash and byte-length mismatch;
- Task Capsule and Result Capsule metadata scanning;
- returned source and report scanning;
- scrubbed environment;
- timeout, output cap, and process-tree termination;
- recursive validation configuration changes;
- drift policy and active-tree fingerprint invariance;
- partial/blocked status and acceptance evidence;
- kickoff, follow-up, review, lifecycle, and receipt artifacts.

The release gates remain:

```text
npm test
npm run smoke
npm run bundle:plugins
npm pack --dry-run
```

Generated Claude and Codex runtimes must remain byte-synchronized with `src/` and `bin/`.

## Complete backlog disposition

| # | Disposition | Decision |
|---:|---|---|
| 1 | v0.2 | Scan all rendered Task Capsule metadata, not only selected files. |
| 2 | v0.2 | Add high-confidence npm, GitLab, Slack, Stripe, Azure, GCP, JWT, database URL, generic credential, and carefully gated entropy rules. |
| 3 | v0.2 | Implement block, warn/confirm, and allow; restrict safe redaction to bridge-generated metadata. |
| 4 | v0.2 | Scan returned file bytes, Result metadata, and `REPORT.md` before staging or durable copying. |
| 5 | v0.2 | Harden validation with scrubbed environment, policy, limits, and process-tree cleanup; defer true OS sandboxing. |
| 6 | v0.2 | Detect validation configuration changes recursively across supported monorepo/workspace boundaries. |
| 7 | v0.2 | Enforce create/modify/delete baseline and current-target preconditions. |
| 8 | v0.2 | Require returned-file SHA-256 and byte lengths for new-schema results. |
| 9 | v0.2 | Make base drift review-required by default, with explicit block/allow policies. |
| 10 | v0.2 | Compute active-tree before/after fingerprints instead of using a fixed field. |
| 11 | v0.2 | Estimate the fully serialized capsule with wrapper and safety margin. |
| 12 | v0.2 | Add a hard `--max-tokens` option with no silent truncation. |
| 13 | v0.2 | Report per-file token/byte contributions and largest contributors. |
| 14 | Later | Add minimal/balanced/full/provider profiles after the base budget model is proven. |
| 15 | Later | Add suggestion-only context discovery after repeated tasks show selection failures. |
| 16 | Later | Add opt-in document section selection/compression; never silently summarize code. |
| 17 | Later | Add linked capsule splitting only after context limits are observed in real usage. |
| 18 | v0.2 | Record separate estimated export, result, validation, and review usage. |
| 19 | v0.2 | Generate a kickoff prompt beside every Task Capsule. |
| 20 | v0.2 | Generate the complete handoff bundle and upload checklist. |
| 21 | Later | Add clipboard support after the prompt artifact is stable. |
| 22 | v0.2 | Add `task show` with status, baseline, files, tokens, and next action. |
| 23 | v0.2 | Persist reduced lifecycle states; defer archived semantics to retention work. |
| 24 | v0.2 | Generate linked continuation/follow-up capsules from incomplete imports. |
| 25 | v0.2 | Require structured result status and treat it as an untrusted claim. |
| 26 | v0.2 | Require and structurally validate reports for research and non-complete results. |
| 27 | v0.2 | Add acceptance-criteria evidence with verified/unverified/unmet/blocked states. |
| 28 | v0.2 | Move executable staging outside the repository by default. |
| 29 | v0.2 | Add transactional cleanup for failed and interrupted imports. |
| 30 | Later | Add explicit cleanup/prune/stale-worktree commands after receipt lifecycle exists. |
| 31 | Later | Expand Windows locked-file, junction, and reparse cleanup after core primitives land. |
| 32 | v0.2 | Copy only tracked baseline plus explicitly selected dirty/untracked files and returned files. |
| 33 | v0.2 | Reject or quarantine active-tree symlinks, junctions, and reparse points during staging. |
| 34 | Later | Add Windows CI coverage when CI scope is reopened. |
| 35 | v0.2 | Add authoritative review output with diff stat, withheld files, drift, validation, and evidence. |
| 36 | v0.2 | Add confirmation-gated integration or named-branch creation after review. |
| 37 | Later | Add optional commit-message generation after receipts and review stabilize. |
| 38 | Later | Add editor/open-diff integration after the review command is stable. |
| 39 | v0.2 | Store immutable task/result hashes, baseline, import, and validation receipts. |
| 40 | Later | Add retention controls after cleanup/prune policy is defined. |
| 41 | v0.2 | Define machine-readable schemas for current Task and Result shapes without a protocol cutover. |
| 42 | Later | Defer capability negotiation and migration until a second incompatible protocol/worker exists. |
| 43 | v0.2 | Add bridge/schema/hash/source/worker/model/attempt provenance fields. |
| 44 | v0.2 | Separate worker claims from local evidence in reports and receipts. |
| 45 | Later | Existing bundle synchronization tests remain; add release/CI enforcement when CI scope returns. |
| 46 | Later | Add Node/platform matrix coverage as release engineering, not v0.2 runtime scope. |
| 47 | Later | Document current glob semantics and add edge tests before adopting a mature dependency. |
| 48 | Later | Add Windows device-name, ADS, trailing-space/dot, junction, and Unicode path tests. |
| 49 | Later | Keep v0.2 text-only; design explicit MIME/binary support separately. |
| 50 | Later | Document a provider-neutral adapter contract after the local protocol stabilizes. |
| 51 | Later | Preserve manual transport until permissions and lifecycle behavior are proven. |
| 52 | Later | Keep blocking/scanning as the v0.2 privacy response; consider encrypted storage later. |
| 53 | Later | Defer enterprise path, command, retention, and network policy surfaces. |
| 54 | Later | Defer pricing/cost estimation until local estimates and model reporting are reliable. |

## Success criteria

The v0.2 release is successful when:

1. staging never resides under the active repository or contains unrelated untracked files;
2. active-tree invariance is observed and reported;
3. returned secrets and malformed result operations are stopped before staging;
4. validation cannot inherit host credentials or run without limits;
5. base drift, withheld files, partial validation, and worker claims are clearly separated;
6. a partial ChatGPT result produces explicit unmet criteria and a follow-up capsule;
7. a generated kickoff bundle reduces handoff omissions;
8. review output and receipts provide enough evidence for a coding agent to integrate deliberately;
9. all existing v0.1 tests, smoke flows, bundles, and package checks continue to pass.

## Planned implementation decomposition

After written-spec review, implementation planning will be split into independently testable plans:

1. import boundary, staging, drift, operation semantics, cleanup, and active-tree assertions;
2. privacy scanner, result schema/integrity, report contract, and acceptance evidence;
3. validation process policy, recursive configuration detection, limits, and provenance;
4. handoff bundle, lifecycle, follow-up, review, receipt, and confirmation-gated integration;
5. final provider bundle synchronization, documentation, and release verification.

Each plan must preserve the project requirement of zero third-party runtime dependencies, native ESM, Node.js 22+, Windows/macOS/Linux support, and generated provider runtime synchronization.
