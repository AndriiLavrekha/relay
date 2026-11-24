<div align="center">

# Agent Task Bridge

### Delegate bounded repository tasks to ChatGPT. Validate locally before anything touches your branch.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue?style=for-the-badge)](#license)
[![Node.js](https://img.shields.io/badge/node.js-%3E%3D22-339933?style=for-the-badge&logo=node.js&logoColor=white)](#requirements)
[![Plugins](https://img.shields.io/badge/plugins-Claude%20Code%20%C2%B7%20Codex%20%C2%B7%20Gemini-8A2BE2?style=for-the-badge)](#install)

Local-first delegation for **Claude Code**, **OpenAI Codex**, and **Gemini** (Gemini CLI & Antigravity). Export a self-contained Task Capsule, run it in ChatGPT, and import the Result Capsule into an isolated Git worktree with drift checks and local validation.

[Install](#install) · [5-Step Workflow](#the-5-step-workflow) · [Safety & Security](#what-it-protects) · [CLI & Configuration](#cli--configuration) · [Docs](#documentation)

</div>

---

## How it works at a glance

Your coding agent already knows the codebase, but delegating a self-contained module or test suite shouldn't require uploading your whole repo or trusting unverified model output.

```text
  Local Agent (Claude Code / Codex / Gemini)
      │
      ├─ 1. plan-chatgpt     Split feature along clean module seams
      ├─ 2. export-chatgpt   Package one bounded Task Capsule (task.md + kickoff.md)
      ▼
  ChatGPT (Web)
      │
      ├─ 3. Execute task     Returns Result Capsule (.zip via pack_result.py, or reply.md)
      ▼
  Local Bridge (Isolated External Staging Worktree)
      │
      ├─ 4. import-chatgpt   Verify hashes, detect drift, 3-way merge, run local tests
      └─ 5. integrate        Commit to a branch (--confirm) after review passes
```

Because task state lives in the capsule and local `.agent-task-bridge/` history, you can even export from one agent and import in another (for example, `Gemini → ChatGPT → Claude Code` or `Codex → ChatGPT → Gemini`).

---

## Install

> **Note:** `AndriiLavrekha/relay` is private. Make sure your Git credentials are configured (`gh auth login` or a Git credential helper) before installing. Requires **Node.js >= 22** and **Git** (zero third-party npm dependencies; no API keys required).

| Host Agent | Install Command | Skills / Commands |
| --- | --- | --- |
| **Claude Code** | [Install plugin](#1-claude-code) | `/task-bridge:plan-chatgpt`<br>`/task-bridge:export-chatgpt`<br>`/task-bridge:import-chatgpt` |
| **OpenAI Codex** | [Install plugin](#2-openai-codex) | Ask Codex to use `plan-chatgpt`, `export-chatgpt`, or `import-chatgpt` |
| **Gemini CLI** | [Install extension](#3-gemini-gemini-cli--antigravity) | `/plan-chatgpt`<br>`/export-chatgpt`<br>`/import-chatgpt` |
| **Antigravity (`agy`)** | [Install plugin](#3-gemini-gemini-cli--antigravity) | `/plan-chatgpt`<br>`/export-chatgpt`<br>`/import-chatgpt` |
| **Standalone CLI** | Clone repository | `node bin/agent-task-bridge.mjs help` |

### 1. Claude Code

In Claude Code:

```text
/plugin marketplace add AndriiLavrekha/relay@v0.3.5
/plugin install task-bridge@awesome-task-bridge
```

Or from your terminal:

```bash
claude plugin marketplace add AndriiLavrekha/relay@v0.3.5
claude plugin install task-bridge@awesome-task-bridge
```

Start a new session or run `/reload-plugins`. See [`plugins/claude-code/README.md`](plugins/claude-code/README.md).

### 2. OpenAI Codex

Pin the `v0.3.5` release from GitHub:

```bash
codex plugin marketplace add AndriiLavrekha/relay --ref v0.3.5
codex plugin add task-bridge@awesome-task-bridge
```

Or install from a local checkout:

```bash
codex plugin marketplace add /absolute/path/to/relay
codex plugin add task-bridge@awesome-task-bridge
```

Start a new Codex session after installation. See [`plugins/codex/README.md`](plugins/codex/README.md).

### 3. Gemini (Gemini CLI & Antigravity)

**Gemini CLI:**

```bash
gemini extensions install https://github.com/AndriiLavrekha/relay --ref v0.3.5
# Or link a local checkout:
gemini extensions link /absolute/path/to/relay
```

**Antigravity CLI / IDE (`agy`):**

```bash
agy plugin install https://github.com/AndriiLavrekha/relay/tree/v0.3.5/plugins/gemini
# Or install from a local checkout:
agy plugin install /absolute/path/to/relay/plugins/gemini
```

*(Opening a checkout of this repo in Antigravity also auto-discovers `plugins/gemini` via `.agents/plugins.json`.)* Start a new session after installing. See [`plugins/gemini/README.md`](plugins/gemini/README.md).

<details>
<summary><strong>Upgrading to v0.3.5</strong></summary>

**Claude Code**
```bash
claude plugin marketplace remove awesome-task-bridge
claude plugin marketplace add AndriiLavrekha/relay@v0.3.5
claude plugin update task-bridge@awesome-task-bridge
claude plugin list
```

**OpenAI Codex** (`codex plugin marketplace upgrade` only refreshes the current ref; re-add the marketplace to move to a new release tag)
```bash
codex plugin remove task-bridge@awesome-task-bridge
codex plugin marketplace remove awesome-task-bridge
codex plugin marketplace add AndriiLavrekha/relay --ref v0.3.5
codex plugin add task-bridge@awesome-task-bridge
codex plugin list
```

**Gemini CLI & Antigravity**
```bash
# Gemini CLI
gemini extensions update task-bridge

# Antigravity CLI
agy plugin uninstall task-bridge
agy plugin install https://github.com/AndriiLavrekha/relay/tree/v0.3.5/plugins/gemini
```

Restart your agent session after upgrading. Latest release notes: [`v0.3.5`](docs/releases/v0.3.5.md).

</details>

---

## The 5-step workflow

Delegation pays off when ChatGPT writes a bounded implementation and its tests while your local agent spends tokens only on planning, seam creation, and review.

### Step 1: Plan and split along clean seams

Ask your local agent to decompose the feature before exporting anything:

```text
/plan-chatgpt I want to build <feature>. Split it into units along clean seams.
Tell me which units to delegate to ChatGPT vs. keep local, draft the delegation scope
and file roles, and propose the seam commit first. Don't export yet.
```
*(In Claude Code use `/task-bridge:plan-chatgpt`; in Codex ask in plain words to use `plan-chatgpt`.)*

- **Good to delegate:** Self-contained modules behind an interface, parsers, algorithms, isolated test suites, or file migrations.
- **Keep local (host-owned):** Cross-cutting registration, dependency injection, routing, configuration, and edits spread across many files.

### Step 2: Commit the interface seam locally

Have your local agent add the interface, types, and minimal stub where the feature connects, then commit. ChatGPT now implements against a committed contract in `HEAD`, and import validation runs cleanly on top of it.

### Step 3: Export one bounded unit

```text
/task-bridge:export-chatgpt
Unit: implement CSV export in src/reports/csv/ behind the ReportExporter interface.
- Editable: src/reports/csv/**, test/reports/csv/**
- Contract: src/reports/exporter.ts, src/reports/types.ts
- Reference: src/reports/pdf/ (copy conventions) and one existing test
- Acceptance: RFC 4180 quoting; header row from column labels; tests for empty, quotes/newlines, unicode
- Non-goals: no UI wiring, no new dependencies
- Host-owned: full workspace test run; wiring into ReportController
```

The bridge classifies embedded files by role and checks for coverage gaps (`CONTEXT_COVERAGE_GAP` / `EDITABLE_OUTSIDE_SCOPE`) and sensitive data before writing `.agent-task-bridge/tasks/<task-id>/`:

| File Role | Purpose in the Task Capsule |
| --- | --- |
| `editable` | Files ChatGPT may modify (new files are allowed under `editable_scope` globs). |
| `contract` | Interfaces, types, and state shapes ChatGPT must call or implement without changing signatures. |
| `reference` | One neighboring implementation and one existing test whose conventions ChatGPT should match. |
| `validation` / `configuration` | Build, test, and strictness settings (`package.json`, `tsconfig.json`). |

### Step 4: Run in ChatGPT

1. Open a fresh ChatGPT conversation.
2. Upload `.agent-task-bridge/tasks/<task-id>/task.md`.
3. Paste `kickoff.md` as the prompt.

- **With Python sandbox (e.g. ChatGPT Plus):** ChatGPT runs the capsule's embedded `pack_result.py` and gives you a downloadable `result.zip` with precomputed SHA-256 hashes, task ID, and base commit.
- **Without code execution (e.g. ChatGPT Go):** ChatGPT replies using the capsule's `<<<ATB_RESULT:...>>>` text framing. Click ChatGPT's **Copy** button and save the reply as `reply.md` (the importer automatically unescapes Markdown-escaped marker lines and builds the ZIP locally).

### Step 5: Import, review, and integrate

```text
/task-bridge:import-chatgpt <path-to-result.zip-or-reply.md>
```
*(Or `/import-chatgpt` in Gemini, or ask Codex to import the file.)*

What happens during import:
1. **Active worktree stays untouched** (`activeWorktreeModifiedByImport: false`).
2. **Drift & elision checks:** Unchanged baseline files (`CLEAN_UNCHANGED`), expected new files (`NEW_EXPECTED`), and non-overlapping local edits (`MERGED_CLEAN` via 3-way merge) are staged into an isolated external Git worktree. Abbreviated files (`// ... rest unchanged` or large unexplained shrink) are withheld as `SUSPECT_ELISION`.
3. **Authoritative local validation:** Runs discovered or configured tests in the staging worktree with a scrubbed environment, timeouts, and linked dependencies (`node_modules`, `vendor`, `.venv`, `venv`).
4. **Compact review (`--brief`):** Compares worker claims (`REPORT.md`) against local validation evidence and acceptance criteria (`verified`, `deferred_to_host`, or unresolved).

When satisfied, commit the staged files to a branch or follow up on unresolved criteria:

```bash
# Commit staged changes onto a new branch
node bin/agent-task-bridge.mjs integrate <import-id> --repo . --mode branch --branch feat/csv-export --confirm

# Or generate a follow-up Task Capsule for unresolved worker-owned criteria
node bin/agent-task-bridge.mjs follow-up <import-id> --repo .
```

<details>
<summary><strong>More examples (Research tasks, Security reviews, Direct CLI JSON)</strong></summary>

#### Brainstorming or architecture research (`work_type: "research"`)
Set `editable_scope: []` and include reference files. ChatGPT returns a report-only Result Capsule (`status: "research-only"`) with findings and trade-offs in `REPORT.md` and zero staged files.

#### Security or documentation review (`work_type: "documentation"` or `"research"`)
Scope `editable_scope` strictly to documentation paths (e.g. `["docs/security.md"]`) while passing implementation files under `reference` and specs under `contract`.

#### Direct CLI delegation JSON shape
Provider skills generate this JSON automatically, or you can pass `--delegation delegation.json` to the CLI directly:

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

See [`examples/delegation.example.json`](examples/delegation.example.json).

</details>

<details>
<summary><strong>Experimental: Browser automation in Claude Code (<code>/task-bridge:delegate-chatgpt-browser</code>)</strong></summary>

> [!CAUTION]
> **Experimental and risky (Claude Code only).** `/task-bridge:delegate-chatgpt-browser` drives your logged-in Chrome via the Claude in Chrome extension to upload `task.md`, send `kickoff.md`, copy the reply, and run `import`. OpenAI's Terms of Use restrict automatically or programmatically extracting data or Output from its services, so this may violate them and risk account warnings or restrictions. It is off by default, runs only when explicitly invoked by command, requires an explicit `yes` on every run, never touches credentials, and stops immediately on login screens, CAPTCHAs, or usage limits. The supported path for all providers is the manual 5-step flow above.

When manually saving a copied reply from the Windows clipboard in PowerShell, write UTF-8 explicitly (`[IO.File]::WriteAllText(...)`); redirecting with `>` can corrupt non-ASCII characters.

</details>

---

## What it protects

| Boundary | How Agent Task Bridge enforces it |
| --- | --- |
| **Bounded context & token budget** | Exports only host-selected files. `--max-tokens <n>` enforces a full-capsule token estimate (including wrapper bytes and safety margin; estimate, not billing data). |
| **Privacy & secret scanning** | Scans selected files, delegation metadata, validation commands, and the rendered Task Capsule (`block`, `confirmation` warning, `allow`, or metadata-only `redact`). Scans returned files and `REPORT.md` before staging. |
| **Archive & path safety** | Rejects path traversal, reserved Git/bridge paths, symlinks, duplicate entries, encryption, unsupported compression, CRC corruption, and oversize payloads. |
| **Schema 1.1 payload integrity** | Verifies raw ZIP entry `sha256` and `size_bytes` before decoding any returned file. |
| **Drift & elision protection** | Three-way merges clean local edits (`MERGED_CLEAN`), quarantines out-of-scope files (`OUT_OF_SCOPE`), and withholds abbreviated files (`SUSPECT_ELISION`). |
| **Validation trust boundary** | Captures validation commands *before* staging returned files and blocks validation if returned files modify package-manager configuration. Runs in an external staging worktree (with same-volume fallback on Windows). |
| **Evidence separation & receipts** | Separates untrusted worker claims (tests, model, tokens, status) from deterministic local validation evidence, and writes an immutable receipt per import. |
| **Explicit integration** | `import` never modifies your active worktree. Changes land only when you run `integrate <import-id> --confirm`. |

*Note: Automated API/browser transport and OS-level validation sandboxing remain outside the default runtime boundary.*

---

## CLI & configuration

Run directly from a checkout (or run `npm link` to expose `agent-task-bridge` on your `PATH`):

```bash
node bin/agent-task-bridge.mjs help
node bin/agent-task-bridge.mjs export --delegation delegation.json --repo . --source-agent gemini --max-tokens 50000
node bin/agent-task-bridge.mjs inspect-task <task.md>
node bin/agent-task-bridge.mjs inspect-result <result.zip>
node bin/agent-task-bridge.mjs import <result.zip|reply.md> --repo . --brief
node bin/agent-task-bridge.mjs review <import-id> --repo . --brief
node bin/agent-task-bridge.mjs follow-up <import-id> --repo .
node bin/agent-task-bridge.mjs integrate <import-id> --repo . --mode branch --branch <name> --confirm
node bin/agent-task-bridge.mjs validate --dir <staging-or-project-dir>
node bin/agent-task-bridge.mjs status --repo .
node bin/agent-task-bridge.mjs metrics --repo .
node bin/agent-task-bridge.mjs metrics note <task-id> --claude-estimate <usd>
```

### Repo-local defaults (`.agent-task-bridge/config.json`)

You can configure optional repo-local defaults in `.agent-task-bridge/config.json` (automatically git-excluded). CLI flags always override this file, and security/privacy limits cannot be weakened. See [`examples/project-config.example.json`](examples/project-config.example.json).

- `maxTokens`: Default token ceiling when `--max-tokens` is omitted.
- `validationPolicy`: `"safe"` (default), `"prompt"`, or `"skip"`.
- `extraHostOwnedSteps`: Appended when the delegation omits `host_owned_steps`.
- `validationCommands`: `[{ "name", "command", "args" }]`. Replaces auto-discovery (which covers Node npm/pnpm/yarn/bun, Rust `cargo test`, Go `go test ./...`, .NET `dotnet test`, CMake + CTest, Python `pytest`, and PHP Composer/PHPUnit).
- `validationTimeoutMs`: Per-command timeout in ms (default `120000`).
- `metricsRates`: `{ "<model>": { "input", "output", "cacheWrite5m", "cacheWrite1h", "cacheRead" } }` in USD per million tokens, for `metrics` cost on models other than the built-in Sonnet 5.5 price.

### Usage metrics (what delegating actually cost Claude)

`metrics` reports, per delegated task, the Claude tokens and list-price cost spent in three phases: `prep` (the export skill reading the repo and bounding the task, until the exporter runs), `export` (the exporter run and hand-off) and `import` (import, review, follow-up and integrate), plus capsule size, validation result and your ChatGPT wait time. It reads Claude Code session transcripts, joins them to tasks by task id, and keeps an append-only ledger at `.agent-task-bridge/metrics.jsonl` so numbers survive transcript pruning. The Claude Code plugin's Stop hook updates the ledger after every turn; `metrics` also rescans the project's transcripts when you run it. Only ids, timestamps and token counts are stored, nothing leaves your machine, and the command makes no model calls.

The tool cannot know what Claude would have spent doing the task itself. Record your own estimate with `metrics note <task-id> --claude-estimate <usd>` to get a saving percentage per task. ChatGPT time and cost are not included. Only Claude Code transcripts are read; Codex and Gemini sessions are not measured.

---

## Documentation

| Resource | Description |
| --- | --- |
| [`docs/architecture.md`](docs/architecture.md) | System architecture, lifecycle state machine, and component boundaries |
| [`protocol/TASK-CAPSULE-v1.md`](protocol/TASK-CAPSULE-v1.md) | Task Capsule v1 (schema 1.1) specification |
| [`protocol/RESULT-CAPSULE-v1.md`](protocol/RESULT-CAPSULE-v1.md) | Result Capsule v1 (schema 1.1) specification |
| [`plugins/claude-code/README.md`](plugins/claude-code/README.md) | Claude Code plugin setup and skills |
| [`plugins/codex/README.md`](plugins/codex/README.md) | OpenAI Codex plugin and local marketplace setup |
| [`plugins/gemini/README.md`](plugins/gemini/README.md) | Gemini CLI extension and Antigravity plugin setup |
| [`examples/`](examples/) | Example `delegation.example.json` and `project-config.example.json` |
| [`docs/releases/`](docs/releases/) | Release notes ([`v0.2.0`](docs/releases/v0.2.0.md) to [`v0.3.5`](docs/releases/v0.3.5.md)) |
| [`AGENTS.md`](AGENTS.md) | Repository structure and contributor guidelines |

## Requirements & development

Requires **Node.js >= 22** and **Git**:

```bash
npm test                 # Run the node:test suite
npm run bundle:plugins   # Sync self-contained Claude, Codex, and Gemini runtime bundles
npm run smoke            # Run cross-provider end-to-end smoke tests
npm pack --dry-run       # Verify package contents
```

## License

MIT. See [`LICENSE`](LICENSE).
