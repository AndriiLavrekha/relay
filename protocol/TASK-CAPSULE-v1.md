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

## Human task contract

The body contains the user objective, current work state, exact delegated work unit, deliverables, acceptance criteria, non-goals, architecture context, project fingerprint, relevant repository tree, and local validation contract.

The machine-readable delegation request is delimited by `<<<ATB_DELEGATION_BEGIN>>>` and `<<<ATB_DELEGATION_END>>>`. Its fields are the same fields accepted by the exporter: objective, work unit/type, title, work state, deliverables, editable scope, acceptance criteria, non-goals, architecture context, and file-role lists.

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

## Result expectation

For code work, the external worker returns Result Capsule v1: a ZIP with `manifest.json`, optional `REPORT.md`, and complete changed/created files under `files/<repo-relative-path>`. The returned manifest must repeat the exact Task Capsule `task_id` and `project.base_commit`.
