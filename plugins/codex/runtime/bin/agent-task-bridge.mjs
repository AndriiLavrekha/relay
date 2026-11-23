#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { exportTask } from '../src/exporter.mjs';
import { importResult } from '../src/importer.mjs';
import { parseTaskCapsule } from '../src/task-capsule.mjs';
import { inspectResultCapsule } from '../src/result-capsule.mjs';
import { findGitRoot } from '../src/repository.mjs';
import { findImportArtifacts, listStoredTasks, loadStoredTask } from '../src/storage.mjs';
import { discoverValidationCommands, runValidation } from '../src/validation.mjs';
import { formatImportReport, formatReviewReport } from '../src/reporting.mjs';
import { AtbError } from '../src/errors.mjs';
import { createFollowUpCapsule, formatTaskSummary } from '../src/handoff.mjs';
import { briefReview } from '../src/review.mjs';
import { loadLifecycle, writeLifecycle } from '../src/lifecycle.mjs';
import { integrateImport } from '../src/integration.mjs';
import { buildReport, collectMetrics, formatMetrics, projectTranscripts, recordNote } from '../src/metrics.mjs';

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
  console.log(`Agent Task Bridge ${pkg.version}\n\nUsage:\n  agent-task-bridge export --delegation <file> [--repo <dir>] [--out <file>] [--source-agent <name>] [--max-tokens <n>] [--privacy <mode>] [--confirm-privacy]\n  agent-task-bridge import <result.zip|reply.md> [--repo <dir>] [--json|--brief] [--validation-policy <safe|prompt|skip>] [--confirm-validation] [--allow-elision]\n  agent-task-bridge task show <task-id> [--repo <dir>] [--json]\n  agent-task-bridge review <import-id> [--repo <dir>] [--json|--brief]\n  agent-task-bridge follow-up <import-id> [--repo <dir>] [--json] [--confirm-privacy]\n  agent-task-bridge integrate <import-id> --mode branch --branch <name> --confirm   (commits on the new branch)\n  agent-task-bridge inspect-task <task.md>\n  agent-task-bridge inspect-result <result.zip>\n  agent-task-bridge validate [--dir <dir>]\n  agent-task-bridge status [--repo <dir>]\n  agent-task-bridge metrics [--json] [--no-scan] [--repo <dir>]   (Claude token cost per delegated task, from Claude Code transcripts)\n  agent-task-bridge metrics note <task-id> --claude-estimate <usd>\n  agent-task-bridge metrics collect [--transcript <file>]\n  agent-task-bridge version\n\nOptional repo-local defaults live in .agent-task-bridge/config.json: maxTokens, validationPolicy (safe, prompt, or skip), extraHostOwnedSteps, validationCommands ([{ name, command, args }], replaces auto-discovery), and validationTimeoutMs. That directory is git-excluded. A CLI flag overrides the file. An explicit delegation host_owned_steps field, including [], overrides extraHostOwnedSteps. Privacy blocking and archive safety limits are not configurable.`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || ['help', '--help', '-h'].includes(command)) return help();
  if (['version', '--version', '-v'].includes(command)) return console.log(pkg.version);
  const args = parseArgs(rest);
  if (command === 'export') {
    if (!args.delegation) throw new AtbError('MISSING_ARGUMENT', '--delegation is required');
    const result = await exportTask({
      repoRoot: args.repo,
      delegationPath: args.delegation,
      outPath: args.out,
      sourceAgent: args['source-agent'] ?? 'unknown',
      maxTokens: args['max-tokens'],
      privacyPolicy: args.privacy ?? 'default',
      privacyConfirmed: args['confirm-privacy'] === true,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'import') {
    const file = args._[0];
    if (!file) throw new AtbError('MISSING_ARGUMENT', 'import requires a Result Capsule ZIP path');
    const report = await importResult({
      repoRoot: args.repo,
      resultPath: file,
      validationPolicy: args['validation-policy'],
      validationConfirmed: args['confirm-validation'] === true,
      allowElision: args['allow-elision'] === true,
    });
    if (args.brief) {
      const review = report.reviewPath ? JSON.parse(await readFile(report.reviewPath, 'utf8')) : null;
      console.log(JSON.stringify(briefReview(review, report), null, 2));
      return;
    }
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
  if (command === 'task' && args._[0] === 'show') {
    const taskId = args._[1];
    if (!taskId) throw new AtbError('MISSING_ARGUMENT', 'task show requires a task ID');
    const root = await findGitRoot(args.repo ?? process.cwd());
    const task = await loadStoredTask(root, taskId);
    const lifecycle = await loadLifecycle(root, taskId);
    const summary = formatTaskSummary({ manifest: task.manifest, delegation: task.delegation, lifecycle: lifecycle?.state ?? 'exported', contextSummary: task.manifest.context });
    console.log(JSON.stringify(summary, null, 2));
    return;
  }
  if (command === 'review') {
    const importId = args._[0];
    if (!importId) throw new AtbError('MISSING_ARGUMENT', 'review requires an import ID');
    const root = await findGitRoot(args.repo ?? process.cwd());
    const artifacts = await findImportArtifacts(root, importId);
    if (!artifacts?.review) throw new AtbError('IMPORT_NOT_FOUND', `Review not found for import: ${importId}`);
    if (args.brief) console.log(JSON.stringify(briefReview(artifacts.review, artifacts.report), null, 2));
    else console.log(args.json ? JSON.stringify(artifacts.review, null, 2) : formatReviewReport(artifacts.review));
    return;
  }
  if (command === 'follow-up') {
    const importId = args._[0];
    if (!importId) throw new AtbError('MISSING_ARGUMENT', 'follow-up requires an import ID');
    const root = await findGitRoot(args.repo ?? process.cwd());
    const artifacts = await findImportArtifacts(root, importId);
    if (!artifacts?.review) throw new AtbError('IMPORT_NOT_FOUND', `Review not found for import: ${importId}`);
    const result = await createFollowUpCapsule({ repoRoot: root, importId, review: artifacts.review, privacyConfirmed: args['confirm-privacy'] === true });
    if (artifacts.lifecycle) {
      await writeLifecycle(root, { ...artifacts.lifecycle, events: [...(artifacts.lifecycle.events ?? []), { state: artifacts.lifecycle.state, at: new Date().toISOString(), continuationOf: result.taskId }] });
    }
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'integrate') {
    const importId = args._[0];
    if (!importId) throw new AtbError('MISSING_ARGUMENT', 'integrate requires an import ID');
    const root = await findGitRoot(args.repo ?? process.cwd());
    const result = await integrateImport({
      repoRoot: root,
      importId,
      mode: args.mode ?? 'branch',
      branchName: args.branch,
      confirmed: args.confirm === true,
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'metrics') {
    const sub = args._[0];
    if (args['from-hook']) { // Claude Code Stop hook: stdin is {transcript_path, cwd}. Must never fail or slow the session.
      try {
        let input = ''; for await (const chunk of process.stdin) input += chunk;
        const { transcript_path: transcript, cwd } = JSON.parse(input);
        if (transcript) await collectMetrics(await findGitRoot(cwd ?? process.cwd()), [transcript]);
      } catch { /* metrics are best-effort */ }
      return;
    }
    const root = await findGitRoot(args.repo ?? process.cwd());
    if (sub === 'collect') {
      const files = args.transcript && args.transcript !== true ? [args.transcript] : await projectTranscripts(root);
      console.log(JSON.stringify(await collectMetrics(root, files), null, 2));
      return;
    }
    if (sub === 'note') {
      if (!args._[1]) throw new AtbError('MISSING_ARGUMENT', 'metrics note <task-id> --claude-estimate <usd>');
      await recordNote(root, args._[1], Number(args['claude-estimate']));
      console.log(JSON.stringify({ taskId: args._[1], claudeEstimateUsd: Number(args['claude-estimate']) }, null, 2));
      return;
    }
    if (sub) throw new AtbError('UNKNOWN_COMMAND', `Unknown metrics command: ${sub}`);
    if (!args['no-scan']) await collectMetrics(root, await projectTranscripts(root));
    const report = await buildReport(root);
    console.log(args.json ? JSON.stringify(report, null, 2) : formatMetrics(report));
    return;
  }
  throw new AtbError('UNKNOWN_COMMAND', `Unknown command: ${command}`);
}

main().catch((error) => {
  const payload = error instanceof AtbError ? { error: error.code, message: error.message, details: error.details } : { error: 'UNEXPECTED', message: error?.stack ?? String(error) };
  console.error(JSON.stringify(payload, null, 2));
  process.exitCode = 1;
});
