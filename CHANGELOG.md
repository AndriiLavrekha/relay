# Changelog

All notable changes to **Relay** (formerly *Agent Task Bridge*) are documented here and in [`docs/releases/`](docs/releases/).

## [1.0.0] - 2026-11-26

See [`docs/releases/v1.0.0.md`](docs/releases/v1.0.0.md) for full details and migration steps.

- Renamed project, marketplaces, plugins, and CLI to **Relay** (`@andriilavrekha/relay`, `relay` binary, `relay@relay`, `/relay:*`).
- Switched local repository storage to `.relay/` while preserving full read compatibility with legacy `.agent-task-bridge/` tasks, configs, lifecycles, and metrics ledgers.
- Fixed `.relay/config.json` validation to accept `metricsRates` for custom model cost pricing.
- Added `assets/logo.svg`, marketplace metadata polish, cross-platform GitHub Actions CI, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, [`docs/user-guide.md`](docs/user-guide.md), and [`docs/marketplace-publishing.md`](docs/marketplace-publishing.md).

## Earlier Releases (as Agent Task Bridge)

- [`v0.3.5`](docs/releases/v0.3.5.md) — Local delegation usage `metrics`, Claude Code `Stop` hook, `bench/` harness, modernized `README.md`.
- [`v0.3.4`](docs/releases/v0.3.4.md) — Gemini CLI extension, Antigravity plugin, and cross-provider `plan-chatgpt` skill.
- [`v0.3.3`](docs/releases/v0.3.3.md) — Markdown-escaped ChatGPT copy replies and experimental Claude Code browser delegation skill.
- [`v0.3.2`](docs/releases/v0.3.2.md) — Static self-review rule, tooling fingerprint (`tsconfig` extends), and validate-before-integrate guard.
- [`v0.3.1`](docs/releases/v0.3.1.md) — `pack_result.py` embedded packer, Option B text-reply transport, elision detection, 3-way merge, `--brief` review, and dependency linking.
- [`v0.3.0`](docs/releases/v0.3.0.md) — Multi-ecosystem validation auto-discovery and explicit `validationCommands` / `validationTimeoutMs`.
- [`v0.2.3`](docs/releases/v0.2.3.md) — Approved feature design specifications.
- [`v0.2.2`](docs/releases/v0.2.2.md) — Repo-local `.agent-task-bridge/config.json` defaults.
- [`v0.2.1`](docs/releases/v0.2.1.md) — Context coverage warnings, `host_owned_steps`, and persisted `REPORT.md` visibility.
- [`v0.2.0`](docs/releases/v0.2.0.md) — Schema `1.1` integrity verification, privacy scanning, isolated staging, scrubbed validation, receipts, and confirmation-gated integration.
- [`v0.1.0`](docs/releases/v0.1.0.md) — Initial Task Capsule / Result Capsule bridge MVP.
