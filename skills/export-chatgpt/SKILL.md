---
name: export-chatgpt
description: Export a bounded, self-contained unit of current repository work for execution in a fresh ChatGPT conversation.
---

# Export work to ChatGPT

Use this skill when the developer wants ChatGPT to execute a bounded unit of work from the current Gemini task.

## Locate the deterministic bridge

Resolve `<root>` as the directory two levels above this `SKILL.md` (`<root>/skills/export-chatgpt/SKILL.md`, which contains `.gemini-plugin/plugin.json` or `gemini-extension.json`). Resolve the CLI entrypoint in order:
1. `<root>/runtime/bin/agent-task-bridge.mjs` (when loaded from `plugins/gemini`, `agy plugin install`, or `.agents/plugins.json`)
2. `<root>/bin/agent-task-bridge.mjs` (when installed or linked from the repository root via `gemini extensions install` / `gemini extensions link`).

Use the absolute resolved CLI path when invoking it from the target repository root; do not assume `<root>` is the current working directory.

## Workflow

1. Inspect current user intent, work already completed, outstanding work, relevant repository code, tests, contracts, project configuration, and Git state.
2. Select one independently integrable work unit rather than exporting the entire plan. If the feature has not been decomposed yet, use `plan-chatgpt` first.
3. Create a temporary JSON delegation request containing `objective`, `work_unit`, `work_type`, `title`, `current_work_state`, `deliverables`, `editable_scope`, `acceptance_criteria`, `non_goals`, `architecture_context`, optional `host_owned_steps`, and `files` grouped as `editable`, `reference`, `contract`, `validation`, and `configuration`. `host_owned_steps` lists gates reserved for the local host, such as authoritative workspace builds, live databases, and git commit or push. Omit it to accept the bridge defaults.
4. Include only minimal sufficient context. Repository facts come from inspected files; label uncertainty in `architecture_context` rather than inventing APIs. So the returned code plugs in without rework, embed the interfaces it must call as `contract` files and one existing test plus one neighbouring source file as `reference` files; ChatGPT copies their conventions. ChatGPT cannot run the project toolchain, so also embed the type or interface definitions (state shapes, optional fields) that the editable files read or write as `contract` files, and the `tsconfig` that sets strictness when it is not already summarized in the capsule fingerprint.
5. Do not include secrets/credentials when the bridge reports them as sensitive.
6. From the repository root run:

   `node "<resolved-cli-path>" export --delegation "<temporary-json-path>" --repo . --source-agent gemini --max-tokens <budget>`

   Omit `--max-tokens` when `.agent-task-bridge/config.json` should supply `maxTokens`. Extra host steps in that file apply only when the delegation omits `host_owned_steps`.

7. Delete the temporary input JSON when appropriate.
8. Return the generated `task.md` and `kickoff.md` paths, delegated boundaries, file count, and estimated context size. Before handing the capsule over, read export warnings and the upload checklist for `CONTEXT_COVERAGE_GAP` and `EDITABLE_OUTSIDE_SCOPE`. Report omitted in-scope files and editable files that fall outside `editable_scope`; a coverage warning does not block a deliberate bounded export. The developer should upload the Task Capsule and use the kickoff prompt in a fresh ChatGPT conversation. ChatGPT returns either a ZIP built by the capsule's `pack_result.py` (preferred) or a text reply the developer saves as a `.md` file; `import` accepts both.

Do not continue implementing the same delegated unit locally unless the developer explicitly asks for parallel work and accepts the merge risk.
