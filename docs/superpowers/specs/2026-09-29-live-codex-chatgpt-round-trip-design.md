# Live Codex and ChatGPT Round Trip

**Status:** Approved on 2026-09-29

**Date:** 2026-09-29

**Goal:** Prove that published Agent Task Bridge v0.2.2 behaves correctly when Codex exports a real task and the ChatGPT website returns a Result Capsule. Local `npm test` and `npm run smoke` do not open either product.

**Approach:** One recorded manual pass. Do not automate the browser, and do not change bridge code as part of the pass. A failure becomes a separate bug. A pass closes this item.

---

## 1. Why this is first

v0.2.1 added coverage warnings, durable `REPORT.md`, and host-owned steps. v0.2.2 added `.agent-task-bridge/config.json`. Both are published. The in-repo smoke test simulates a capsule with fixtures. It does not install the Codex plugin, upload a file in ChatGPT, or download a ZIP from a browser.

This spec produces evidence, not a feature.

## 2. Chosen approach

Run one bounded code change through the public v0.2.2 plugin.

Rejected alternatives:

- Treating `npm run smoke` as a substitute. It cannot see a stale Codex marketplace pin, a skill-instruction mistake, or a browser upload of the wrong file.
- Building ChatGPT browser or API transport in this pass. Automatic transport stays deferred. The handoff-command spec prints upload paths and checks a ZIP before import.

## 3. Preconditions

- The host repository is a Git checkout with Node.js 22 or newer.
- Codex is installed and can run plugins.
- The operator has a ChatGPT session in a web browser.
- The marketplace pin is `v0.2.2`. An existing older pin is removed and added again:

```text
codex plugin remove task-bridge@awesome-task-bridge
codex plugin marketplace remove awesome-task-bridge
codex plugin marketplace add AndriiLavrekha/task-bridge --ref v0.2.2
codex plugin add task-bridge@awesome-task-bridge
```

`codex plugin marketplace upgrade` refreshes the current ref. It does not move an older pin. Start a new Codex session after installation.

If `.agent-task-bridge/config.json` exists, record its contents in the results. The pass uses that file. If it is absent, the pass uses the shipped defaults and may pass `--max-tokens` explicitly.

## 4. Procedure

1. In Codex, export one bounded unit from a real repository. The delegation includes an `editable_scope`, at least one acceptance criterion that is worker-owned, and at least one criterion the host should own (for example a full workspace test or a git push).
2. Read the export JSON `warnings`, the Task Capsule warning block, and `.agent-task-bridge/tasks/<task-id>/upload-checklist.md` before upload.
3. Upload only `task.md` to a fresh ChatGPT conversation. Use `kickoff.md` as the prompt. Do not upload the rest of the repository.
4. Download the single Result Capsule ZIP ChatGPT returns.
5. In Codex, import that ZIP. Do not pass `--validation-policy` unless the results need to show an override of `config.json`.
6. Read the import report and `review`. Leave the active worktree unintegrated unless the operator separately decides to integrate.

## 5. Observations that must be recorded

Write the results in `project-progress/Session Log.md` under a dated heading. Record:

| Check | Pass condition |
| --- | --- |
| Export warnings | Record the export `warnings` array, the Task Capsule notice, and `upload-checklist.md`. When coverage has gaps, `CONTEXT_COVERAGE_GAP` is present. A bounded export whose `warnings` array is empty still passes this row. Record `RELATED_FILES_OMITTED` only when that export feature is present and its scan finds omissions. |
| ChatGPT return | One ZIP. For schema 1.1, `REPORT.md` is present when status is `partial`, `blocked`, or `research-only`. Status `complete` may omit it. Schema 1.0 does not require it. Record the status and whether the file was present. |
| Import safety | After import completes, `activeWorktreeModifiedByImport` is false. Staging is outside the repository. |
| Worker report | When `REPORT.md` is present, review `workerReport` shows the parsed sections, and high-confidence secrets in that view are redacted. The stored copy under `.agent-task-bridge/` stays raw. |
| Host boundary | Criteria the host owns have review status `deferred_to_host`. A `follow-up` capsule includes a criterion only when its status is neither `verified` nor `deferred_to_host`. |
| Validation executed | The host repository has installed dependencies, for example a git-ignored `node_modules`. Import reports at least one validation result whose status is `PASS` or `FAIL` for a real reason, never a missing dependency. `validation.dependencyLinks` lists the linked directories. A repository without dependencies does not satisfy this row. |
| Return transport | Record whether ChatGPT used `pack_result.py` (Option A) or the text reply (Option B), and the ChatGPT plan. Option A results carry `transport: "pack_result.py"` in `manifest.json`. |

Also record the Codex plugin version, the task id, the result status, and any command that failed.

## 6. Outcomes

- **Pass:** Every row in the table holds. This spec is done. No version bump.
- **Fail:** File the failing row as its own defect. Do not stretch this spec to include the fix.
- **Blocked:** Record the missing tool (Codex, browser session, or repository). Do not mark the spec passed.

## 7. Out of scope

Automatic upload or download, changes to protocol `1.0` or schema `1.1`, a new release, and edits to export or import behavior discovered during the pass. Those edits need their own spec.
