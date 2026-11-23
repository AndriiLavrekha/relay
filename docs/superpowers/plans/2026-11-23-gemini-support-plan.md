# Gemini Support and Task Planning Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class Gemini host-agent support (`plugins/gemini/`, root Gemini CLI extension files, and `.agents/plugins.json`) and a structured `plan-chatgpt` task-breakdown skill across Gemini, Claude Code, and Codex.

**Architecture:** Extend `scripts/bundle-plugins.mjs` to bundle `runtime/` into `plugins/gemini/runtime/` alongside `claude-code` and `codex` and sync `plugins/gemini/skills/` to root `skills/` for top-level Gemini CLI installs. Keep `commands/*.toml` and `gemini-extension.json` at the repo root (so `agy plugin validate --strict plugins/gemini` has 0 warnings while `gemini extensions validate .` and `gemini extensions validate plugins/gemini` pass), scope `.agents/plugins.json` with `include_only: ["gemini"]`, and add `plan-chatgpt` to all three provider skill directories.

**Tech Stack:** Node.js >= 22, native ESM, `node:test`, Gemini CLI (`gemini-extension.json`, `commands/*.toml`), Antigravity CLI/IDE (`.gemini-plugin/plugin.json`, `.agents/plugins.json`).

**Spec:** `docs/superpowers/specs/2026-11-23-gemini-support-design.md`

## Global Constraints

- Zero third-party runtime npm dependencies; Node.js >= 22 native ESM.
- Preserve Task Capsule v1 and Result Capsule v1 (`atb_protocol: "1.0"`, `schema_version: "1.1"`).
- `npm run bundle:plugins` must remain idempotent: it populates `plugins/<provider>/runtime/` for `claude-code`, `codex`, and `gemini`, and syncs `plugins/gemini/skills/` to root `skills/`.
- `agy plugin validate --strict plugins/gemini`, `gemini extensions validate plugins/gemini`, and `gemini extensions validate .` must all pass with 0 errors and 0 warnings.
- `.agents/plugins.json` must use `"include_only": ["gemini"]` so Antigravity does not scan `plugins/claude-code` or `plugins/codex`.
- Do not place `commands/` inside `plugins/gemini/` (Antigravity native plugin validation warns on `commands/`).

## Review Focus

- Root `skills/` drift from `plugins/gemini/skills/`: `npm run bundle:plugins` must overwrite root `skills/` cleanly and `test/plugin-adapters.test.mjs` must assert byte-identical parity for all three skills (`plan-chatgpt`, `export-chatgpt`, `import-chatgpt`).
- Duplicate skill collisions in Antigravity workspace discovery: `.agents/plugins.json` must specify `"include_only": ["gemini"]` and `test/plugin-adapters.test.mjs` must assert that exact filter.
- `agy plugin validate --strict plugins/gemini` failing on unexpected files or missing manifest fields: `plugins/gemini/.gemini-plugin/plugin.json` must include `name`, `version`, `description`, `author`, `repository`, `homepage`, `license`, and `plugins/gemini` must not contain `commands/`.
- CLI path resolution when Gemini skills run from `plugins/gemini` vs. root Gemini CLI extension: all three Gemini skills (`plan-chatgpt`, `export-chatgpt`, `import-chatgpt`) must document checking `<root>/runtime/bin/agent-task-bridge.mjs` first and falling back to `<root>/bin/agent-task-bridge.mjs`.
- Package tariff & release files check: `package.json#files` must include `gemini-extension.json`, `commands`, `skills`, and `docs/superpowers/specs/2026-11-23-gemini-support-design.md` so `npm pack --dry-run` ships them.

---

### Task 1: Cross-Provider `plan-chatgpt` Skill and Gemini Provider Bundle (`plugins/gemini/`)

**Files:**
- Create: `plugins/claude-code/skills/plan-chatgpt/SKILL.md`
- Create: `plugins/codex/skills/plan-chatgpt/SKILL.md`
- Create: `plugins/gemini/.gemini-plugin/plugin.json`
- Create: `plugins/gemini/gemini-extension.json`
- Create: `plugins/gemini/README.md`
- Create: `plugins/gemini/skills/plan-chatgpt/SKILL.md`
- Create: `plugins/gemini/skills/export-chatgpt/SKILL.md`
- Create: `plugins/gemini/skills/import-chatgpt/SKILL.md`
- Test: `test/plugin-adapters.test.mjs`

