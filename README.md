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

From Claude Code, add the public `v0.1.0` marketplace release and install the plugin:

```text
/plugin marketplace add AndriiLavrekha/task-bridge@v0.1.0
/plugin install task-bridge@awesome-task-bridge
```

Or use the CLI:

```bash
claude plugin marketplace add AndriiLavrekha/task-bridge@v0.1.0
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

For the public GitHub marketplace, pin the first release with `--ref v0.1.0`:

```bash
codex plugin marketplace add AndriiLavrekha/task-bridge --ref v0.1.0
codex plugin add task-bridge@awesome-task-bridge
```

Start a new Codex session after installation so the plugin and skills reload. See [`plugins/codex/README.md`](plugins/codex/README.md) for workspace-local marketplace details. Release notes: [`v0.1.0`](https://github.com/AndriiLavrekha/task-bridge/releases/tag/v0.1.0).

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
3. The bridge writes one Task Capsule Markdown file under `.agent-task-bridge/exports/`.
4. Upload that file to a fresh ChatGPT conversation and ask for Result Capsule v1 as a ZIP.
5. Invoke the provider's import skill with the downloaded ZIP.
6. The bridge validates the archive, task ID, source baseline, paths, scope, and repository drift.
7. Clean candidates are applied only to an isolated Git worktree; conflicts and out-of-scope files are withheld for review.
8. Supported Node project scripts run locally in staging.
9. The coding agent reviews the diff and evidence before choosing whether to integrate it.

The same protocol supports Claude Code → ChatGPT → Codex and Codex → ChatGPT → Claude Code because essential state lives in the Task Capsule and local task history, not in a provider's conversation database.

## What it protects

- **Bounded context:** export only the files and intent selected by the host agent.
- **Repository truth:** record the Git baseline and SHA-256 hashes for embedded files.
- **Safe imports:** reject dangerous archive paths, symlinks, duplicate entries, encryption, unsupported compression, CRC corruption, and undeclared payloads.
- **Drift awareness:** withhold locally changed, deleted, conflicting, or out-of-scope files instead of silently overwriting them.
- **Validation trust boundary:** capture validation commands before applying returned files and block validation when package-manager configuration changes in staging.
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

Export blocks likely secret files or content, Git-ignored selections, paths that traverse repository symlinks, binary files, files over 200 KB, and task context over 2 MB by default.

Import rejects dangerous archive paths, reserved bridge/Git paths, symlinks, duplicate entries, encryption, unsupported compression, CRC corruption, and bounded-size violations. Returned files outside the original editable scope or through staging symlink ancestors are quarantined rather than staged.

The external worker's code and prose remain untrusted. Local tests, builds, and validation evidence are authoritative; the active worktree is not modified by import.

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
| [`docs/releases/v0.1.0.md`](docs/releases/v0.1.0.md) | First release notes |
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
