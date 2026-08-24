---
name: import-chatgpt
description: Safely inspect and stage a ChatGPT Result Capsule, detect repository drift, run local validation, and review integration.
---

# Import work returned by ChatGPT

## Locate the deterministic bridge

Resolve the **plugin root** as the directory containing `.codex-plugin/plugin.json`; this skill lives below `<plugin root>/skills/import-chatgpt/`. The CLI entrypoint is `<plugin root>/runtime/bin/agent-task-bridge.mjs`.

## Workflow

1. Treat the supplied ZIP as untrusted and do not manually extract it into the repository.
2. From the target repository root run:

   `node "<plugin root>/runtime/bin/agent-task-bridge.mjs" import "<result-capsule.zip>" --repo . --json --validation-policy safe`

3. Verify that the report matched the original stored Task Capsule and source baseline, then run `review <import-id> --repo . --json` to inspect the diff, receipts, privacy, validation, and acceptance evidence.
4. The bridge must leave the active working tree unchanged. Review `activeWorktreeModifiedByImport`, per-file drift statuses, withheld candidates, and the isolated staging path.
5. Inspect the staged diff against both the original delegation contract and the current repository architecture.
6. Review the validation results. When conflicts exist, validation is partial because only clean candidates were staged.
7. Never overwrite locally changed files with returned content merely because ChatGPT produced them. Resolve semantic conflicts explicitly.
8. Present the developer with changed files, conflicts, worker claims versus local evidence, acceptance criteria, and an integration recommendation. Use `follow-up <import-id>` for partial or blocked work. Only integrate after explicit confirmation with `integrate <import-id> --mode branch --branch <name> --confirm` or a confirmed in-place mode.
