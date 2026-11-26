---
name: plan-chatgpt
description: Plan and decompose a feature or multi-part task along clean module seams into local host-owned work and bounded units ready to export to ChatGPT.
---

# Plan and split work for ChatGPT delegation

Use this skill when the developer wants to analyze a feature or multi-part change, split it along clean module seams into local host-owned work versus bounded ChatGPT units, and prepare the interface seam before exporting.

## Locate the deterministic bridge

The plugin is self-contained. Resolve the **plugin root** as the directory that contains `.codex-plugin/plugin.json`; this skill lives below `<plugin root>/skills/plan-chatgpt/`. When the plan is approved and ready to export, `export-chatgpt` invokes `<plugin root>/runtime/bin/relay.mjs`.

## Workflow

1. Inspect the user's goal, relevant repository modules, types/contracts, neighbouring implementations, existing tests, and current Git state. Do not export any Task Capsule during this planning step.
2. Split the work along clean seams into a structured breakdown:
   - **Delegate to ChatGPT:** self-contained modules behind an interface, parsers or algorithms, isolated test suites, or migrations of isolated files.
   - **Keep local (Host-owned):** cross-cutting registration, dependency injection, routing, configuration, live services, and edits spread across many files.
3. For each exportable unit, draft the exact delegation contract fields that `export-chatgpt` will pass to `node "<plugin root>/runtime/bin/relay.mjs" export`:
   - `title`, `objective`, `work_unit`, `work_type`, `current_work_state`, `deliverables`, `non_goals`, and `architecture_context`.
   - `editable_scope`: repository-relative paths or globs ChatGPT may change.
   - `files`: grouped into `editable`, `contract` (interfaces, types, state shapes), `reference` (one neighbouring source file and one existing test whose conventions ChatGPT should copy), `validation`, and `configuration`.
   - `acceptance_criteria`: observable requirements ChatGPT must map to tests.
   - `host_owned_steps`: local verification and integration gates (such as workspace builds, live services, wiring into controllers, and Git commit/push).
   - **Ordering:** state which units can be exported in parallel (non-overlapping `editable_scope`) and which must run sequentially.
4. Propose the **seam commit** first: identify the interfaces, types, and minimal stubs to add and commit locally so ChatGPT implements against a committed contract in `HEAD` rather than guessing how to connect.
5. Present the unit breakdown, the proposed seam changes, and the drafted delegation specs to the developer. Wait for explicit confirmation (and create/commit the seam first if approved) before invoking `export-chatgpt` for any unit.
