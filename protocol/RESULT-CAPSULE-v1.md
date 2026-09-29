# Result Capsule Protocol v1.0

A Result Capsule is the untrusted return transport from ChatGPT (or another external worker) to Agent Task Bridge. The importer validates it before any returned file is staged.

## Archive layout

A code result is one ZIP32 archive:

- `manifest.json` — required;
- `REPORT.md` — required for schema 1.1 `partial`, `blocked`, or `research-only` results;
- `files/<repository-relative-path>` — complete content for every `create` or `modify` operation.

Deletion operations have no file payload. v1 accepts UTF-8 text results only.

## Manifest

Minimum structure:

- `atb_protocol`: exactly `1.0`;
- `capsule_type`: exactly `result`;
- `task_id`: the Task Capsule ID;
- `source_base_commit`: the 40-character Git commit recorded by the Task Capsule;
- optional `summary` and other explanatory metadata;
- `files`: an array of `{ "path": "...", "operation": "create|modify|delete" }` declarations.

Every non-delete declaration must have exactly one corresponding `files/` payload, and every payload must be declared. Duplicate logical paths are rejected.

v0.2 keeps `atb_protocol: "1.0"` and adds `schema_version: "1.1"`. Schema 1.1 results declare `hash_algorithm: "sha256"` and one status: `complete`, `partial`, `blocked`, or `research-only`. Research results use `result_type: "research"`. Optional `bridge_version`, `source_agent`, `external_worker`, `model`, `attempt_id`, and `continuation_of` fields describe provenance; worker model, test, token, and acceptance claims are untrusted.

Every non-delete file declaration also includes `sha256` (64 hexadecimal characters) and `size_bytes`. The importer computes both values over the raw ZIP entry before UTF-8 decoding or staging. The observed ZIP SHA-256 is recorded for provenance only; it is not verified against a worker-supplied archive hash. Legacy results without schema or per-file integrity fields remain readable with a `legacy_integrity` warning and cannot provide an unqualified complete result.

## Archive safety

The reference importer treats the ZIP as hostile. It rejects or bounds path traversal, absolute and Windows/UNC paths, reserved `.git`/`.agent-task-bridge` paths, archive symlinks, duplicate entries, encrypted entries, unsupported compression methods, CRC mismatch, ZIP64/multi-disk archives, excessive file counts, excessive individual files, and excessive expanded size. It never extracts the archive directly into the repository. Before staging a returned path, it also rejects any path that would traverse an existing symlink or non-directory ancestor in the isolated worktree.

## Scope and drift

The importer loads the durable original Task Capsule by `task_id`, verifies the result's source base commit, and compares returned paths with the original editable scope and baseline SHA-256 values.

Returned changes are classified before staging. Clean unchanged files and expected new in-scope files may be applied to an isolated staging worktree. Locally changed, locally deleted, missing-baseline, unexpected-new, or out-of-scope changes are withheld as candidates rather than overwriting current project state.

## Validation

Agent Task Bridge captures supported Node project validation commands and package-manager configuration before applying returned files. It executes the captured commands only when that configuration is unchanged in staging; if returned files modify package-manager configuration, validation is blocked with `VALIDATION_CONFIG_CHANGED`. If some result files are withheld because of conflicts, the validation report is marked partial. Local validation is authoritative; claims inside `REPORT.md` are informational only.

For schema 1.1, `REPORT.md` must contain these headings for code results that are not complete: `Summary`, `Returned or changed files`, `Validation claims`, `Assumptions`, and `Unresolved work / follow-up`. Research reports additionally include `Findings`, `Evidence` or references, `Recommendation`, and `Open questions`. Import reports render separate Worker claims, Local evidence, and Acceptance criteria sections. A worker claim never becomes local verification by itself.

`REPORT.md` is untrusted worker text. The importer rejects an uncompressed entry larger than 512 KB with `REPORT_TOO_LARGE`. When the entry is present and the task id is known, the raw report is written to `.agent-task-bridge/tasks/<task-id>/imports/<import-id>/REPORT.md` even if staging, drift checks, validation, or the import signal fails. That directory is git-ignored bridge storage. Review output keeps a parsed copy capped at 64 KB. High-confidence secrets are replaced in that review copy and in terminal review text with `[REDACTED_SECRET:<category>]`. The raw on-disk report is not rewritten. A missing `REPORT.md` leaves `workerReport.present` false and does not fail a result that does not require the file.

Parsed sections are Summary, Assumptions, Validation claims, Unresolved work, Findings, and Recommendations. Heading matches accept Markdown headings and bold labels. If no heading matches, the first paragraph becomes the summary.

## Host-owned acceptance

When the stored task manifest lists `host_owned_steps`, import can classify an acceptance criterion as `deferred_to_host`. Explicit `[host]`, `[host-owned]`, `(host)`, and `host-owned:` tags always defer. Otherwise the bridge matches the criterion against the declared steps by exact text or by database, workspace, or version-control keyword categories that are active only when the step list contains that category. A worker claim of `deferred_to_host` can defer a criterion that matches one of those dictionaries when the task declared at least one host step.

`deferred_to_host` does not by itself set `review.partial`. The review records `deferredToHost`, `hasDeferredSteps`, and `deferredHostSteps` so the host agent runs those gates locally instead of opening a follow-up capsule. A worker result status of `partial`, `blocked`, or `research-only` still marks the review partial. Overall acceptance status is `blocked`, then `unmet`, then `unverified`, then `deferred_to_host` when every criterion is deferred, then `verified_with_deferred`, then `verified`.

Capsules without `host_owned_steps` do not gain this classification from keywords. Their criteria stay on the v0.2 status set unless the criterion text carries an explicit host tag.

## Integration boundary

Import does not modify the active working tree. A local coding agent or developer reviews the staging diff, conflicts, architecture compatibility, and validation evidence before any separate integration action.
