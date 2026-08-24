---
name: export-chatgpt
description: Export a bounded, self-contained unit of current repository work for execution in a fresh ChatGPT conversation.
---

# Export work to ChatGPT

Use this skill when the developer wants ChatGPT to execute a bounded unit of work from the current Codex task.

## Locate the deterministic bridge

The plugin is self-contained. Resolve the **plugin root** as the directory that contains `.codex-plugin/plugin.json`; this skill lives below `<plugin root>/skills/export-chatgpt/`. The CLI entrypoint is `<plugin root>/runtime/bin/agent-task-bridge.mjs`. Use the absolute resolved path when invoking it; do not assume the plugin root is the current working directory.

## Workflow

1. Inspect current user intent, work already completed, outstanding work, relevant repository code, tests, contracts, project configuration, and Git state.
2. Select one independently integrable work unit rather than exporting the entire plan.
3. Create a temporary JSON delegation request containing `objective`, `work_unit`, `work_type`, `title`, `current_work_state`, `deliverables`, `editable_scope`, `acceptance_criteria`, `non_goals`, `architecture_context`, and `files` grouped as `editable`, `reference`, `contract`, `validation`, and `configuration`.
4. Include only minimal sufficient context. Repository facts come from inspected files; label uncertainty in `architecture_context` rather than inventing APIs.
5. Do not include secrets/credentials when the bridge reports them as sensitive.
6. From the repository root run:

   `node "<plugin root>/runtime/bin/agent-task-bridge.mjs" export --delegation "<temporary-json-path>" --repo . --source-agent codex --max-tokens <budget>`

7. Delete the temporary input JSON when appropriate.
8. Return the generated `task.md` and `kickoff.md` paths, delegated boundaries, file count, and estimated context size. The developer should upload the Task Capsule and use the kickoff prompt in a fresh ChatGPT conversation.

Do not continue implementing the same delegated unit locally unless the developer explicitly asks for parallel work and accepts the merge risk.
