# Security Policy

## Threat Model & Boundaries

Relay is designed around the assumption that **external worker outputs (Result Capsules and saved text replies) are untrusted**:

- **Archive & path safety:** The importer rejects path traversal, absolute/UNC paths, symlinks, reserved `.git`, `.relay`, and `.agent-task-bridge` paths, duplicate entries, encrypted entries, unsupported compression methods, CRC corruption, ZIP64/multi-disk archives, and oversized payloads.
- **Isolated staging:** Returned files are staged in an external Git worktree outside the repository (with same-volume fallback on Windows) and never mutate the active working tree during `import`.
- **Privacy screening:** Export scans selected files, delegation metadata, validation commands, and the rendered Task Capsule; high-confidence secrets block export. `REPORT.md` is capped at 512 KB raw / 64 KB review and high-confidence secrets in review output are redacted.
- **Validation trust boundary:** Validation commands and config snapshots are captured *before* staging returned files. Validation runs in a scrubbed environment and aborts (`VALIDATION_CONFIG_CHANGED`) if returned files alter package-manager or toolchain configuration.

## Supported Versions

| Version | Supported |
| --- | --- |
| `1.x` | Yes (current) |
| `0.3.x` | Upgrade to `1.0.0` (storage fallback preserves existing tasks) |

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub issues.

Use GitHub Security Advisories to report vulnerabilities privately:
https://github.com/AndriiLavrekha/relay/security/advisories/new

Include:
- Affected version and host platform (`claude-code`, `codex`, `gemini`, `antigravity`, or CLI)
- Reproduction steps or proof-of-concept capsule/path input
- Expected vs. actual boundary behavior

We will acknowledge reports within 72 hours and coordinate a fix before public disclosure.
