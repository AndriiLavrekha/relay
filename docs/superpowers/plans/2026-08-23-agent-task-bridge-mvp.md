# Agent Task Bridge MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Build a zero-runtime-dependency Node.js CLI and provider adapters that export a self-contained Task Capsule, safely inspect/import a Result Capsule, detect repository drift, stage changes outside the active worktree, and run local Node-project validation.

**Architecture:** The CLI is the deterministic core. Provider adapters only instruct Claude Code/Codex how to translate session intent into a delegation JSON request and invoke the CLI. Protocol-critical metadata is versioned and machine-readable; source files remain embedded in human-readable Markdown. Import treats returned ZIPs as untrusted, validates paths and manifests, stages only allowed operations, and never mutates the active repository.

**Tech Stack:** Node.js >=22, ESM JavaScript, Node built-in test runner, Git CLI, zero npm runtime dependencies.

**Spec:** `docs/architecture.md`

## Global Constraints

- Protocol version is exactly `1.0` for MVP.
- Git repositories only.
- Node.js / TypeScript / JavaScript repository fingerprinting and validation discovery for MVP.
- Task Capsule is one Markdown file with YAML front matter and explicit source-file delimiters.
- Code Result Capsule is one ZIP containing `manifest.json`, optional `REPORT.md`, and `files/<repo-relative-path>` entries.
- SHA-256 is used for file baselines.
- Imported work is staged outside the active working tree and never auto-applied.
- Likely secret files/content block export.
- Result-controlled paths, symlinks, duplicate entries, unsupported compression, oversized archives, and out-of-scope operations are rejected or quarantined.
- No OpenAI or Anthropic API dependency.
- No third-party runtime npm dependencies.

---

### Task 1: CLI shell, protocol constants, and repository discovery

**Files:**
- Create: `package.json`
- Create: `bin/agent-task-bridge.mjs`
- Create: `src/errors.mjs`
- Create: `src/process.mjs`
- Create: `src/repository.mjs`
- Create: `src/hash.mjs`
- Test: `test/repository.test.mjs`

**Interfaces:**
- Produces: `findGitRoot(startDir)`, `getGitState(repoRoot)`, `sha256Text(text)`, `sha256File(path)`, `runProcess(command,args,options)`.

- [x] Write repository tests for Git-root discovery, branch/HEAD/dirty-state reporting, and SHA-256 stability.
- [x] Run the focused tests and confirm they fail because modules are missing.
- [x] Implement only the process, repository, hash, and CLI version/help scaffolding needed by those tests.
- [x] Run focused and full tests until green.
- [x] Commit the task.

### Task 2: Delegation request validation and Task Capsule protocol

**Files:**
- Create: `src/delegation.mjs`
- Create: `src/yaml.mjs`
- Create: `src/task-capsule.mjs`
- Create: `src/path-safety.mjs`
- Test: `test/task-capsule.test.mjs`

**Interfaces:**
- Consumes: repository/hash helpers from Task 1.
- Produces: `validateDelegationRequest(value)`, `renderTaskCapsule(model)`, `parseTaskCapsule(markdown)`, `normalizeRepoPath(path)`.

- [x] Write failing tests for required delegation fields, YAML-front-matter round trip, embedded delimiter safety, role/hash metadata, and unsafe path rejection.
- [x] Run focused tests and verify expected failures.
- [x] Implement the strict YAML subset, delegation validation, logical path safety, and Task Capsule renderer/parser.
- [x] Run focused and full tests until green.
- [x] Commit the task.

### Task 3: Node fingerprinting, context collection, and secret screening

**Files:**
- Create: `src/fingerprint.mjs`
- Create: `src/secrets.mjs`
- Create: `src/context.mjs`
- Test: `test/context.test.mjs`
- Test: `test/secrets.test.mjs`

**Interfaces:**
- Consumes: `normalizeRepoPath`, repository/hash helpers.
- Produces: `fingerprintProject(repoRoot)`, `scanFileForSecrets(repoRoot,path)`, `collectContext(repoRoot,delegation)`.

- [x] Write failing tests for package-manager/script/runtime fingerprinting, exact file embedding, role assignment, duplicate de-duplication, binary rejection, and secret filename/content blocking.
- [x] Run focused tests and verify expected failures.
- [x] Implement project fingerprinting, context collection, language inference, token estimation, and layered secret screening.
- [x] Run focused and full tests until green.
- [x] Commit the task.

### Task 4: Export command and durable local task history

**Files:**
- Create: `src/exporter.mjs`
- Create: `src/storage.mjs`
- Modify: `bin/agent-task-bridge.mjs`
- Test: `test/exporter.test.mjs`

**Interfaces:**
- Produces: `exportTask({repoRoot, delegationPath, outPath, sourceAgent})`, `loadStoredTask(repoRoot,taskId)`, `listStoredTasks(repoRoot)`.

- [x] Write a failing integration test that exports from a dirty fixture repository and asserts the capsule contains exact uncommitted content, base commit, file hashes, fingerprint, validation contract, and `.git/info/exclude` local storage exclusion.
- [x] Run focused test and verify expected failure.
- [x] Implement task IDs, storage paths, export orchestration, validation-command discovery, and CLI `export`, `inspect-task`, `status` commands.
- [x] Run focused and full tests until green.
- [x] Commit the task.

