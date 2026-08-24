# Repository Guidelines

## Project Structure & Module Organization

- `src/` contains the bridge implementation and shared modules.
- `bin/` contains the executable CLI entry point.
- `plugins/` contains bundled agent integrations; `scripts/` contains build and smoke-test helpers.
- `protocol/` defines task/message contracts, while `examples/` provides usage samples.
- `test/` contains automated tests, and `docs/` contains architecture and contributor-facing documentation.
- `.agents/` and `.claude-plugin/` hold agent/plugin metadata. Keep generated plugin bundles synchronized with their sources.

## Build, Test, and Development Commands

The project requires Node.js 22 or newer and uses native ESM.

- `npm test` runs the Node built-in test suite.
- `npm run smoke` executes the end-to-end smoke test.
- `npm run bundle:plugins` rebuilds bundled plugin artifacts.
- `npm pack --dry-run` validates the package contents without publishing.

## Coding Style & Naming Conventions

Use two-space indentation, semicolons, and clear `camelCase` names for JavaScript variables and functions. Use `PascalCase` for classes and types, and kebab-case for CLI-facing names and documentation files. Follow existing ESM import conventions and keep modules focused. No formatter or linter is configured; verify changes with the relevant test and smoke commands.

## Testing Guidelines

Tests use Node's built-in `node:test` runner. Add tests under `test/` with descriptive filenames ending in `.test.mjs`, and cover protocol behavior, CLI flows, and plugin bundling when applicable. Run `npm test` and, for integration or CLI changes, `npm run smoke`.

## Commit & Pull Request Guidelines

Use short, imperative commit subjects in the existing style, such as `feat: add task retry handling`, `fix: validate worker payload`, or `docs: clarify setup`. Keep commits focused. Pull requests should explain the change and rationale, list validation commands and results, link relevant issues, and include examples or screenshots when behavior or documentation output changes.

## Security & Configuration Tips

Do not commit credentials, tokens, local configuration, or worker output containing sensitive task data. Review protocol and plugin changes for accidental data leakage, and document any new environment variables or required permissions.
