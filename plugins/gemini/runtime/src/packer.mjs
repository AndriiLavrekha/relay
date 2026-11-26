// Renders pack_result.py, a stdlib-only script the worker runs in its own Python sandbox so the
// Result Capsule manifest, hashes, task ID, and base commit are computed instead of typed by a model.
export function renderPackerScript({ taskId, baseCommit, files = [] }) {
  const baseline = Object.fromEntries(files.map((file) => [file.path, file.sha256]));
  return `#!/usr/bin/env python3
"""Relay result packer for task ${taskId}.

1. Write every complete changed or new file to atb_out/files/<repository-relative-path>.
2. Write atb_out/REPORT.md (required unless status is complete).
3. Run: python pack_result.py --status complete [--summary "..."] [--delete <path> ...]
4. Give the user the printed ZIP as a downloadable file.
"""
import argparse, hashlib, json, os, re, sys, zipfile

TASK_ID = ${JSON.stringify(taskId)}
BASE_COMMIT = ${JSON.stringify(baseCommit ?? '')}
BASELINE = ${JSON.stringify(baseline)}  # sha256 of each embedded file
COMMENT = re.compile(r"^\\s*(//|#|/\\*|\\*|<!--|--|;)")
PHRASE = re.compile(r"rest of (the )?(file|code|class|module|implementation|function|methods?)|(remains?|stays?|kept|left) unchanged|unchanged (code|parts?|sections?|methods|functions)|omitted for brevity|same as (before|original|above)|(implementation|code) omitted|(\\.\\.\\.|\\u2026)\\s*(the\\s+)?(rest|remaining|existing|unchanged|other|previous)\\b|(existing|remaining|previous|other) (code|implementation|methods|functions|logic)\\s*(\\.\\.\\.|\\u2026)", re.I)
BARE = re.compile(r"^\\s*(//|#|/\\*|<!--|--)\\s*(\\.\\.\\.|\\u2026)\\s*(\\*/|-->)?\\s*$")


def main():
    parser = argparse.ArgumentParser(description="Build a Relay Result Capsule ZIP")
    parser.add_argument("--status", required=True, choices=["complete", "partial", "blocked", "research-only"])
    parser.add_argument("--summary", default="")
    parser.add_argument("--delete", action="append", default=[], help="repository path of an embedded file to delete")
    parser.add_argument("--root", default="atb_out")
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    files_root = os.path.join(args.root, "files")
    declared, payloads, errors, warnings = [], [], [], []
    for dirpath, dirnames, filenames in os.walk(files_root):
        dirnames.sort()
        for name in sorted(filenames):
            full = os.path.join(dirpath, name)
            rel = os.path.relpath(full, files_root).replace(os.sep, "/")
            with open(full, "rb") as handle:
                data = handle.read()
            try:
                text = data.decode("utf-8")
            except UnicodeDecodeError:
                errors.append(rel + ": not UTF-8 text")
                continue
            if "\\x00" in text:
                errors.append(rel + ": binary content is not supported")
                continue
            digest = hashlib.sha256(data).hexdigest()
            if BASELINE.get(rel) == digest:
                warnings.append(rel + ": identical to the original, skipped")
                continue
            for number, line in enumerate(text.splitlines(), 1):
                if BARE.match(line) or (COMMENT.match(line) and PHRASE.search(line)):
                    warnings.append("%s:%d: ELISION placeholder: %s" % (rel, number, line.strip()[:100]))
            operation = "modify" if rel in BASELINE else "create"
            declared.append({"path": rel, "operation": operation, "sha256": digest, "size_bytes": len(data)})
            payloads.append((rel, data))
    for rel in args.delete:
        rel = rel.strip().replace("\\\\", "/")
        if rel not in BASELINE:
            errors.append("--delete " + rel + ": only embedded files can be deleted")
        else:
            declared.append({"path": rel, "operation": "delete"})
    report_path = os.path.join(args.root, "REPORT.md")
    report = None
    if os.path.isfile(report_path):
        with open(report_path, "rb") as handle:
            report = handle.read()
    if args.status != "complete" and report is None:
        errors.append("REPORT.md is required when status is " + args.status)
    if args.status == "complete" and not declared:
        errors.append("no changed files found under " + files_root)
    if errors:
        for message in errors:
            print("ERROR: " + message)
        sys.exit(2)
    manifest = {
        "atb_protocol": "1.0", "capsule_type": "result", "schema_version": "1.1", "hash_algorithm": "sha256",
        "status": args.status, "task_id": TASK_ID, "source_base_commit": BASE_COMMIT,
        "summary": args.summary, "transport": "pack_result.py", "files": declared,
    }
    if args.status == "research-only":
        manifest["result_type"] = "research"
    out = args.out or os.path.join("/mnt/data" if os.path.isdir("/mnt/data") else ".", "atb-result-" + TASK_ID + ".zip")
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps(manifest, indent=2))
        if report is not None:
            archive.writestr("REPORT.md", report)
        for rel, data in payloads:
            archive.writestr("files/" + rel, data)
    for message in warnings:
        print("WARNING: " + message)
    if any("ELISION" in message for message in warnings):
        print("Replace every ELISION placeholder with the full code, then run the packer again.")
    print("Result Capsule written: %s (%d file operations, status %s)" % (out, len(declared), args.status))


if __name__ == "__main__":
    main()
`;
}
