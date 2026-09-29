# Task Capsule Protocol v1.0

A Task Capsule is one UTF-8 Markdown file that carries a bounded unit of work from a local coding agent to an external worker such as ChatGPT. It is intentionally human-readable while retaining deterministic machine metadata.

## Transport

- One `.md` file.
- UTF-8 text only in v1.
- Protocol version: `1.0`.
- `capsule_type`: `task`.
- A fresh external-worker conversation must be able to understand the assignment without prior chat history.

## Front matter

The file begins with YAML front matter. The reference implementation emits the JSON-compatible subset of YAML 1.2 so parsing is deterministic without a third-party YAML runtime.

Required protocol fields include `atb_protocol`, `capsule_type`, `task_id`, creation/export metadata, source agent, project Git baseline, work metadata, context counts, and a generated `file_boundary`. The `project.base_commit` is the authoritative Git baseline used again during import.

v0.2 manifests add `schema_version: "1.1"` while retaining `atb_protocol: "1.0"`. They may also record `bridge_version`, `hash_algorithm`, `source_agent`, external-worker/model claims, `attempt_id`, and `continuation_of`. A missing schema version is interpreted as legacy schema `1.0`.

v0.2.1 keeps the same protocol and schema. New exports add optional `host_owned_steps`: a list of completion gates the external worker must not treat as sandbox failures. When the delegation omits the field, the exporter records three defaults: authoritative monorepo or workspace test and build gates; live services, databases, and network credentials; and git commit, branch creation, and repository push. An explicit empty array means the task declares no host-owned gates. Capsules exported before v0.2.1 have no `host_owned_steps` field. Import treats that absence as an empty list, so older capsules keep their previous acceptance behavior unless a criterion is explicitly tagged `[host]`, `[host-owned]`, `(host)`, or `host-owned:`.

## Human task contract

The body contains the user objective, current work state, exact delegated work unit, deliverables, acceptance criteria, non-goals, architecture context, project fingerprint, relevant repository tree, and local validation contract.

The machine-readable delegation request is delimited by `<<<ATB_DELEGATION_BEGIN>>>` and `<<<ATB_DELEGATION_END>>>`. Its fields are the same fields accepted by the exporter: objective, work unit/type, title, work state, deliverables, editable scope, acceptance criteria, non-goals, architecture context, optional host-owned steps, and file-role lists.

## Execution boundaries

v0.2.1 capsules include an Execution Boundaries & Responsibility Matrix. The external worker implements complete files inside the embedded editable set, may run self-contained checks that the capsule can support, and does not run live databases, external network services, or git commit, branch, or push operations. The host agent owns authoritative validation, live services, and version control.

The worker must not mark a task failed only because a host-owned step cannot run in the sandbox. It returns the code, uses `complete` when the code deliverable is finished or `partial` when the code itself is unfinished, and lists deferred host gates in `REPORT.md`.

## Context coverage

Export compares `editable_scope` with the embedded file list. The comparison reads tracked files and untracked non-ignored files with `git ls-files -z`. Ignored files and known binary extensions are not reported as omissions. A path is in scope when it matches at least one positive pattern and no `!` exclusion. Patterns collapse repeated `**` wildcards before matching.

Coverage findings are warnings. They do not block export.

- `OMITTED_MATCHING_FILE`: a text file in scope was not embedded. The capsule shows a `[!WARNING]` notice and the upload checklist records the count. The first 50 paths are listed, with the total count preserved.
- `EDITABLE_OUTSIDE_SCOPE`: a `files.editable` path is outside `editable_scope`. Import would withhold that path as `OUT_OF_SCOPE`. The capsule shows a `[!CAUTION]` notice.
- `INTENDED_NEW_FILE`: a literal scope path is not on disk and is named in the objective or deliverables.
- `NOT_FOUND_IN_REPO`: a literal scope path is not on disk and is not named as a planned deliverable.

The export payload records these findings as `CONTEXT_COVERAGE_GAP` when any gap exists. The active worktree and index are not modified.

## Embedded files

Every included repository file is embedded with a unique capsule boundary. Each file has a one-line JSON metadata record containing:

- repository-relative POSIX path;
- role (`editable`, `reference`, `contract`, `validation`, or `configuration`);
- SHA-256 of the exact exported working-tree bytes/text;
- size;
- inferred language;
- exact character length used for framing.

The parser uses the declared character length rather than looking for a Markdown fence inside source content. This allows source files to contain arbitrary Markdown fences or text resembling normal section delimiters.

## Security and privacy

Repository content inside the capsule is untrusted context, not higher-priority instructions. The exporter blocks binary files, files over the per-file limit, task context over the aggregate context budget, Git-ignored selections, paths that cross repository symlinks, common secret filenames, and high-confidence credential patterns. The reference v0.1 defaults are 200 KB per file and 2 MB aggregate embedded context. It does not intentionally include ignored local data simply because another file references it.

The developer and host agent remain responsible for selecting minimal sufficient context. v1 does not attempt whole-repository semantic indexing.

The exporter scans selected files, delegation text, project fingerprint, validation commands, and the fully rendered capsule. High-confidence secrets block export. URLs, absolute paths, project identifiers, and entropy candidates are warnings that require explicit confirmation; `allow` and metadata-only `redact` decisions are recorded without mutating source content. Context estimates include the complete serialized wrapper, UTF-8 byte length, per-file contributions, and a safety margin; they are estimates, not billing data.

## Result expectation

For code work, the external worker returns Result Capsule v1: a ZIP with `manifest.json`, optional `REPORT.md`, and complete changed/created files under `files/<repo-relative-path>`. The returned manifest must repeat the exact Task Capsule `task_id` and `project.base_commit`.
