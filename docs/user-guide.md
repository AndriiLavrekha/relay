# Relay User Guide

This guide walks through day-to-day usage of **Relay** across **Claude Code**, **OpenAI Codex**, **Gemini CLI**, **Antigravity (`agy`)**, and the standalone CLI (`relay`), from planning a feature seam to integrating verified code.

---

## 1. Quickstart by Host Agent

### Claude Code
1. Install from the marketplace:
   ```text
   /plugin marketplace add AndriiLavrekha/relay@v1.0.0
   /plugin install relay@relay
   ```
2. Plan a feature: `/relay:plan-chatgpt <feature description>`
3. Export one bounded unit: `/relay:export-chatgpt <unit description>`
4. Run in ChatGPT (upload `.relay/tasks/<task-id>/task.md` + paste `kickoff.md`).
5. Import and review: `/relay:import-chatgpt <path-to-result.zip-or-reply.md>`

### OpenAI Codex
1. Install from the marketplace:
   ```bash
   codex plugin marketplace add AndriiLavrekha/relay --ref v1.0.0
   codex plugin add relay@relay
   ```
2. Ask Codex in natural language:
   - *"Use plan-chatgpt to split this feature into exportable units."*
   - *"Export this bounded task to ChatGPT."*
   - *"Import this ChatGPT Result Capsule and review it."*

### Gemini CLI & Antigravity (`agy`)
1. Install:
   ```bash
   # Gemini CLI
   gemini extensions install https://github.com/AndriiLavrekha/relay --ref v1.0.0

   # Antigravity CLI
   agy plugin install https://github.com/AndriiLavrekha/relay/tree/v1.0.0/plugins/gemini
   ```
2. Use the slash commands `/plan-chatgpt`, `/export-chatgpt`, and `/import-chatgpt`.

### Standalone CLI
```bash
npm install -g @andriilavrekha/relay
relay help
```

---

## 2. Deciding What to Delegate

Delegation works best when your local coding agent owns architecture and wiring while ChatGPT implements well-bounded modules behind committed interfaces.

### Good candidates for ChatGPT
- Self-contained modules behind an existing interface or type contract
- Parsers, formatters, state machines, and pure algorithms
- Isolated unit/integration test suites for well-defined behavior
- Focused bug fixes where the failing contract and neighbouring tests fit cleanly in one capsule
- Architecture or security reviews (`work_type: "research"` with `editable_scope: []`)

