---
name: import-chatgpt
description: Safely inspect and stage a ChatGPT Result Capsule, detect repository drift, run local validation, and review integration.
---

# Import work returned by ChatGPT

## Locate the deterministic bridge

Resolve the **plugin root** as the directory containing `.codex-plugin/plugin.json`; this skill lives below `<plugin root>/skills/import-chatgpt/`. The CLI entrypoint is `<plugin root>/runtime/bin/relay.mjs`.

## Workflow

1. Treat the supplied ZIP or saved text reply (`.md`) as untrusted and do not manually extract or copy it into the repository.
2. From the target repository root run:

   `node "<plugin root>/runtime/bin/relay.mjs" import "<result-capsule.zip or reply.md>" --repo . --brief`

   `--brief` prints only decisions, withheld files, and failing validation output; use `--json` only when you need the full report. Omit `--validation-policy` to use `.relay/config.json` when it sets `validationPolicy`. Pass `--validation-policy safe` to override that file.

3. Verify that the report matched the original stored Task Capsule and source baseline. Run `review <import-id> --repo . --brief` again later instead of re-reading full JSON.
4. The bridge must leave the active working tree unchanged. Review `activeWorktreeModifiedByImport`, per-file drift statuses, withheld candidates, and the isolated staging path.
5. File statuses: `CLEAN_UNCHANGED`, `NEW_EXPECTED`, and `MERGED_CLEAN` (a clean three-way merge onto your local edits) are staged. `SUSPECT_ELISION` means the worker likely returned an abbreviated file. Read `elision.markers` and `elision.shrink`. If they are genuine comments or an intentional rewrite, re-import with `--allow-elision`. Otherwise use `follow-up`. Never copy the candidate in by hand. `LOCAL_CHANGED` with `merge.conflictMarkersPath` holds a conflict-marker file to resolve deliberately.
6. Inspect the staged diff against both the original delegation contract and the current repository architecture. Review the validation results; when files are withheld, validation is partial.
7. Never overwrite locally changed files with returned content merely because ChatGPT produced them. Resolve semantic conflicts explicitly.
8. Review validation evidence before any integration. If staged validation failed, or reports that it was skipped, truncated, or not run, do not run `integrate`; report the failures and use `follow-up <import-id>` instead. Never integrate first and validate afterwards.
9. Present the developer with changed files, conflicts, worker claims versus local evidence, the persisted worker report (`REPORT.md`), acceptance criteria, and an integration recommendation. Read `review.workerReport` instead of extracting the ZIP by hand. Criteria marked `deferred_to_host` are local host gates: run them in this checkout and do not send them back with `follow-up`. Use `follow-up <import-id>` for partial or blocked worker-owned work; it re-reads context from the current checkout, so run it where the integrated work is checked out. Only integrate after explicit confirmation with `integrate <import-id> --mode branch --branch <name> --confirm` (commits the staged files on the new branch) or a confirmed in-place mode.
