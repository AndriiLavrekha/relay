# Handoff Show and Check Commands

**Status:** Approved on 2026-09-29

**Date:** 2026-09-29

**Goal:** Give the host one command to find the files to upload and one command to check a downloaded Result Capsule against the stored task before import stages anything.

**Approach:** Add `handoff show` and `handoff check`. They reuse the files export already writes and the ZIP inspector import already uses. They do not upload, download, or stage.

---

## 1. Context

`createHandoffBundle` writes these files under `.agent-task-bridge/tasks/<task-id>/`:

- `task.md`
- `kickoff.md`
- `upload-checklist.md`
- `result-contract.md`
- `summary.json`

The CLI can `inspect-result` a ZIP. That inspection does not load the stored task, so it cannot tell the operator that the ZIP belongs to a different task or a different base commit. Import is the first command that does, and import also stages files.

The manual ChatGPT exchange stays manual. Automatic browser or API transport is out of scope.

## 2. Chosen approach

Two subcommands.

Rejected alternatives:

- Only adding more lines to `upload-checklist.md`. The checklist already exists. The operator still has to locate the paths and still has to start import to learn about a mismatched ZIP.
- Driving the ChatGPT website from the bridge. That is a new transport and a separate design.

## 3. `handoff show <task-id>`

Resolve the Git root from `--repo` or the current directory, using the same `findGitRoot` path as `task show`. Load the stored task with `loadStoredTask` from `src/storage.mjs`, which reads `.agent-task-bridge/tasks/<task-id>/task.md`. Require the five handoff files from section 1. If the task is missing (`TASK_NOT_FOUND`) or any of those five files is missing, exit with `HANDOFF_NOT_FOUND`.

Default output is text:

```text
Task: <task-id>
Capsule: <absolute path of task.md>
Kickoff: <absolute path of kickoff.md>
Checklist: <absolute path of upload-checklist.md>
Contract: <absolute path of result-contract.md>

<contents of kickoff.md>
```

`--json` prints:

```text
{
  "taskId": "<task-id>",
  "capsulePath": "<absolute path>",
  "kickoffPath": "<absolute path>",
  "checklistPath": "<absolute path>",
  "contractPath": "<absolute path>",
  "summaryPath": "<absolute path>",
  "baseCommit": "<manifest.project.base_commit>",
  "kickoff": "<kickoff.md text>"
}
```

`show` does not read the network and does not modify the task.

## 4. `handoff check <result.zip>`

Resolve the Git root. Run the existing `inspectResultCapsule` on the ZIP first. Then load the stored task with `loadStoredTask(root, result.manifest.task_id)`.

`inspectResultCapsule` returns `{ manifest, report, reportFindings, files, entryNames, archive_sha256 }`. `check` reads:

- `taskId` from `manifest.task_id`
- `resultStatus` from `manifest.status` (`legacy` for schema 1.0)
- `fileCount` from `files.length`
- `reportPresent` from `report !== null`
- `sourceBaseCommit` from `manifest.source_base_commit`

Compare:

- A missing stored task (`TASK_NOT_FOUND` from `loadStoredTask`) is `HANDOFF_TASK_NOT_FOUND`.
- `repositoryBaseChanged` is `manifest.source_base_commit !== stored manifest.project.base_commit`. Export writes that stored field from `git.head`. A difference does not throw. `show` returns the stored field as `baseCommit`. `check` does not read the live `git.head` for this flag. Import's report field of the same name compares the live `git.head` with the stored commit, and import still throws `RESULT_BASE_MISMATCH` when the ZIP commit differs.
- Required ZIP shape, status, hashes, and `REPORT.md` size stay the responsibility of `inspectResultCapsule`. Those failures throw the same `AtbError` codes they throw today, including `INVALID_RESULT_CAPSULE`, `INVALID_RESULT_MANIFEST`, `INVALID_OPERATION_PRECONDITION`, `UNSUPPORTED_PROTOCOL`, `UNSUPPORTED_SCHEMA`, `BINARY_RESULT_UNSUPPORTED`, `INVALID_UTF8`, `REPORT_TOO_LARGE`, `RESULT_REPORT_REQUIRED`, and `RESULT_PAYLOAD_INTEGRITY_MISMATCH`.

Do not create a staging worktree. Do not run validation. Do not write an import record. Do not persist `REPORT.md`. Do not require the five handoff files.

Default output is text:

```text
Task: <task-id>
Status: <manifest.status>
Files: <files.length>
REPORT.md: present
Base commit: match
Not staged. Run import to stage this capsule.
```

`REPORT.md` prints `present` or `absent`. `Base commit` prints `match` or `changed`.

`--json` prints:

```text
{
  "taskId": "<task-id>",
  "resultStatus": "<manifest.status>",
  "fileCount": 0,
  "reportPresent": false,
  "sourceBaseCommit": "<manifest.source_base_commit>",
  "storedBaseCommit": "<manifest.project.base_commit>",
  "repositoryBaseChanged": false,
  "staged": false
}
```

`staged` is always false.

## 5. CLI

```text
agent-task-bridge handoff show <task-id> [--repo <dir>] [--json]
agent-task-bridge handoff check <result.zip> [--repo <dir>] [--json]
```

Parsing matches `task show`: `handoff` is the command, the subcommand is the first positional argument, and the task id or ZIP path is the next positional argument. `--repo` and `--json` are the existing `args.repo` and `args.json` flags.

`handoff` without a subcommand, or an unknown subcommand, throws `MISSING_ARGUMENT`. The process prints that error as JSON on stderr and exits 1, the same way other missing arguments do. The usage help lists both forms next to `inspect-result`.

## 6. Skills

Codex and Claude Code export skills, after they report the capsule path, tell the agent it may run `handoff show <task-id>` to print the upload paths and kickoff. Import skills, before `import`, tell the agent it may run `handoff check <result.zip>` and that check does not stage files. Import remains the command that stages.

## 7. What does not change

- Export still writes the same five files.
- `inspect-result` still inspects a ZIP without a repository.
- Import still performs drift checks, staging, validation, and `REPORT.md` persistence.
- Protocol `1.0` and schema `1.1` are unchanged.

## 8. Tests

- `show` text prints the four labeled paths and the kickoff body. `show --json` also includes `summaryPath` and `baseCommit`.
- `show` returns `HANDOFF_NOT_FOUND` for an unknown task id and when any of the five handoff files is missing, including `kickoff.md` and `summary.json`.
- `check` accepts a ZIP whose task id and base commit match the stored task and reports `staged: false`.
- `check` reports `repositoryBaseChanged: true` when the ZIP base commit differs, and it does not create a staging directory.
- `check` returns `HANDOFF_TASK_NOT_FOUND` when the ZIP names an unknown task.
- `check` still rejects an unsafe ZIP through the existing inspector errors.
- After `check`, the repository has no new `.agent-task-bridge/tasks/<task-id>/imports` directory.
- `--json` on both subcommands parses as JSON.
- Plugin skill tests assert the strings `handoff show` and `handoff check`.

## 9. Modules

- `src/handoff.mjs` exports `showHandoff` and `checkHandoff`.
- `bin/agent-task-bridge.mjs` dispatches the subcommands.
- `test/handoff-command.test.mjs` covers the cases in section 8.
- Both providers' export and import skills gain the sentences in section 6.
- `npm run bundle:plugins` refreshes runtime copies of `src/` and `bin/`.