### Task 5: Safe ZIP reader and Result Capsule inspection

**Files:**
- Create: `src/crc32.mjs`
- Create: `src/zip.mjs`
- Create: `src/result-capsule.mjs`
- Test: `test/zip.test.mjs`
- Test: `test/result-capsule.test.mjs`

**Interfaces:**
- Produces: `readZip(buffer,limits)`, `createZip(entries)` for fixtures/result-builder use, `inspectResultCapsule(path)`.

- [x] Write failing tests for stored/deflated ZIP entries, CRC validation, duplicate paths, traversal/absolute/Windows paths, symlink attributes, unsupported encryption/compression, archive/file-count/expanded-size limits, and manifest/file agreement.
- [x] Run focused tests and verify expected failures.
- [x] Implement minimal ZIP32 reader/writer using Node built-ins only plus Result Capsule structural validation.
- [x] Run focused and full tests until green.
- [x] Commit the task.

### Task 6: Drift classification, isolated staging, and result application

**Files:**
- Create: `src/glob.mjs`
- Create: `src/drift.mjs`
- Create: `src/staging.mjs`
- Create: `src/importer.mjs`
- Test: `test/drift.test.mjs`
- Test: `test/importer.test.mjs`

**Interfaces:**
- Consumes: stored task, Result Capsule inspector, repository/hash/path helpers.
- Produces: `classifyDrift(...)`, `matchesAnyScope(path,patterns)`, `importResult({repoRoot,resultPath})`.

- [x] Write failing tests covering clean unchanged files, locally changed files, expected new files, out-of-scope files, deleted files, base mismatch, and active-worktree non-mutation.
- [x] Run focused tests and verify expected failures.
- [x] Implement glob matching, baseline comparison, isolated Git-worktree staging with active-tree overlay, safe candidate application, and JSON import report persistence.
- [x] Run focused and full tests until green.
- [x] Commit the task.

### Task 7: Node validation engine and human-readable import reports

**Files:**
- Create: `src/validation.mjs`
- Create: `src/reporting.mjs`
- Modify: `src/importer.mjs`
- Modify: `bin/agent-task-bridge.mjs`
- Test: `test/validation.test.mjs`
- Test: `test/e2e.test.mjs`

**Interfaces:**
- Produces: `discoverValidationCommands(repoRoot)`, `runValidation(stagingRoot,commands)`, `formatImportReport(report)`.

- [x] Write failing tests for script discovery/order, pass/fail/skipped command capture, and an E2E export → result ZIP → import → validation workflow.
- [x] Run focused tests and verify expected failures.
- [x] Implement validation command discovery/execution, report formatting, CLI `import`, `inspect-result`, and `validate` commands.
- [x] Run focused and full tests until green.
- [x] Commit the task.

### Task 8: Claude Code/Codex adapters, protocol docs, examples, packaging

**Files:**
- Create: `plugins/claude-code/.claude-plugin/plugin.json`
- Create: `plugins/claude-code/skills/export-chatgpt/SKILL.md`
- Create: `plugins/claude-code/skills/import-chatgpt/SKILL.md`
- Create: `plugins/codex/skills/export-chatgpt/SKILL.md`
- Create: `plugins/codex/skills/import-chatgpt/SKILL.md`
- Create: `plugins/codex/README.md`
- Create: `protocol/TASK-CAPSULE-v1.md`
- Create: `protocol/RESULT-CAPSULE-v1.md`
- Create: `examples/delegation.example.json`
- Create: `README.md`
- Create: `LICENSE`
- Test: `test/plugin-adapters.test.mjs`

**Interfaces:**
- Provider skills invoke the installed `agent-task-bridge` executable; no provider-specific protocol logic.

- [x] Write failing structural tests that assert provider skill packages contain the required workflow instructions and executable invocation contract.
- [x] Run focused tests and verify expected failures.
- [x] Add provider adapters, protocol documentation, installation/use documentation, example delegation input, and package metadata/bin mapping.
- [x] Run focused and full tests until green.
- [x] Commit the task.

### Task 9: Security regression suite and release verification

**Files:**
- Create/modify: `test/security.test.mjs`
- Create: `scripts/smoke-test.mjs`
- Modify documentation only if verification exposes a mismatch.

**Interfaces:**
- `npm test`, `npm run smoke`, and `npm pack --dry-run` are release gates.

- [x] Add regression tests for secret export blocking, malicious ZIP paths, symlinks, duplicate entries, result scope expansion, and no active-worktree mutation.
- [x] Run focused security tests and verify failures before any required fixes.
- [x] Apply only fixes required by the regression tests.
- [x] Run `npm test` fresh and require zero failures.
- [x] Run `npm run smoke` to create a fresh fixture repository and exercise export/import/validation end-to-end.
- [x] Run `npm pack --dry-run` and inspect package contents.
- [x] Re-read `docs/architecture.md` and verify every locked v1 decision against implementation/documentation.
- [x] Commit release-ready state.