**Interfaces:**
- Consumes: `package.json` (`version: "0.3.3"`), existing `plugins/claude-code/skills/*/SKILL.md` and `plugins/codex/skills/*/SKILL.md` conventions.
- Produces:
  - `plugins/claude-code/skills/plan-chatgpt/SKILL.md` (with `name: plan-chatgpt`, `argument-hint`, `${CLAUDE_PLUGIN_ROOT}/runtime/bin/agent-task-bridge.mjs`)
  - `plugins/codex/skills/plan-chatgpt/SKILL.md` (with `name: plan-chatgpt`, `<plugin root>/runtime/bin/agent-task-bridge.mjs`)
  - `plugins/gemini/.gemini-plugin/plugin.json` & `plugins/gemini/gemini-extension.json` (`name: "task-bridge"`, `version: "0.3.3"`)
  - `plugins/gemini/skills/{plan-chatgpt,export-chatgpt,import-chatgpt}/SKILL.md` (using `--source-agent gemini` and two-step `<root>/runtime/bin/agent-task-bridge.mjs` / `<root>/bin/agent-task-bridge.mjs` resolution)
  - `plugins/gemini/README.md`

- [ ] **Step 1: Add failing tests in `test/plugin-adapters.test.mjs` for `plan-chatgpt` across providers and `plugins/gemini` manifests/skills/README**

Add assertions in `test/plugin-adapters.test.mjs`:
- In the Claude Code plugin test: iterate `['plan-chatgpt', 'export-chatgpt', 'import-chatgpt']` and assert `plan-chatgpt` includes `editable_scope`, `acceptance_criteria`, `host_owned_steps`, and `seam`.
- In the Codex plugin test: iterate `['plan-chatgpt', 'export-chatgpt', 'import-chatgpt']` and assert `plan-chatgpt` includes `editable_scope`, `acceptance_criteria`, `host_owned_steps`, and `seam`.
- Add test `'Gemini plugin declares Antigravity and Gemini CLI manifests, shared skills, and install docs'`:
  - Assert `plugins/gemini/.gemini-plugin/plugin.json` has `name === 'task-bridge'`, `version === rootPackage.version`, `displayName === 'Agent Task Bridge'`, `category === 'Developer Tools'`, `license === 'MIT'`, non-empty `description`, `author?.name`, `repository`, `homepage`, and `Array.isArray(manifest.keywords)`.
  - Assert `plugins/gemini/commands` does not exist (`ENOENT`) so `agy plugin validate --strict plugins/gemini` stays warning-free.
  - Assert `plugins/gemini/gemini-extension.json` has `name === 'task-bridge'`, `version === rootPackage.version`, and non-empty `description`.
  - For each skill in `['plan-chatgpt', 'export-chatgpt', 'import-chatgpt']`, assert `plugins/gemini/skills/<name>/SKILL.md` matches `name: <name>`, `runtime/bin/agent-task-bridge\.mjs`, and `bin/agent-task-bridge\.mjs`.
  - Assert `plugins/gemini/skills/plan-chatgpt/SKILL.md` matches `editable_scope`, `acceptance_criteria`, `host_owned_steps`, and `seam`.
  - Assert `plugins/gemini/skills/export-chatgpt/SKILL.md` matches `--source-agent gemini`, `editable_scope`, `acceptance_criteria`, `kickoff.md|--max-tokens`, `host_owned_steps`, and `CONTEXT_COVERAGE_GAP`.
  - Assert `plugins/gemini/skills/import-chatgpt/SKILL.md` matches `import`, `active working tree`, `review`, `follow-up`, `integrate.*confirm`, `deferred_to_host`, and `REPORT.md`.
  - Assert `plugins/gemini/README.md` documents both `gemini extensions` and `agy plugin` installation flows.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/plugin-adapters.test.mjs`
Expected: FAIL with `ENOENT` for `plugins/claude-code/skills/plan-chatgpt/SKILL.md` and `plugins/gemini/.gemini-plugin/plugin.json`.

- [ ] **Step 3: Create `plan-chatgpt` skills in `plugins/claude-code` and `plugins/codex`, and create the `plugins/gemini/` manifests, skills, and README**

Create the files specified in Spec Sections 5.1 and 5.2:
- `plugins/claude-code/skills/plan-chatgpt/SKILL.md` (`name: plan-chatgpt`, `argument-hint: "[feature or task to plan and split]"`, references `${CLAUDE_PLUGIN_ROOT}/runtime/bin/agent-task-bridge.mjs`, 5-step seam-first planning workflow with `editable_scope`, `acceptance_criteria`, `host_owned_steps`, and developer confirmation gate before exporting)
- `plugins/codex/skills/plan-chatgpt/SKILL.md` (`name: plan-chatgpt`, references `<plugin root>/runtime/bin/agent-task-bridge.mjs`, same 5-step seam-first planning workflow)
- `plugins/gemini/.gemini-plugin/plugin.json` (all required Antigravity strict manifest fields)
- `plugins/gemini/gemini-extension.json` (`name`, `version`, `description`)
- `plugins/gemini/README.md` (covers `gemini extensions install/link` and `agy plugin install` plus `.agents/plugins.json` workspace discovery)
- `plugins/gemini/skills/plan-chatgpt/SKILL.md` (`name: plan-chatgpt`, two-step `<root>/runtime/bin/agent-task-bridge.mjs` -> `<root>/bin/agent-task-bridge.mjs` CLI resolution, 5-step seam-first planning workflow)
- `plugins/gemini/skills/export-chatgpt/SKILL.md` (`name: export-chatgpt`, two-step CLI resolution from `<root>`, `--source-agent gemini`, `editable_scope`, `acceptance_criteria`, `host_owned_steps`, `kickoff.md`, `--max-tokens`, `CONTEXT_COVERAGE_GAP`, `EDITABLE_OUTSIDE_SCOPE`)
- `plugins/gemini/skills/import-chatgpt/SKILL.md` (`name: import-chatgpt`, two-step CLI resolution from `<root>`, `--brief`, active working tree preservation, drift statuses including `SUSPECT_ELISION` / `MERGED_CLEAN` / `LOCAL_CHANGED`, `review`, `follow-up`, `integrate ... --confirm`, `deferred_to_host`, `REPORT.md`)

- [ ] **Step 4: Run `test/plugin-adapters.test.mjs` to verify the new tests pass**

Run: `node --test test/plugin-adapters.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugins/claude-code/skills/plan-chatgpt/SKILL.md plugins/codex/skills/plan-chatgpt/SKILL.md plugins/gemini test/plugin-adapters.test.mjs
git commit -m "feat: add plan-chatgpt skill and Gemini plugin bundle definitions"
```

---

### Task 2: Root Gemini CLI Extension, Scoped `.agents/plugins.json`, Bundler Sync, and Smoke Tests

**Files:**
- Create: `gemini-extension.json`
- Create: `commands/plan-chatgpt.toml`
- Create: `commands/export-chatgpt.toml`
- Create: `commands/import-chatgpt.toml`
- Create: `.agents/plugins.json`
- Modify: `scripts/bundle-plugins.mjs`
- Modify: `scripts/smoke-test.mjs`
- Modify: `package.json`
- Test: `test/plugin-adapters.test.mjs`

**Interfaces:**
- Consumes: `plugins/gemini/skills/{plan-chatgpt,export-chatgpt,import-chatgpt}/SKILL.md`, `src/`, `bin/`.
- Produces:
  - `plugins/gemini/runtime/` and root `skills/{plan-chatgpt,export-chatgpt,import-chatgpt}/SKILL.md` via `npm run bundle:plugins`
  - Root `gemini-extension.json` and `commands/{plan-chatgpt,export-chatgpt,import-chatgpt}.toml`
  - `.agents/plugins.json` (`{ "entries": [{ "path": "plugins", "include_only": ["gemini"] }] }`)
  - Updated `package.json#files` and `scripts/smoke-test.mjs` covering `'gemini'`

