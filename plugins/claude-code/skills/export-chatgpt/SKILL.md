---
name: export-chatgpt
description: Export a bounded, self-contained unit of the current repository work for execution in a fresh ChatGPT conversation.
argument-hint: "[work to delegate]"
---

# Export work to ChatGPT

Use this when the developer wants to delegate a well-bounded part of the current work to ChatGPT without giving ChatGPT the whole repository.

## Required workflow

1. Inspect the current request, relevant repository files, existing plan/status, architecture, tests, and current Git state. Do not copy the conversation transcript.
2. Bound one independently useful work unit. If the request is broad, select the smallest coherent unit that can be returned and integrated independently.
3. Select only the repository files ChatGPT needs. Classify them as `editable`, `reference`, `contract`, `validation`, or `configuration`.
4. Create a temporary JSON delegation request with this shape:
   - `objective`: higher-level user objective.
   - `work_unit`: exact delegated work.
   - `work_type`: normally `code`, but research/design/documentation are valid.
   - `title`: short task title.
   - `current_work_state`: completed/partial/outstanding state relevant to this unit.
   - `deliverables`: concrete outputs expected from ChatGPT.
   - `editable_scope`: repository-relative paths or globs ChatGPT may change. Required for code tasks.
   - `acceptance_criteria`: observable requirements for accepting the result.
   - `non_goals`: changes ChatGPT must not make.
   - `architecture_context`: concise repository-derived architectural facts and constraints.
   - `files`: object containing arrays named `editable`, `reference`, `contract`, `validation`, and `configuration`.
5. Never include secrets or credentials to make an export succeed. If the bridge blocks a file as sensitive, choose a non-secret contract/example or tell the user what context cannot be exported.
6. Run the bundled deterministic exporter from the repository root:

   `node "${CLAUDE_PLUGIN_ROOT}/runtime/bin/agent-task-bridge.mjs" export --delegation "<temporary-json-path>" --repo . --source-agent claude-code`

7. Delete the temporary delegation JSON after a successful export if it was created outside the bridge's own local storage.
8. Report the generated Task Capsule path, delegated scope, file count, and estimated context size. Tell the user to upload that single Markdown file to a fresh ChatGPT conversation.

Do not implement the delegated unit locally after exporting it unless the developer separately asks you to continue that same work.
