<div align="center">

# Agent Task Bridge

### Delegate one bounded unit of repository work to ChatGPT — locally, safely, and reviewably.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](#license)
[![Node.js](https://img.shields.io/badge/node.js-%3E%3D22-339933?style=for-the-badge&logo=node.js&logoColor=white)](#requirements)
[![Plugins](https://img.shields.io/badge/plugins-Claude%20Code%20%C2%B7%20Codex-8A2BE2?style=for-the-badge)](#quick-start)

Local-first delegation for Claude Code and OpenAI Codex. The bridge exports a small Task Capsule, treats the returned Result Capsule as untrusted input, detects repository drift, stages clean changes in an isolated worktree, and runs validation locally before anything reaches your active branch.

[Quick start](#quick-start) · [Install](#quick-start) · [Upgrade](#upgrade) · [How it works](#how-it-works) · [Security](#security-model)

</div>

---

## Why Agent Task Bridge?

Coding agents are good at understanding the current task, but they should not need to upload an entire repository or share a conversation database to delegate one focused unit of work.

Agent Task Bridge keeps the handoff local and explicit:

```text
Coding agent
    │  export one bounded task
    ▼
Task Capsule (.md) ── upload to ChatGPT ──► Result Capsule (.zip)
    ▲                                           │
    └──── local drift checks, staging, validation, review
```

The host agent chooses the context. The bridge records repository truth, verifies the return package, and leaves integration into the active branch as a separate decision.

## Quick start

Choose the path that matches your agent:

| I use… | Install | Then… |
| --- | --- | --- |
| Claude Code | [`task-bridge` Claude plugin](#install-the-claude-code-plugin) | Invoke `/task-bridge:export-chatgpt` |
| Codex | [`task-bridge` Codex plugin](#install-the-codex-plugin) | Ask Codex to export a bounded task |
| Any local checkout | Clone or open this repository | Run `node bin/agent-task-bridge.mjs help` |

### Install the Claude Code plugin

From Claude Code, add the public `v0.2.0` marketplace release and install the plugin:

```text
/plugin marketplace add AndriiLavrekha/task-bridge@v0.2.0
/plugin install task-bridge@awesome-task-bridge
```

Or use the CLI:

```bash
claude plugin marketplace add AndriiLavrekha/task-bridge@v0.2.0
claude plugin install task-bridge@awesome-task-bridge
```

After installation, start a new session or run `/reload-plugins` if Claude asks. The plugin provides namespaced skills:

- `/task-bridge:export-chatgpt` creates a Task Capsule.
- `/task-bridge:import-chatgpt` validates and stages a returned Result Capsule.

### Install the Codex plugin

From a checkout of this repository, add its local marketplace:

```bash
codex plugin marketplace add /absolute/path/to/agent-task-bridge
codex plugin add task-bridge@awesome-task-bridge
```

For the public GitHub marketplace, pin the v0.2.0 release with `--ref v0.2.0`:

```bash
codex plugin marketplace add AndriiLavrekha/task-bridge --ref v0.2.0
codex plugin add task-bridge@awesome-task-bridge
```

Start a new Codex session after installation so the plugin and skills reload. See [`plugins/codex/README.md`](plugins/codex/README.md) for workspace-local marketplace details. Release notes: [`v0.2.0`](https://github.com/AndriiLavrekha/task-bridge/releases/tag/v0.2.0).

## Upgrade

Use the command path that matches your installation:

<details>
<summary><strong>Claude Code</strong></summary>

```bash
claude plugin marketplace update awesome-task-bridge
claude plugin update task-bridge@awesome-task-bridge
claude plugin list
```

Restart Claude Code or reload plugins after the update.

</details>

<details>
<summary><strong>Codex</strong></summary>

```bash
codex plugin marketplace upgrade
codex plugin add task-bridge@awesome-task-bridge
codex plugin list
```

Start a new Codex session after the update. If prompted, review and trust the updated plugin hooks.

</details>

## How it works

1. Work normally in Claude Code or Codex.
2. Invoke the provider's export skill and specify one bounded unit of work.
3. The bridge writes one Task Capsule Markdown file under the repository task history and generates a kickoff prompt, upload checklist, result contract, and token/file summary beside it. An explicit `--out` path may still be used for a copy.
4. Upload that file to a fresh ChatGPT conversation and ask for Result Capsule v1 as a ZIP.
5. Invoke the provider's import skill with the downloaded ZIP.
6. The bridge validates the archive, task ID, source baseline, paths, scope, and repository drift.
7. Clean candidates are applied only to an isolated, external staging worktree; conflicts and out-of-scope files are withheld for review.
8. Supported Node project scripts run locally in staging with a scrubbed environment, bounded output, timeouts, and policy-controlled execution.
9. The coding agent reviews the diff, lifecycle, receipt, drift, validation, privacy, and acceptance evidence before choosing whether to integrate it.
10. Use `review <import-id>` for the persisted review, `follow-up <import-id>` for unresolved work, and `integrate <import-id> --confirm` for the separate integration boundary.

The same protocol supports Claude Code → ChatGPT → Codex and Codex → ChatGPT → Claude Code because essential state lives in the Task Capsule and local task history, not in a provider's conversation database. A result status (`complete`, `partial`, `blocked`, or `research-only`) is orthogonal to lifecycle staging: safe in-scope files from partial results may still be staged and reviewed, while follow-up work records the unresolved criteria.

## Usage examples

Every delegation follows the same handoff:

```text
1. Describe one bounded task to Claude Code or Codex.
2. The provider creates a temporary delegation JSON request.
3. Agent Task Bridge exports one Task Capsule Markdown file.
4. Upload that single .md file to a fresh ChatGPT conversation.
5. Ask ChatGPT to return one Result Capsule v1 .zip file.
6. Give the ZIP to the provider's import skill.
7. Review the isolated staging report and diff before integrating anything. The bridge stores an immutable receipt containing the Task Capsule hash, Result Capsule hash, baseline, import ID, and local validation evidence.
```

The provider skills create the delegation JSON for you. If you use the CLI directly, the minimum shape looks like this:

```json
{
  "objective": "Improve retry handling in the HTTP client",
  "work_unit": "Add bounded exponential backoff for retryable 503 responses",
  "work_type": "code",
  "title": "Add HTTP retry backoff",
  "current_work_state": "The client currently retries immediately.",
  "deliverables": ["Updated implementation", "Focused tests", "Short validation report"],
  "editable_scope": ["src/http-client.mjs", "test/http-client.test.mjs"],
  "acceptance_criteria": ["Only the listed files change", "Existing tests pass"],
  "non_goals": ["Do not change the public API", "Do not add dependencies"],
  "architecture_context": "The project uses native ESM and Node.js 22.",
  "files": {
    "editable": ["src/http-client.mjs", "test/http-client.test.mjs"],
    "reference": [],
    "contract": [],
    "validation": ["package.json"],
    "configuration": []
  }
}
```

Export the request from the repository root:

```bash
node bin/agent-task-bridge.mjs export \
  --delegation delegation.json \
  --repo . \
  --source-agent codex \
  --max-tokens 50000 \
  --out .agent-task-bridge/exports/retry-backoff.task.md
```

Inspect the capsule before uploading it:

```bash
node bin/agent-task-bridge.mjs inspect-task \
  .agent-task-bridge/exports/retry-backoff.task.md
```

In ChatGPT, upload only the generated `.task.md` file and use a prompt like this:

```text
Execute the attached Agent Task Bridge Task Capsule v1.
Stay within its editable scope and acceptance criteria.
Return a Result Capsule v1 ZIP containing the complete changed files,
manifest.json, and a concise REPORT.md. Do not return a patch or partial files.
```

When the ZIP is back, inspect and import it without manually extracting it:

```bash
node bin/agent-task-bridge.mjs inspect-result result.zip
node bin/agent-task-bridge.mjs import result.zip --repo . --json

# inspect the persisted review and integrate only after explicit confirmation
node bin/agent-task-bridge.mjs review <import-id> --repo .
node bin/agent-task-bridge.mjs integrate <import-id> --repo . --mode branch --branch bridge/retry-backoff --confirm
```

Check the task ID, source baseline, drift status, withheld files, validation results, staging path, and `activeWorktreeModifiedByImport` before reviewing the staged diff.

### 1. Brainstorm a feature or compare implementation options

Use `work_type: "research"` when you want ChatGPT to investigate, compare approaches, or produce a design report without changing repository files.

Provider prompt:

```text
Claude Code: /task-bridge:export-chatgpt
Argument: Compare SQLite, JSON, and in-memory storage for task history.
Return a recommendation with trade-offs and a migration outline. Do not edit files.
```

Equivalent Codex request:

```text
Use the task-bridge export skill to delegate this bounded research task to ChatGPT:
compare SQLite, JSON, and in-memory storage for task history. Return a report only;
do not change repository files.
```

Use a report-only delegation scope:

```json
{
  "work_type": "research",
  "title": "Compare task-history storage options",
  "work_unit": "Compare SQLite, JSON, and in-memory storage and recommend one.",
  "editable_scope": [],
  "deliverables": ["Recommendation", "Trade-off table", "Migration outline"],
  "non_goals": ["Do not edit source files or configuration"],
  "files": {
    "editable": [],
    "reference": ["src/storage.mjs", "docs/architecture.md"],
    "contract": [],
    "validation": [],
    "configuration": ["package.json"]
  }
}
```

Ask ChatGPT to return a report-only Result Capsule:

```text
Analyze the attached Task Capsule and return a report-only Result Capsule v1 ZIP.
Do not include changed repository files. Put the recommendation and trade-offs in REPORT.md.
```

Import and review the report:

```bash
node bin/agent-task-bridge.mjs import storage-research.zip --repo . --json
```

Expected result: a report is available for review, no source files are staged, and the active worktree remains unchanged.

### 2. Implement a bounded coding unit

Use `work_type: "code"` when ChatGPT should edit specific files and return complete replacements.

Provider prompt:

```text
Claude Code: /task-bridge:export-chatgpt
Argument: Add retry handling in src/retry.mjs and tests in test/retry.test.mjs.
Retry only HTTP 429 and 503 responses, use bounded exponential backoff,
and do not change the public CLI or add dependencies.
```

Equivalent Codex request:

```text
Use the task-bridge export skill for this bounded coding task:
implement retry handling in src/retry.mjs and test/retry.test.mjs.
Only retry HTTP 429 and 503, add deterministic tests, and do not touch other files.
```

In ChatGPT:

```text
Execute the attached coding Task Capsule v1.
Implement only the requested files, run the declared validation commands,
and return a Result Capsule v1 ZIP with complete files, manifest.json, and REPORT.md.
```

Back in the provider, inspect and import the staged result:

```bash
node bin/agent-task-bridge.mjs inspect-result retry-backoff-result.zip
node bin/agent-task-bridge.mjs import retry-backoff-result.zip --repo . --json
node bin/agent-task-bridge.mjs status --repo .
```

Expected result: clean files are staged in an isolated worktree, validation evidence is shown, conflicts are withheld, and the active worktree is not modified. Review the staged diff and explicitly integrate it only after it meets the acceptance criteria.

### 3. Review security or update documentation

Use `work_type: "documentation"` or `work_type: "research"` for a focused review that returns findings or narrowly scoped documentation edits.

Security review prompt:

```text
Use the task-bridge export skill to ask ChatGPT to review src/importer.mjs
for archive-path, symlink, and drift-handling risks. Return a prioritized report
with file/line references and suggested tests. Do not edit implementation files.
```

For documentation changes, make the editable scope explicit:

```json
{
  "objective": "Document the verified Result Capsule import trust boundary",
  "work_type": "documentation",
  "title": "Clarify Result Capsule import safety",
  "work_unit": "Update docs/security.md with the verified import trust boundary.",
  "current_work_state": "Import validation and staging behavior are implemented; the documentation needs a concise user-facing explanation.",
  "editable_scope": ["docs/security.md"],
  "deliverables": ["Updated documentation", "Validation report"],
  "acceptance_criteria": ["Describe only implemented behavior", "Keep examples copy-pasteable"],
  "non_goals": ["Do not change source code or protocol behavior"],
  "architecture_context": "Returned ZIP files are untrusted and are validated before acceptable files are staged in an isolated Git worktree.",
  "files": {
    "editable": ["docs/security.md"],
    "reference": ["src/importer.mjs", "src/path-safety.mjs"],
    "contract": ["protocol/RESULT-CAPSULE-v1.md"],
    "validation": [],
    "configuration": []
  }
}
```

Ask ChatGPT to distinguish findings from edits:

```text
Review the attached Task Capsule v1.
If the task is report-only, return REPORT.md without files.
If documentation is in scope, return the complete updated documentation file,
manifest.json, and REPORT.md. Do not modify implementation code.
```

Import the result the same way:

```bash
node bin/agent-task-bridge.mjs import review-or-docs-result.zip --repo . --json
```

Expected result: report-only findings stay out of the worktree; documentation candidates are staged only when they match the declared scope and baseline.

## What it protects

- **Bounded context:** export only the files and intent selected by the host agent.
- **Repository truth:** record the Git baseline and SHA-256 hashes for embedded files.
- **Safe imports:** reject dangerous archive paths, symlinks, duplicate entries, encryption, unsupported compression, CRC corruption, and undeclared payloads.
- **Drift awareness:** withhold locally changed, deleted, conflicting, or out-of-scope files instead of silently overwriting them.
- **Validation trust boundary:** capture validation commands before applying returned files and block validation when package-manager configuration changes in staging.
- **Privacy boundary:** scan the complete rendered Task Capsule, including metadata and validation context, with block, confirmation, allow, and metadata-only redact policies. Returned files and `REPORT.md` are scanned before staging.
- **Protocol integrity:** schema 1.1 Result Capsules declare SHA-256 and byte length for every returned file; the importer verifies the raw ZIP entries before decoding.
- **Evidence boundary:** worker-reported tests, models, token usage, and acceptance claims remain untrusted claims beside local validation and acceptance evidence.
- **Explicit integration:** imports never modify the active working tree directly.

## CLI

Run directly from a checkout:

```bash
node bin/agent-task-bridge.mjs help
node bin/agent-task-bridge.mjs export --delegation examples/delegation.example.json --repo /path/to/repo --source-agent codex
node bin/agent-task-bridge.mjs inspect-task <task.md>
node bin/agent-task-bridge.mjs inspect-result <result.zip>
node bin/agent-task-bridge.mjs import <result.zip> --repo /path/to/repo
node bin/agent-task-bridge.mjs validate --dir <staging-or-project-dir>
node bin/agent-task-bridge.mjs status --repo /path/to/repo
```

To expose the CLI on your `PATH` while developing locally:

```bash
npm link
agent-task-bridge help
```

## Protocol capsules

### Task Capsule v1

A human-readable Markdown file containing protocol metadata, the Git baseline, a project fingerprint, the validation contract, structured delegation, and exact embedded source files with SHA-256 hashes. Source contents are length-framed so Markdown-like text cannot break parsing.

→ [`protocol/TASK-CAPSULE-v1.md`](protocol/TASK-CAPSULE-v1.md)

### Result Capsule v1

A ZIP containing `manifest.json`, an optional `REPORT.md`, and complete created or modified text files under `files/`. The importer validates the archive structure and does not blindly extract it.

→ [`protocol/RESULT-CAPSULE-v1.md`](protocol/RESULT-CAPSULE-v1.md)

## Requirements

- Node.js 22 or newer
- Git
- A Git repository for export/import

There are zero third-party runtime npm dependencies. The bridge does not require an OpenAI API key or an Anthropic API key.

## Security model

Export scans selected files, delegation and project metadata, validation commands, and the complete rendered capsule. High-confidence secrets block export; warning findings such as URLs, absolute paths, and entropy candidates require explicit confirmation. Use `--privacy allow` only when the decision is intentional, and `--max-tokens <n>` to enforce a hard full-capsule estimate (estimates include wrapper bytes, per-file contributions, and safety margin and are not billing data).

Import rejects dangerous archive paths, reserved bridge/Git paths, symlinks, duplicate entries, encryption, unsupported compression, CRC corruption, and bounded-size violations. Returned files outside the original editable scope or through staging symlink ancestors are quarantined rather than staged.

The external worker's code, model, status, tests, token usage, and prose remain untrusted claims. Schema 1.1 result files carry SHA-256 and byte-length declarations that are checked against raw ZIP payloads before decoding. Import reports separate worker claims from deterministic local evidence and acceptance-criteria status; local tests, builds, and validation evidence are authoritative. The active worktree is not modified by import.

## Current MVP boundary

Version 1 targets Git repositories with Node.js, TypeScript, or JavaScript fingerprinting and validation discovery. It supports text-based code and non-code delegation.

The host agent remains responsible for semantic context selection. The MVP does not automatically expand dependency graphs or index the whole repository, provide automated ChatGPT transport, call OpenAI or Anthropic APIs, support binary payloads, offer hosted telemetry or cloud storage, or automatically apply changes to the active branch.

Project-specific `.agent-task-bridge` configuration overrides are not implemented in v0.1; shipped safety limits are deterministic defaults. Safe import requires Git worktree support.

## Documentation

| Document | Purpose |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | Architecture and component boundaries |
| [`examples/delegation.example.json`](examples/delegation.example.json) | Example delegation input |
| [`plugins/claude-code/README.md`](plugins/claude-code/README.md) | Claude Code plugin details |
| [`plugins/codex/README.md`](plugins/codex/README.md) | Codex plugin and local marketplace details |
| [`docs/releases/v0.2.0.md`](docs/releases/v0.2.0.md) | v0.2 reliability release notes |
| [`protocol/`](protocol/) | Task and Result Capsule specifications |
| [`src/`](src/) | Canonical bridge runtime |
| [`AGENTS.md`](AGENTS.md) | Repository structure and contribution conventions |

## Development and verification

Node.js 22 or newer is required:

```bash
npm test
npm run bundle:plugins
npm run smoke
npm pack --dry-run
```

`npm run bundle:plugins` regenerates the self-contained Claude and Codex runtime copies. Keep those generated copies synchronized with `src/` and `bin/` when changing the implementation.

## Contributing

Read [`AGENTS.md`](AGENTS.md) before making changes. Keep pull requests focused, include validation commands and results, and review protocol or plugin changes for accidental data leakage.

## License

MIT. See [`LICENSE`](LICENSE).
