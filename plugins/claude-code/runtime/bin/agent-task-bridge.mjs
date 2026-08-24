#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { exportTask } from '../src/exporter.mjs';
import { importResult } from '../src/importer.mjs';
import { parseTaskCapsule } from '../src/task-capsule.mjs';
import { inspectResultCapsule } from '../src/result-capsule.mjs';
import { findGitRoot } from '../src/repository.mjs';
import { listStoredTasks } from '../src/storage.mjs';
import { discoverValidationCommands, runValidation } from '../src/validation.mjs';
import { formatImportReport } from '../src/reporting.mjs';
import { AtbError } from '../src/errors.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(path.join(here, '..', 'package.json'), 'utf8'));

function parseArgs(args) {
  const parsed = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const value = args[i];
    if (!value.startsWith('--')) parsed._.push(value);
    else {
      const key = value.slice(2);
      const next = args[i + 1];
      if (!next || next.startsWith('--')) parsed[key] = true;
      else { parsed[key] = next; i++; }
    }
  }
  return parsed;
}

function help() {
  console.log(`Agent Task Bridge ${pkg.version}\n\nUsage:\n  agent-task-bridge export --delegation <file> [--repo <dir>] [--out <file>] [--source-agent <name>]\n  agent-task-bridge import <result.zip> [--repo <dir>] [--json]\n  agent-task-bridge inspect-task <task.md>\n  agent-task-bridge inspect-result <result.zip>\n  agent-task-bridge validate [--dir <dir>]\n  agent-task-bridge status [--repo <dir>]\n  agent-task-bridge version`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || ['help', '--help', '-h'].includes(command)) return help();
  if (['version', '--version', '-v'].includes(command)) return console.log(pkg.version);
  const args = parseArgs(rest);
  if (command === 'export') {
    if (!args.delegation) throw new AtbError('MISSING_ARGUMENT', '--delegation is required');
    const result = await exportTask({ repoRoot: args.repo, delegationPath: args.delegation, outPath: args.out, sourceAgent: args['source-agent'] ?? 'unknown' });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'import') {
    const file = args._[0];
    if (!file) throw new AtbError('MISSING_ARGUMENT', 'import requires a Result Capsule ZIP path');
    const report = await importResult({ repoRoot: args.repo, resultPath: file });
    console.log(args.json ? JSON.stringify(report, null, 2) : formatImportReport(report));
    return;
  }
  if (command === 'inspect-task') {
    const file = args._[0];
    if (!file) throw new AtbError('MISSING_ARGUMENT', 'inspect-task requires a capsule path');
    const parsed = parseTaskCapsule(await readFile(path.resolve(file), 'utf8'));
    console.log(JSON.stringify({ manifest: parsed.manifest, delegation: parsed.delegation, files: parsed.files.map(({ content, ...meta }) => meta) }, null, 2));
    return;
  }
  if (command === 'inspect-result') {
    const file = args._[0];
    if (!file) throw new AtbError('MISSING_ARGUMENT', 'inspect-result requires a Result Capsule ZIP path');
    const parsed = await inspectResultCapsule(path.resolve(file));
    console.log(JSON.stringify({ manifest: parsed.manifest, report: parsed.report, files: parsed.files.map(({ content, ...meta }) => meta) }, null, 2));
    return;
  }
  if (command === 'validate') {
    const dir = path.resolve(args.dir ?? process.cwd());
    const commands = await discoverValidationCommands(dir);
    console.log(JSON.stringify(await runValidation(dir, commands), null, 2));
    return;
  }
  if (command === 'status') {
    const root = await findGitRoot(args.repo ?? process.cwd());
    console.log(JSON.stringify(await listStoredTasks(root), null, 2));
    return;
  }
  throw new AtbError('UNKNOWN_COMMAND', `Unknown command: ${command}`);
}

main().catch((error) => {
  const payload = error instanceof AtbError ? { error: error.code, message: error.message, details: error.details } : { error: 'UNEXPECTED', message: error?.stack ?? String(error) };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});