- [ ] **Step 1: Add failing tests in `test/plugin-adapters.test.mjs` for `gemini` runtime bundle, root `skills/` sync, root `gemini-extension.json`, `commands/*.toml`, `.agents/plugins.json`, and `package.json#files`**

Update `test/plugin-adapters.test.mjs`:
- Change `for (const provider of ['claude-code', 'codex'])` at the top of `test/plugin-adapters.test.mjs` to `for (const provider of ['claude-code', 'codex', 'gemini'])`.
- Add assertions that root `gemini-extension.json` matches `plugins/gemini/gemini-extension.json`, `.agents/plugins.json` has `entries: [{ path: 'plugins', include_only: ['gemini'] }]`, root `commands/{plan-chatgpt,export-chatgpt,import-chatgpt}.toml` exist and contain `description =`, `prompt =`, and `{{args}}`, root `skills/<name>/SKILL.md` is byte-identical to `plugins/gemini/skills/<name>/SKILL.md` for `['plan-chatgpt', 'export-chatgpt', 'import-chatgpt']`, and `package.json#files` includes `'gemini-extension.json'`, `'commands'`, `'skills'`, and `'docs/superpowers/specs/2026-11-23-gemini-support-design.md'`.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/plugin-adapters.test.mjs`
Expected: FAIL because `plugins/gemini/runtime` and root `gemini-extension.json` / `commands/` / `skills/` do not exist yet.

- [ ] **Step 3: Implement root Gemini files, `.agents/plugins.json`, `scripts/bundle-plugins.mjs`, `package.json`, and `scripts/smoke-test.mjs`**

1. Create root `gemini-extension.json`, `.agents/plugins.json`, and `commands/{plan-chatgpt,export-chatgpt,import-chatgpt}.toml` per Spec Sections 5.1 and 5.3.
2. Update `scripts/bundle-plugins.mjs` to loop over `['claude-code', 'codex', 'gemini']` and sync `plugins/gemini/skills` to `path.join(root, 'skills')`.
3. Update `package.json` `files` array to include `"gemini-extension.json"`, `"commands"`, `"skills"`, and `"docs/superpowers/specs/2026-11-23-gemini-support-design.md"`.
4. Update `scripts/smoke-test.mjs` to run an additional cross-provider flow with `gemini` (`{ exportProvider: 'gemini', importProvider: 'claude-code', targetValue: 4 }`) and check `['claude-code', 'codex', 'gemini']` in the provider runtime version loop and `providerRuntimes` output.
5. Run `npm run bundle:plugins`.

- [ ] **Step 4: Run tests, smoke test, and CLI plugin validators**

Run: `npm test && npm run smoke && agy plugin validate --strict plugins/gemini && gemini extensions validate plugins/gemini && gemini extensions validate .`
Expected: All tests pass, smoke outputs `"smoke": "PASS"` with `"providerRuntimes": ["claude-code", "codex", "gemini"]`, and all three validator commands pass with 0 errors and 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add gemini-extension.json commands .agents/plugins.json skills plugins/gemini/runtime scripts/bundle-plugins.mjs scripts/smoke-test.mjs package.json docs/superpowers/specs/2026-11-23-gemini-support-design.md test/plugin-adapters.test.mjs
git commit -m "feat: bundle Gemini runtime, sync root extension skills, and add smoke checks"
```

