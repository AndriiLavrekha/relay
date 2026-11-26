# Contributing to Relay

Thank you for helping improve Relay!

## Requirements

- **Node.js 22 or newer** (native ESM, zero third-party runtime dependencies)
- **Git**

## Repository Layout

- `bin/relay.mjs` — canonical CLI entrypoint
- `src/` — deterministic bridge core (capsule rendering/parsing, privacy scanning, drift/elision detection, 3-way merge, isolated staging, validation, receipts, metrics)
- `plugins/{claude-code,codex,gemini}/` — provider plugin shells, skills, hooks, and generated `runtime/` & `assets/` copies
- `commands/` & `skills/` — root Gemini CLI extension commands and synced skills
- `protocol/` — Task Capsule v1 & Result Capsule v1 specifications
- `scripts/bundle-plugins.mjs` — syncs `src/`, `bin/`, `assets/`, and `plugins/gemini/skills/` into provider bundles
- `scripts/smoke-test.mjs` — cross-provider end-to-end smoke check
- `test/` — `node:test` automated test suite

## Development Workflow

1. Fork and clone the repository.
2. Make core edits in `src/` or `bin/relay.mjs`, and asset edits in `assets/`.
   - **Never edit generated `plugins/*/runtime/`, `plugins/*/assets/`, or root `skills/` directly.**
   - Edit `plugins/gemini/skills/` for Gemini skills, then rebuild.
3. Rebuild provider bundles whenever core, assets, or Gemini skills change:

   ```bash
   npm run bundle:plugins
   ```

4. Run the full verification suite:

   ```bash
   npm test
   npm run smoke
   npm pack --dry-run
   ```

5. If you modify plugin manifests, hooks, or skills, also run the relevant platform validators when available:

   ```bash
   claude plugin validate --strict .claude-plugin/marketplace.json
   claude plugin validate --profile directory --strict plugins/claude-code
   agy plugin validate --strict plugins/gemini
   gemini extensions validate .
   gemini extensions validate plugins/gemini
   ```

## Coding Style & Compatibility

- Two-space indentation, semicolons, `camelCase` for functions/variables, `PascalCase` for classes, kebab-case for CLI flags and documentation filenames.
- Keep zero third-party npm runtime dependencies in `src/` and `bin/`.
- **Protocol v1.0 backwards compatibility:** Keep `atb_protocol: "1.0"`, `<<<ATB_*>>>` delimiters, and `.agent-task-bridge/` legacy read fallbacks working unless a major protocol bump is explicitly approved.
- Never commit credentials, tokens, local paths, or sensitive task outputs.

## Pull Requests

- Use short imperative commit subjects (`feat: ...`, `fix: ...`, `docs: ...`).
- Keep PRs focused and include test coverage under `test/*.test.mjs` for behavior changes.
- Confirm CI passes on Linux, macOS, and Windows.
