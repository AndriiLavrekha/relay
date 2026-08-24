# README Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve README.md with a clearer first-run path, copy-paste install and upgrade commands, and a more readable structure based on the approved design.

**Architecture:** This is a documentation-only change. README.md remains the single public entry point; deeper protocol and architecture details link to existing repository documents.

**Tech Stack:** GitHub-flavored Markdown, Node.js CLI commands, Claude Code and Codex plugin commands.

## Global Constraints

- Preserve the Node.js 22-or-newer requirement.
- Use only commands and links verified against this repository.
- Do not add unverified badges or claims.
- Do not change runtime code, manifests, tests, or generated bundles.

---

### Task 1: Rewrite the public README

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: `package.json`, plugin manifests, existing protocol docs, and the approved README design.
- Produces: a self-contained GitHub README with quick start, install, upgrade, usage, security, documentation, and verification sections.

- [ ] Replace the current opening with a centered hero, concise description, verified license/Node badges, and an anchor-friendly table of contents.
- [ ] Add a Quick Start section with the shortest supported Claude Code and Codex install commands plus local CLI usage.
- [ ] Add explicit Claude Code and Codex installation sections, including public marketplace commands and local marketplace commands where currently documented.
- [ ] Add a collapsible upgrade section covering the current Claude and Codex upgrade flows.
- [ ] Reorganize the workflow, features, CLI, protocol, security, drift, MVP boundary, development, contributing, and license content without dropping supported behavior.

### Task 2: Validate the README

**Files:**
- Verify: `README.md`

- [ ] Search for placeholders, stale package names, and unsupported commands.
- [ ] Verify every relative README link resolves to an existing repository file or directory.
- [ ] Run `npm test`, `npm run smoke`, and `npm pack --dry-run` because the README exposes these commands and the project guidelines require them for meaningful documentation changes.
- [ ] Update `project-progress/Progress.md` and the Obsidian notes with the final snapshot, next action, blockers, and validation results.
