# Agent Task Bridge

Agent Task Bridge is a local-first delegation protocol and CLI for handing one bounded unit of repository work from Claude Code or OpenAI Codex to ChatGPT, then bringing the result back through drift detection, isolated staging, and local validation.

It deliberately does **not** synchronize conversations or upload a repository through an API. The host coding agent understands the developer's current intent and selects minimal relevant context. The deterministic bridge records repository truth, packages one Task Capsule, and later treats the returned Result Capsule as untrusted proposed work.

## MVP workflow

1. Work normally in Claude Code or Codex.
2. Invoke the provider's export skill and specify the unit to delegate.
3. The local agent creates a structured delegation request and the bridge writes one Task Capsule Markdown file under `.agent-task-bridge/exports/`.
4. Upload that single file to a fresh ChatGPT conversation.
5. Ask ChatGPT to execute it and return Result Capsule v1 as a ZIP.
6. Download the ZIP and invoke the provider's import skill.
7. The bridge validates the archive, task ID, source baseline, paths, scope, and repository drift.
8. Clean candidates are applied only to an isolated Git worktree. Conflicting or out-of-scope files are withheld for review.
9. Supported Node project format/lint/typecheck/test/build scripts run locally in staging.
10. The coding agent reviews the diff and evidence. Integration into the active working tree is a separate, explicit action.

The same protocol allows Claude Code → ChatGPT → Codex and Codex → ChatGPT → Claude Code because essential state lives in the Task Capsule and local task history rather than one provider's conversation database.

## Requirements

- Node.js 22 or newer
- Git
- A Git repository for export/import

There are zero third-party runtime npm dependencies.

## CLI

Run directly from a checkout:

- `node bin/agent-task-bridge.mjs help`
- `node bin/agent-task-bridge.mjs export --delegation examples/delegation.example.json --repo /path/to/repo --source-agent codex`
- `node bin/agent-task-bridge.mjs inspect-task <task.md>`
- `node bin/agent-task-bridge.mjs inspect-result <result.zip>`
- `node bin/agent-task-bridge.mjs import <result.zip> --repo /path/to/repo`
- `node bin/agent-task-bridge.mjs validate --dir <staging-or-project-dir>`
- `node bin/agent-task-bridge.mjs status --repo /path/to/repo`

You can also run `npm link` from this repository to expose `agent-task-bridge` on your `PATH`.

## Claude Code plugin

This repository is itself a Claude plugin marketplace through `.claude-plugin/marketplace.json`. Add the repository root as a marketplace, install `task-bridge@awesome-task-bridge`, then use the namespaced export/import skills. See `plugins/claude-code/README.md`.

The public marketplace also exposes this plugin as `task-bridge`:

```text
claude plugin marketplace add AndriiLavrekha/task-bridge
claude plugin install task-bridge@awesome-task-bridge
```

Claude's plugin is self-contained because installed plugins are cached independently of their marketplace checkout. The provider bundle therefore contains a generated copy of the exact shared runtime.

## Codex plugin

The Codex package lives under `plugins/codex` and includes `.codex-plugin/plugin.json`, skills, and its generated runtime copy. Add the repository as a local marketplace with `codex plugin marketplace add /absolute/path/to/agent-task-bridge`, then install `task-bridge@awesome-task-bridge`. A workspace-local marketplace example is included at `.agents/plugins/marketplace.json`. See `plugins/codex/README.md`.

The public marketplace also exposes this plugin as `task-bridge`:

```text
codex plugin marketplace add AndriiLavrekha/task-bridge
codex plugin add task-bridge@awesome-task-bridge
```

## Delegation input

Provider skills translate the current coding-agent state into a short JSON request. The exporter is intentionally not responsible for semantic reasoning about the entire conversation. Required concepts include:

- higher-level objective and exact work unit;
- deliverables and acceptance criteria;
- explicit editable scope and non-goals;
- concise architecture context;
- explicit relevant files grouped by role.

See `examples/delegation.example.json`.

## Task Capsule v1

The output is one human-readable Markdown file with protocol metadata, Git baseline, project fingerprint, validation contract, structured delegation, and exact embedded source files with SHA-256 hashes. Source contents are length-framed so Markdown-like text cannot break parsing.

See `protocol/TASK-CAPSULE-v1.md`.

## Result Capsule v1

A code result is one ZIP containing `manifest.json`, optional `REPORT.md`, and complete created/modified text files under `files/`. The importer validates archive structure and does not blindly extract it.

See `protocol/RESULT-CAPSULE-v1.md`.

## Security model

Export blocks likely secret files/content, Git-ignored selections, paths that traverse repository symlinks, binary files, files over 200 KB, and task context over 2 MB by default. Import rejects dangerous archive paths, reserved bridge/Git paths, symlinks, duplicate entries, encryption, unsupported compression, CRC corruption, undeclared payloads, and bounded-size violations. Returned files outside the original editable scope or through staging symlink ancestors are quarantined rather than staged.

The external worker's code and prose remain untrusted. Validation commands are captured from the repository before returned files are applied; if package-manager configuration changes in staging, validation is blocked for review rather than executing returned scripts. Local tests/builds are authoritative, and the active worktree is not modified by import.

## Repository drift

Every embedded file records the exact exported SHA-256. When a result comes back, the importer compares the current project with the stored baseline. Clean changes can be staged; locally changed/deleted or otherwise conflicting files are withheld as candidates for semantic integration. A changed HEAD is reported independently from per-file drift.

## Current MVP boundary

Implemented v1 targets Git repositories with Node.js/TypeScript/JavaScript fingerprinting and validation discovery. It supports text-based code and non-code delegation. Semantic context selection remains the host agent's responsibility: v0.1 embeds explicit selected files and does not automatically expand dependency graphs or index the whole repository. Safe import requires Git worktree support. Project-specific `.agent-task-bridge` configuration overrides are not implemented in v0.1; the shipped safety limits are deterministic defaults. The MVP does not provide automated ChatGPT transport, OpenAI/Anthropic API calls, binary payloads, hosted telemetry, cloud storage, or automatic application to the active branch.

## Development and verification

- `npm test` — automated unit/integration/end-to-end tests.
- `npm run bundle:plugins` — regenerate the self-contained Claude/Codex runtime copies.
- `npm run smoke` — fresh-repository bidirectional provider smoke test (Claude bundle → ChatGPT result → Codex bundle, then the reverse).
- `npm pack --dry-run` — inspect release package contents.

The architecture specification is in `docs/architecture.md`; the implementation plan is under `docs/superpowers/plans/`.

## License

MIT. See `LICENSE`.
