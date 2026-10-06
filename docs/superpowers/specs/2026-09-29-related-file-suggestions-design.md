# Related-File Suggestions at Export

**Status:** Approved on 2026-09-29

**Date:** 2026-09-29

**Goal:** Warn the host, before upload, when a selected source file statically imports another in-scope repository file that was not embedded in the Task Capsule.

**Approach:** One-hop static scan. Suggestions are non-blocking warnings. The bridge does not add the files to the capsule by itself.

---

## 1. Context

`collectContext` embeds only paths the delegation lists. v0.2.1 coverage compares `editable_scope` with that list and emits `CONTEXT_COVERAGE_GAP`. It does not read `import` or `require`. The first real capsule missed files the scope named because the host's explicit file list was shorter than the scope. A related-file warning covers the next miss: a file the selected code names, which is inside the scope, and which was still left out.

## 2. Chosen approach

Scan the selected text files for static relative imports. Emit `RELATED_FILE_OMITTED` for each resolved target that is inside `editable_scope` and absent from the embedded set.

Rejected alternatives:

- Auto-embedding the targets. That grows the capsule without a host decision, can exceed `maxTokens`, and can include a file the host left out on purpose.
- A package-wide dependency graph or language service. The product does not index the repository, and this slice does not add one.

## 3. What is scanned

Scan only files that export actually embedded. Extensions: `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.jsx`, `.mts`, `.cts`.

A specifier is in scope for this check when all of the following hold:

- It is a static `import`, `export ... from`, or `require` whose module specifier is a string literal.
- The literal starts with `./` or `../`.
- It is not `import()`, not a dynamic `require`, not a bare package name, not a `node:` builtin, and not a URL.

Resolve the literal relative to the importing file. Try, in order:

1. The exact relative path.
2. That path plus `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.jsx`, `.mts`, `.cts`.
3. That path plus `/index` with the same extensions.

The first candidate that exists as a regular file wins. Ignore JSON, CSS, assets, and other extensions. Strip one trailing slash before resolution. A specifier that contains `?` or `#`, or that resolves to no regular file, produces no finding. Match the statement forms themselves: text inside a block comment, or inside a string that is not the module specifier, is not an import. Do not follow the imports of a suggested file. One hop only.

## 4. When a resolved file becomes a suggestion

Emit a suggestion only when every condition holds:

- The resolved path matches `editable_scope` under the existing `matchesAnyScope` rules, including `!` exclusions.
- The path is not already embedded in any file role.
- The path is a git-visible text file using the same candidate rules as context coverage: tracked or untracked, not gitignored, not a known binary extension, not under `.git` or `.agent-task-bridge`.
- The path is not reached through a symlink.

Git visibility uses the same discovery as `evaluateContextCoverage`: `git ls-files -z` and `git ls-files --others --exclude-standard -z`, skipping `.git` and `.agent-task-bridge`. A path is eligible only when that discovery lists it. Discovery failure sets `discoveryError` to the joined git error string, the same way coverage does, and does not abort export.

## 5. Report shape

Add findings:

```text
{
  path: "src/util.ts",
  reason: "RELATED_FILE_OMITTED",
  importedBy: "src/app.ts",
  specifier: "./util"
}
```

The export result always includes `relatedFiles`:

```text
{
  findings: [],
  totalRelatedOmittedCount: 0
}
```

`findings` lists at most 50 items. `totalRelatedOmittedCount` is the full finding count. One finding is one embedded file plus one specifier. Two embedded files that import the same target produce two findings. The same specifier repeated in one file produces one finding. Include `discoveryError` on this object only when discovery failed.

When `totalRelatedOmittedCount` is greater than zero, add a non-blocking export warning:

```text
{ code: "RELATED_FILES_OMITTED", count: <totalRelatedOmittedCount> }
```

`CONTEXT_COVERAGE_GAP` remains a separate warning with its current `code`, `message`, and `details`. Either warning may appear alone. Discovery failure by itself does not add `RELATED_FILES_OMITTED`.

When the count is greater than zero, the Task Capsule notice area gains this callout after the coverage notice when that notice exists:

```text
> [!WARNING]
> **Related files omitted (<totalRelatedOmittedCount>):**
> - `<path>` (imported by `<importedBy>` as `<specifier>`)
> External worker: these files are not embedded. Do not fabricate them. Document the omission in `REPORT.md`.
```

The callout lists at most 50 findings. The checklist gains one line only when the count is greater than zero: `Related files omitted: N static imports inside editable scope are not in the capsule.`

An absent `editable_scope` match and a count of zero add no warning, no callout, and no checklist line. The result still includes `relatedFiles` with an empty `findings` array.

## 6. What does not change

- Export still succeeds when suggestions exist.
- The delegation file list is not rewritten.
- Protocol `1.0` and schema `1.1` are unchanged. Suggestions are host-side diagnostics.
- Privacy scanning still applies to whatever the host later adds and re-exports.

## 7. Errors

A malformed specifier is ignored. An unreadable selected file is ignored for this scan and still follows the existing context-read errors if embedding itself fails. A symlink target is not suggested. This scan does not throw `RELATED_FILE_OMITTED`; that string is a finding reason, not an `AtbError` code.

## 8. Tests

- A relative `./util` from an embedded `.ts` file suggests `src/util.ts` when it is in scope and not selected.
- The same file is not suggested when it is already embedded, outside `editable_scope`, excluded by `!`, gitignored, or a known binary.
- Bare imports, `import()`, dynamic `require`, and `./data.json` produce no suggestion.
- Extensionless `./util` suggests `util.ts` when no exact `util` file exists and `util.ts` does. When both exist, the exact file is the suggestion.
- Suggestions do not chain through the suggested file's own imports.
- More than 50 findings report the total and list 50.
- Export still returns a capsule when suggestions exist.
- The checklist line and capsule callout appear only when the count is greater than zero.

## 9. Modules

- New module `src/related-files.mjs`, called from `src/exporter.mjs` after `collectContext` and `evaluateContextCoverage`. `src/context.mjs` stays responsible for embedding the files the host already selected.
- `src/task-capsule.mjs` and `src/handoff.mjs` render the callout and checklist line.
- Tests live in `test/related-files.test.mjs`.
- Both provider export skills mention the warning code `RELATED_FILES_OMITTED` next to `CONTEXT_COVERAGE_GAP`.
- `npm run bundle:plugins` keeps provider runtimes identical to `src/` and `bin/`.
