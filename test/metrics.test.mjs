import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/process.mjs';
import { exportTask } from '../src/exporter.mjs';
import { buildReport, collectMetrics, costOf, formatMetrics, parseTranscript, recordNote } from '../src/metrics.mjs';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'relay.mjs');
const MODEL = 'claude-sonnet-5-5';

async function makeRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-metrics-'));
  await runProcess('git', ['init', '-b', 'main'], { cwd: root });
  await runProcess('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await runProcess('git', ['config', 'user.name', 'ATB Test'], { cwd: root });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
  await runProcess('git', ['add', '.'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

async function exportFixture(root) {
  const delegation = path.join(root, 'delegation.json');
  await writeFile(delegation, JSON.stringify({
    title: 'Set a to 2', objective: 'Change a', work_unit: 'Edit src/a.js', work_type: 'code', editable_scope: ['src/**'],
    acceptance_criteria: ['a is 2'], files: { editable: ['src/a.js'], reference: [], contract: [], validation: [], configuration: [] },
  }));
  return exportTask({ repoRoot: root, delegationPath: delegation, sourceAgent: 'claude-code' });
}

// Transcript builders. Claude Code writes one entry per content block, so a message can appear several times with the same id.
let seq = 0;
const usage = (o) => ({ input_tokens: 2, cache_creation_input_tokens: o.write ?? 0, cache_read_input_tokens: o.read ?? 0, output_tokens: o.out ?? 0, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: o.write ?? 0 } });
const human = (text) => ({ type: 'user', sessionId: 's1', uuid: `u${seq++}`, timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: text } });
const assistant = (id, content, u, ts = '2026-01-01T00:00:10Z') => ({ type: 'assistant', sessionId: 's1', uuid: `a${seq++}`, timestamp: ts, message: { id, model: MODEL, role: 'assistant', content, usage: usage(u) } });
const toolResult = (text) => ({ type: 'user', sessionId: 's1', uuid: `r${seq++}`, timestamp: '2026-01-01T00:00:11Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: text }] } });
const skill = (name, ns = 'relay') => ({ type: 'tool_use', id: 't', name: 'Skill', input: { skill: `${ns}:${name}` } });
const bash = (command) => ({ type: 'tool_use', id: 't', name: 'Bash', input: { command } });
const jsonl = (entries) => `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`;

function exportTranscript(taskId, importTaskId = taskId, ns = 'relay', cliName = 'relay.mjs') {
  return jsonl([
    assistant('m0', [{ type: 'text', text: 'unrelated work before any skill' }], { read: 1000, out: 50 }),
    human('delegate this'),
    assistant('m1', [{ type: 'text', text: 'ok' }], { write: 500, read: 1000, out: 10 }),
    assistant('m1', [skill('export-chatgpt', ns)], { write: 500, read: 1000, out: 10 }), // same message, second block
    toolResult('skill loaded'),
    assistant('m2', [bash(`node "/p/runtime/bin/${cliName}" export --delegation d.json --repo .`)], { read: 2000, out: 100 }),
    toolResult(`{"taskId": "${taskId}", "capsule": "x"}`),
    assistant('m3', [{ type: 'text', text: 'exported' }], { read: 2100, out: 30 }),
    human('now import it'),
    assistant('m4', [skill('import-chatgpt', ns)], { read: 3000, out: 20 }),
    assistant('m5', [bash(`node "/p/runtime/bin/${cliName}" import r.zip --repo . --brief`)], { read: 3100, out: 40 }),
    toolResult(`{"taskId": "${importTaskId}", "resultStatus": "complete"}`),
    assistant('m6', [{ type: 'text', text: 'integrated' }], { read: 3200, out: 60 }),
  ]);
}

test('costOf matches a measured Sonnet 5.5 run to the cent and reports unknown models as null', () => {
  const u = { input: 16, cacheWrite5m: 0, cacheWrite1h: 22143, cacheRead: 354882, output: 2388 };
  assert.ok(Math.abs(costOf(MODEL, u) - 0.1479722) < 1e-7);
  assert.equal(costOf('some-other-model', u), null);
  assert.ok(costOf('other', u, { other: { input: 1, output: 5 } }) > 0);
});

test('parseTranscript attributes usage to prep, export and import, dedupes message ids and ignores work outside a skill', () => {
  const rows = parseTranscript(exportTranscript('atb_aaa_0123456789'));
  const by = Object.fromEntries(rows.map((r) => [r.phase, r]));
  assert.deepEqual(Object.keys(by).sort(), ['export', 'import', 'prep']);
  assert.equal(by.prep.messages, 2); // m1 (counted once despite two entries) and the message that runs the exporter
  assert.equal(by.prep.tokens.cacheWrite, 500);
  assert.equal(by.prep.tokens.cacheRead, 3000);
  assert.equal(by.export.messages, 1);
  assert.equal(by.export.tokens.output, 30);
  assert.equal(by.import.messages, 3);
  assert.equal(by.import.tokens.cacheRead, 9300);
  for (const r of rows) assert.equal(r.taskId, 'atb_aaa_0123456789');
  assert.equal(rows.reduce((n, r) => n + r.tokens.output, 0), 10 + 100 + 30 + 20 + 40 + 60); // m0 happened before any skill
});

test('parseTranscript also attributes legacy task-bridge and agent-task-bridge.mjs transcripts', () => {
  const rows = parseTranscript(exportTranscript('atb_legacy_0123456789', 'atb_legacy_0123456789', 'task-bridge', 'agent-task-bridge.mjs'));
  const by = Object.fromEntries(rows.map((r) => [r.phase, r]));
  assert.deepEqual(Object.keys(by).sort(), ['export', 'import', 'prep']);
  assert.equal(by.prep.taskId, 'atb_legacy_0123456789');
});

test('parseTranscript falls back to the last task id in the window when the CLI output was reshaped', () => {
  const rows = parseTranscript(jsonl([
    human('go'), assistant('x1', [skill('export-chatgpt')], { read: 10, out: 1 }),
    toolResult('.relay/tasks/atb_old_aaaaaaaaaa\n.relay/tasks/atb_new_bbbbbbbbbb/task.md'),
    assistant('x2', [{ type: 'text', text: 'done' }], { read: 10, out: 1 }),
  ]));
  assert.equal(rows[0].taskId, 'atb_new_bbbbbbbbbb');
});

test('collectMetrics writes an idempotent ledger and buildReport joins it to the stored task', async () => {
  const root = await makeRepo();
  const task = await exportFixture(root);
  const transcript = path.join(root, 'session.jsonl');
  await writeFile(transcript, exportTranscript(task.taskId));
  const first = await collectMetrics(root, [transcript]);
  assert.equal(first.collected, 3);
  assert.equal((await collectMetrics(root, [transcript])).collected, 0); // unchanged transcript adds nothing
  await writeFile(transcript, `${exportTranscript(task.taskId)}${jsonl([assistant('m7', [{ type: 'text', text: 'more' }], { read: 3300, out: 5 })])}`);
  assert.equal((await collectMetrics(root, [transcript])).collected, 1); // only the grown import row

  await recordNote(root, task.taskId, 1);
  const report = await buildReport(root);
  assert.equal(report.tasks.length, 1);
  const t = report.tasks[0];
  assert.equal(t.taskId, task.taskId);
  assert.equal(t.title, 'Set a to 2');
  assert.equal(t.lifecycle, 'exported');
  assert.ok(t.capsuleTokens > 0);
  assert.ok(t.costUsd > 0 && t.costComplete);
  assert.equal(t.savingPct, Math.round((1 - t.costUsd) * 100));
  assert.equal(report.totals.tasks, 1);
  const text = formatMetrics(report);
  assert.match(text, new RegExp(task.taskId));
  assert.match(text, /prep/); assert.match(text, /export/); assert.match(text, /import/);
  assert.match(text, /saving \d+%/);
});

test('collectMetrics never creates .relay in a repo that has not exported anything', async () => {
  const root = await makeRepo();
  const transcript = path.join(root, 'session.jsonl');
  await writeFile(transcript, exportTranscript('atb_aaa_0123456789'));
  assert.deepEqual(await collectMetrics(root, [transcript]), { collected: 0, scanned: 0 });
  await assert.rejects(access(path.join(root, '.relay')));
});

test('metrics --from-hook swallows bad input and a real hook payload fills the ledger', async () => {
  const root = await makeRepo();
  const task = await exportFixture(root);
  const bad = spawnSync(process.execPath, [CLI, 'metrics', '--from-hook'], { input: 'not json', encoding: 'utf8' });
  assert.equal(bad.status, 0);
  assert.equal(bad.stdout + bad.stderr, '');
  const transcript = path.join(root, 'session.jsonl');
  await writeFile(transcript, exportTranscript(task.taskId));
  const ok = spawnSync(process.execPath, [CLI, 'metrics', '--from-hook'], { input: JSON.stringify({ transcript_path: transcript, cwd: root }), encoding: 'utf8' });
  assert.equal(ok.status, 0);
  const ledger = (await readFile(path.join(root, '.relay', 'metrics.jsonl'), 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(ledger.filter((r) => r.kind === 'usage').length, 3);
  const cli = spawnSync(process.execPath, [CLI, 'metrics', '--json', '--no-scan', '--repo', root], { encoding: 'utf8' });
  assert.equal(cli.status, 0);
  assert.equal(JSON.parse(cli.stdout).tasks[0].taskId, task.taskId);
});

test('costOf prefers exact match and longest prefix, and handles partial usage safely', () => {
  const rates = {
    'claude-opus': { input: 10, output: 50 },
    'claude-opus-4-1': { input: 20, output: 100 },
  };
  assert.ok(Math.abs(costOf('claude-opus-4-1-20260101', { input: 1000, output: 500 }, rates) - 0.07) < 1e-9);
  assert.ok(Math.abs(costOf('claude-opus', { input: 1000, output: 500 }, rates) - 0.035) < 1e-9);
  assert.equal(costOf('claude-opus', { input: 10, output: 5 }, { 'claude-opus': { input: 'bad', output: 1 } }), null);
});

test('collectMetrics and buildReport support legacy .agent-task-bridge repos and merge split imports', async () => {
  const { rename } = await import('node:fs/promises');
  const root = await makeRepo();
  const task = await exportFixture(root);
  const { importResult } = await import('../src/importer.mjs');
  const { createZip } = await import('../src/zip.mjs');
  const zip = path.join(root, 'result.zip');
  await writeFile(zip, createZip([
    { name: 'manifest.json', data: JSON.stringify({
      atb_protocol: '1.0', capsule_type: 'result', task_id: task.taskId,
      source_base_commit: task.manifest.project.base_commit, result_type: 'code', summary: 'ok',
      files: [{ path: 'src/a.js', operation: 'modify' }], validation: { executed: [], not_executed: [] }, assumptions: [], unresolved: [],
    }) },
    { name: 'files/src/a.js', data: 'export const a = 2;\n' },
  ]));
  const imp = await importResult({ repoRoot: root, resultPath: zip, validationPolicy: 'skip' });
  await rename(path.join(root, '.relay'), path.join(root, '.agent-task-bridge'));

  const transcript = path.join(root, 'session.jsonl');
  await writeFile(transcript, exportTranscript(task.taskId));
  const collected = await collectMetrics(root, [transcript]);
  assert.equal(collected.collected, 3);

  // Simulate v1.x follow-up/integrate writing an updated lifecycle.json under .relay/tasks/<taskId>/imports/<importId>/
  const { loadLifecycle, transitionLifecycle, writeLifecycle } = await import('../src/lifecycle.mjs');
  const lc = await loadLifecycle(root, task.taskId, imp.importId);
  await writeLifecycle(root, transitionLifecycle(lc, 'integrated', { mode: 'branch', branchName: 'feat/legacy' }));

  const report = await buildReport(root);
  assert.equal(report.tasks.length, 1);
  assert.equal(report.tasks[0].imports, 1);
  assert.equal(report.tasks[0].integrated, true);

  const excludePath = (await runProcess('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: root })).stdout.trim();
  const excludeText = await readFile(path.isAbsolute(excludePath) ? excludePath : path.join(root, excludePath), 'utf8');
  assert.match(excludeText, /^|\n\.relay\/\n/);
});
