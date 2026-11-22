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
3. Create a temporary JSON delegation request containing `objective`, `work_unit`, `work_type`, `title`, `current_work_state`, `deliverables`, `editable_scope`, `acceptance_criteria`, `non_goals`, `architecture_context`, optional `host_owned_steps`, and `files` grouped as `editable`, `reference`, `contract`, `validation`, and `configuration`. `host_owned_steps` lists gates reserved for the local host, such as authoritative workspace builds, live databases, and git commit or push. Omit it to accept the bridge defaults.
4. Include only minimal sufficient context. Repository facts come from inspected files; label uncertainty in `architecture_context` rather than inventing APIs. So the returned code plugs in without rework, embed the interfaces it must call as `contract` files and one existing test plus one neighbouring source file as `reference` files; ChatGPT copies their conventions. ChatGPT cannot run the project toolchain, so also embed the type or interface definitions (state shapes, optional fields) that the editable files read or write as `contract` files, and the `tsconfig` that sets strictness when it is not already summarized in the capsule fingerprint.
5. Do not include secrets/credentials when the bridge reports them as sensitive.
6. From the repository root run:

   `node "<plugin root>/runtime/bin/agent-task-bridge.mjs" export --delegation "<temporary-json-path>" --repo . --source-agent codex --max-tokens <budget>`

   Omit `--max-tokens` when `.agent-task-bridge/config.json` should supply `maxTokens`. Extra host steps in that file apply only when the delegation omits `host_owned_steps`.

7. Delete the temporary input JSON when appropriate.
8. Return the generated `task.md` and `kickoff.md` paths, delegated boundaries, file count, and estimated context size. Before handing the capsule over, read export warnings and the upload checklist for `CONTEXT_COVERAGE_GAP` and `EDITABLE_OUTSIDE_SCOPE`. Report omitted in-scope files and editable files that fall outside `editable_scope`; a coverage warning does not block a deliberate bounded export. The developer should upload the Task Capsule and use the kickoff prompt in a fresh ChatGPT conversation. ChatGPT returns either a ZIP built by the capsule's `pack_result.py` (preferred) or a text reply the developer saves as a `.md` file; `import` accepts both.

Do not continue implementing the same delegated unit locally unless the developer explicitly asks for parallel work and accepts the merge risk.