### Keep local (host-owned)
- Cross-cutting registration, dependency injection, routing, and app startup wiring
- Live database migrations, external API calls, or credentials
- Edits scattered across many unrelated files
- Trivial 10-line fixes (Relay's benchmark shows a small fixed orchestration cost per task; save delegation for medium and large units where ChatGPT saves meaningful local tokens)

---

## 3. Preparing Clean Seams & Selecting File Roles

Before exporting, use `plan-chatgpt` to propose a **seam commit**:
1. Add the interface/types and minimal stub locally.
2. Commit that seam to `HEAD`.
3. Export the implementation unit against that committed baseline.

When selecting files for the capsule, assign the right role to each file:

| Role | What to include | Why it matters |
| --- | --- | --- |
| `editable` | Exact files ChatGPT should modify (plus new files under `editable_scope` globs) | Only paths matching `editable_scope` can be staged on import. |
| `contract` | Interfaces, types, state shapes, and exported signatures | Prevents ChatGPT from inventing incompatible types or altering public contracts. |
| `reference` | One neighbouring implementation + one existing test | ChatGPT mirrors local naming, imports, error handling, and test style. |
| `validation` | `package.json`, `Cargo.toml`, `pyproject.toml`, etc. | Documents how the host runs checks. |
| `configuration` | `tsconfig.json` (and any `extends` base), lint/formatter config | Lets ChatGPT perform accurate static self-review (strictness, `noUncheckedIndexedAccess`, module resolution). |

### Context coverage warnings
During export, Relay checks `editable_scope` against tracked and untracked Git files:
- `OMITTED_MATCHING_FILE`: A text file matched `editable_scope` but wasn't embedded. Either include it or tighten `editable_scope`.
- `EDITABLE_OUTSIDE_SCOPE`: A file in `files.editable` does not match `editable_scope`; changes to it would be withheld on import.
- `INTENDED_NEW_FILE` / `NOT_FOUND_IN_REPO`: A literal scope path is missing on disk.

---

## 4. Running the Capsule in ChatGPT

1. Open a **fresh** ChatGPT conversation (so prior chat history does not pollute context).
2. Upload `.relay/tasks/<task-id>/task.md`.
3. Paste the full contents of `.relay/tasks/<task-id>/kickoff.md` and send.

ChatGPT returns results in one of two ways:

- **Option A — `result.zip` (Python sandbox, e.g. ChatGPT Plus):**
  ChatGPT saves the embedded `pack_result.py` script, writes changed/new files under `atb_out/files/`, runs `python pack_result.py --status ...`, and returns a downloadable `.zip`. This automatically computes SHA-256 hashes, task ID, and base commit.
- **Option B — `reply.md` (Text reply, no code execution):**
  ChatGPT replies with `<<<ATB_RESULT:...>>>` framing. Click ChatGPT's **Copy** button and save the text as a UTF-8 `.md` file.
  - **Windows PowerShell tip:** Write UTF-8 explicitly to avoid corrupting non-ASCII characters:
    ```powershell
    [IO.File]::WriteAllText("reply.md", (Get-Clipboard -Raw), (New-Object Text.UTF8Encoding $false))
    ```

---

## 5. Importing, Reviewing & Integrating

Run:
```bash
relay import <path-to-result.zip-or-reply.md> --repo . --brief
```

### Understanding file statuses
| Status | Staged? | Meaning & Action |
| --- | --- | --- |
| `CLEAN_UNCHANGED` | Yes | Baseline file was untouched locally; returned file staged cleanly. |
| `NEW_EXPECTED` | Yes | New file inside `editable_scope` staged cleanly. |
| `MERGED_CLEAN` | Yes | Local edits occurred since export, and `git merge-file` merged cleanly. |
| `LOCAL_CHANGED` | No | Overlapping local edits conflicted; inspect `merge.conflictMarkersPath`. |
| `SUSPECT_ELISION` | No | Returned file contains placeholder comments (`// ...`) or shrank >50% from a >=40-line baseline. Inspect `elision.markers` / `elision.shrink`; pass `--allow-elision` only if it is an intentional rewrite/genuine comment, otherwise use `follow-up`. |
| `OUT_OF_SCOPE` | No | Returned path is outside `editable_scope`. |
| `UNSAFE_SYMLINK_PATH` | No | Path crosses a symlink in staging. |

### Understanding acceptance statuses
- `verified`: Local validation passed and the criterion is backed by staged evidence.
- `deferred_to_host`: Criterion matches `host_owned_steps` (e.g., monorepo build, live DB, git commit/push). Run it locally — **do not** send it back via `follow-up`.
- `unverified` / `unmet` / `blocked`: Worker-owned work is incomplete or validation failed. Use `relay follow-up <import-id> --repo .` to generate a continuation capsule from the current checkout.

### Never integrate before validation passes
When staging validation passes and the diff looks clean:
```bash
relay integrate <import-id> --repo . --mode branch --branch feat/my-unit --confirm
```
This creates the branch from `HEAD`, commits the staged files cleanly, removes the temporary integration worktree, and leaves your active working tree untouched until you merge or switch branches.

---

## 6. Repo-Local Configuration (`.relay/config.json`)

Create `.relay/config.json` (automatically git-excluded) to set per-repo defaults:

```json
{
  "maxTokens": 80000,
  "validationPolicy": "safe",
  "extraHostOwnedSteps": [
    "Release checklist sign-off"
  ],
  "validationCommands": [
    { "name": "unit", "command": "npm", "args": ["run", "test:unit"] }
  ],
  "validationTimeoutMs": 180000,
  "metricsRates": {
    "claude-opus-4": {
      "input": 15,
      "output": 75,
      "cacheWrite5m": 18.75,
      "cacheWrite1h": 30,
      "cacheRead": 1.5
    }
  }
}
```

- **`validationCommands`** replaces automatic discovery (useful in monorepos where workspace symlinks inside `node_modules` point to the active checkout rather than staging).
- **Legacy fallback:** If `.relay/config.json` does not exist yet, Relay reads `.agent-task-bridge/config.json`.

---

## 7. Tracking Cost & Savings (`relay metrics`)

When using the Claude Code plugin, the `Stop` hook updates `.relay/metrics.jsonl` automatically after every turn (IDs, timestamps, and token counts only).

```bash
# View per-task orchestration cost (prep, export, import)
relay metrics --repo .

# Record what you estimate Claude would have cost doing the task directly
relay metrics note <task-id> --claude-estimate 1.50
```

---

## 8. Troubleshooting & FAQ

- **Privacy scan blocked or asked for confirmation (`PRIVACY_SCAN_BLOCKED` / `PRIVACY_CONFIRMATION_REQUIRED`)**
  Relay scans every embedded file, delegation field, and the rendered capsule. High-confidence credentials (`.env`, private keys, API tokens) always block export. Low-confidence warnings (URLs, local paths, entropy candidates) can be confirmed with `--confirm-privacy` after verifying nothing sensitive is included.
- **Validation blocked with `VALIDATION_CONFIG_CHANGED`**
  The returned result modified `package.json`, a lockfile, `pyproject.toml`, etc. Relay refuses to execute validation scripts automatically when package configuration changes. Inspect the diff carefully before integrating or reject the config change.
- **Upgrading from `v0.3.x` (`task-bridge`)**
  Old capsules and stored tasks under `.agent-task-bridge/` remain readable automatically by `relay import`, `relay review`, `relay status`, `relay metrics`, and `relay task show`.
- **Windows symlink tests skipped in `npm test`**
  If Developer Mode / symlink privileges are disabled on Windows, tests that create symlink/reparse fixtures skip cleanly (`0 failed`).
