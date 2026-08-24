# README Redesign Design

## Goal

Make the repository README easier for a first-time user to scan, install, upgrade, and understand without changing product behavior.

## Design

Use a centered hero with a direct tagline and only verified badges, followed by a compact table of contents and a reader-first explanation of the bridge. Put the shortest useful commands near the top in a Quick Start section, then split installation into Claude Code, Codex, local CLI, and source checkout paths. Include explicit upgrade commands in a collapsible section.

Retain the existing protocol, security, drift, MVP boundary, development, and license information, but reorganize it under descriptive headings and shorten repeated explanations. Use a small text workflow diagram and a documentation table to make deeper material discoverable. All commands and links must match files, manifests, and scripts present in this repository.

## Constraints

- README-only product documentation change, apart from progress/spec notes.
- No fabricated package publication, release, CI, social, or runtime claims.
- Preserve the Node.js 22 requirement and current marketplace/plugin names.
- Keep the README readable on GitHub desktop and mobile.
