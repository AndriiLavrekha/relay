---
project: agent-task-bridge
updated: 2026-09-29
---

# Decisions

- 2026-08-24: Initialize a fresh local Git repository because the supplied project directory has no `.git` metadata.
- 2026-08-24: Use `https://github.com/AndriiLavrekha/task-bridge` as the `origin` remote, per user request.

## 2026-08-24: Initialize Project Progress

Use `project-progress/` as the project-local source of progress state.

## 2026-09-29: Ship v0.2.1 without a new protocol version

Follow `docs/superpowers/specs/2026-09-27-v0.2.1-reliability-and-visibility-design.md`.
Keep `atb_protocol` `1.0` and schema `1.1`. Default new exports to three host-owned steps, and
treat a missing `host_owned_steps` field on older manifests as an empty list.

## 2026-09-29: Publish v0.2.1 from main

The release was requested after the spec was implemented. Pin Claude Code and Codex install
docs and both marketplace catalogs to `v0.2.1`, then publish annotated tag `v0.2.1` on `main`.