---

### Task 3: Documentation (`README.md` & `docs/architecture.md`) and Final Package Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `test/plugin-adapters.test.mjs`

**Interfaces:**
- Consumes: `plugins/gemini/README.md`, `README.md`, `docs/architecture.md`.
- Produces: Updated user and architecture documentation covering Gemini CLI, Antigravity CLI/IDE, and `plan-chatgpt`.

- [ ] **Step 1: Add failing test assertions in `test/plugin-adapters.test.mjs` for Gemini and `plan-chatgpt` documentation**

In `test/plugin-adapters.test.mjs`:
- Add `'plugins/gemini/README.md'` and `'gemini-extension.json'` to the `required` array in `'protocol, example, license, and user documentation ship with the package'`.
- Assert `README.md` mentions `Gemini`, `plan-chatgpt`, `gemini extensions install`, and `agy plugin install`.
- Assert `docs/architecture.md` mentions `Gemini` alongside Claude Code and Codex.

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test test/plugin-adapters.test.mjs`
Expected: FAIL on `README.md` / `docs/architecture.md` assertions.

- [ ] **Step 3: Update `README.md` and `docs/architecture.md`**

- In `README.md`:
  - Update the plugins badge and intro line to include Gemini (`Claude Code · Codex · Gemini`).
  - Add Gemini CLI and Antigravity rows to the Quick Start table and add an **"Install the Gemini plugin (Gemini CLI & Antigravity)"** section + Upgrade `<details>` block.
  - In **"Delegating a feature" → "1. Plan locally and split along the seams"**, document invoking `plan-chatgpt` (`/task-bridge:plan-chatgpt` in Claude Code, `/plan-chatgpt` in Gemini CLI / Antigravity, or asking for the `plan-chatgpt` skill in Codex/Gemini).
  - Add `plugins/gemini/README.md` to the Documentation table and mention Claude, Codex, and Gemini in Development and verification.
- In `docs/architecture.md`:
  - Update host coding agents and provider layer overview to include the Gemini plugin adapter (`plugins/gemini`) and `plan-chatgpt` skill.

- [ ] **Step 4: Run full verification suite**

Run: `npm run bundle:plugins && npm test && npm run smoke && npm pack --dry-run && agy plugin validate --strict plugins/gemini && gemini extensions validate plugins/gemini && gemini extensions validate .`
Expected: All tests pass, `npm run smoke` passes, `npm pack --dry-run` lists the new files cleanly, and all validators pass with 0 errors and 0 warnings.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-11-23-gemini-support-design.md docs/superpowers/plans/2026-11-23-gemini-support-plan.md README.md docs/architecture.md test/plugin-adapters.test.mjs
git commit -m "docs: document Gemini support and plan-chatgpt workflow"
```
