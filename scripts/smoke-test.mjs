#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runProcess } from '../src/process.mjs';
import { createZip } from '../src/zip.mjs';
import { parseTaskCapsule } from '../src/task-capsule.mjs';
import { cleanupIsolatedStaging } from '../src/staging.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonicalCli = path.join(projectRoot, 'bin', 'relay.mjs');
const providerCli = (provider) => path.join(projectRoot, 'plugins', provider, 'runtime', 'bin', 'relay.mjs');
const fixture = await mkdtemp(path.join(tmpdir(), 'atb smoke '));
const stagingRoots = [];

async function writeDelegation(targetValue, exportProvider) {
  const delegationPath = path.join(fixture, `delegation-${exportProvider}-${targetValue}.json`);
  await writeFile(delegationPath, JSON.stringify({
    objective: `Change the fixture value from one to ${targetValue}.`,
    work_unit: `Update the value implementation and its unit test to ${targetValue}.`,
    work_type: 'code',
    title: `Change fixture value to ${targetValue}`,
    current_work_state: 'Baseline returns one and has one passing test.',
    deliverables: ['Updated implementation', 'Updated unit test'],
    editable_scope: ['src/**', 'test/**'],
    acceptance_criteria: [`value() returns ${targetValue}`, 'local validation passes'],
    non_goals: ['Do not modify package scripts'],
    architecture_context: 'Minimal Node.js ESM fixture.',
    files: {
      editable: ['src/value.js', 'test/value.test.js'],
      reference: [],
      contract: [],
      validation: ['package.json'],
      configuration: []
    }
  }, null, 2));
  return delegationPath;
}

async function runCrossProviderFlow({ exportProvider, importProvider, targetValue }) {
  const delegationPath = await writeDelegation(targetValue, exportProvider);
  const exportRun = await runProcess(process.execPath, [providerCli(exportProvider), 'export', '--delegation', delegationPath, '--repo', fixture, '--source-agent', exportProvider]);
  const exported = JSON.parse(exportRun.stdout);
  const taskText = await readFile(exported.outputPath, 'utf8');
  const task = parseTaskCapsule(taskText);
  assert.equal(task.manifest.task_id, exported.taskId);
  assert.equal(task.manifest.source_agent, exportProvider);
  assert.equal(task.files.find((file) => file.path === 'src/value.js').content, 'export function value() { return 1; }\n');

  const resultPath = path.join(fixture, `chatgpt-result-${exportProvider}-to-${importProvider}-${targetValue}.zip`);
  const resultManifest = {
    atb_protocol: '1.0',
    capsule_type: 'result',
    task_id: exported.taskId,
    source_base_commit: task.manifest.project.base_commit,
    result_type: 'code',
    summary: `Change value to ${targetValue} and update its test.`,
    assumptions: [],
    unresolved: [],
    validation: { executed: [], not_executed: ['Authoritative checks run locally by Relay'] },
    files: [
      { path: 'src/value.js', operation: 'modify' },
      { path: 'test/value.test.js', operation: 'modify' }
    ]
  };
  const resultZip = createZip([
    { name: 'manifest.json', data: JSON.stringify(resultManifest, null, 2) },
    { name: 'REPORT.md', data: `# Smoke result\n\nUpdated the requested implementation and test to ${targetValue}.\n` },
    { name: 'files/src/value.js', data: `export function value() { return ${targetValue}; }\n` },
    { name: 'files/test/value.test.js', data: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '../src/value.js';\ntest('value is ${targetValue}', () => assert.equal(value(), ${targetValue}));\n` }
  ]);
  await writeFile(resultPath, resultZip);

  const inspectRun = await runProcess(process.execPath, [canonicalCli, 'inspect-result', resultPath], { cwd: fixture });
  const inspected = JSON.parse(inspectRun.stdout);
  assert.equal(inspected.manifest.task_id, exported.taskId);
  assert.equal(inspected.files.length, 2);

  const importRun = await runProcess(process.execPath, [providerCli(importProvider), 'import', resultPath, '--repo', fixture, '--json'], { cwd: fixture });
  const report = JSON.parse(importRun.stdout);
  if (report.stagingRoot) stagingRoots.push(report.stagingRoot);
  assert.equal(report.activeWorktreeModifiedByImport, false);
  assert.deepEqual(report.files.map((file) => file.status), ['CLEAN_UNCHANGED', 'CLEAN_UNCHANGED']);
  assert.equal(report.conflicts.length, 0);
  assert.equal(report.validation.partial, false);
  assert.ok(report.validation.results.length >= 3);
  assert.ok(report.validation.results.every((result) => result.status === 'PASS'));
  assert.equal(await readFile(path.join(fixture, 'src', 'value.js'), 'utf8'), 'export function value() { return 1; }\n');
  assert.equal(await readFile(path.join(report.stagingRoot, 'src', 'value.js'), 'utf8'), `export function value() { return ${targetValue}; }\n`);

  return {
    direction: `${exportProvider} -> ChatGPT -> ${importProvider}`,
    taskId: exported.taskId,
    resultFiles: report.files.length,
    validation: report.validation.results.map(({ name, status }) => ({ name, status })),
    activeWorktreeModifiedByImport: report.activeWorktreeModifiedByImport
  };
}

try {
  await runProcess('git', ['init', '-b', 'main'], { cwd: fixture });
  await runProcess('git', ['config', 'user.email', 'smoke@example.invalid'], { cwd: fixture });
  await runProcess('git', ['config', 'user.name', 'ATB Smoke'], { cwd: fixture });
  await mkdir(path.join(fixture, 'src'), { recursive: true });
  await mkdir(path.join(fixture, 'test'), { recursive: true });

  const packageJson = {
    name: 'atb-smoke-fixture',
    type: 'module',
    scripts: {
      lint: 'node --check src/value.js',
      test: 'node --test',
      build: 'node -e "process.exit(0)"'
    }
  };
  await writeFile(path.join(fixture, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  await writeFile(path.join(fixture, 'src', 'value.js'), 'export function value() { return 1; }\n');
  await writeFile(path.join(fixture, 'test', 'value.test.js'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport { value } from '../src/value.js';\ntest('value is one', () => assert.equal(value(), 1));\n");
  await runProcess('git', ['add', '.'], { cwd: fixture });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: fixture });

  const flows = [];
  flows.push(await runCrossProviderFlow({ exportProvider: 'claude-code', importProvider: 'codex', targetValue: 2 }));
  flows.push(await runCrossProviderFlow({ exportProvider: 'codex', importProvider: 'claude-code', targetValue: 3 }));
  flows.push(await runCrossProviderFlow({ exportProvider: 'gemini', importProvider: 'claude-code', targetValue: 4 }));

  const version = JSON.parse(await readFile(path.join(projectRoot, 'package.json'), 'utf8')).version;
  for (const provider of ['claude-code', 'codex', 'gemini']) {
    const providerRun = await runProcess(process.execPath, [providerCli(provider), 'version']);
    assert.equal(providerRun.stdout.trim(), version);
  }

  console.log(JSON.stringify({
    smoke: 'PASS',
    flows,
    activeRepositorySource: await readFile(path.join(fixture, 'src', 'value.js'), 'utf8'),
    providerRuntimes: ['claude-code', 'codex', 'gemini']
  }, null, 2));
} finally {
  for (const stagingRoot of stagingRoots) {
    await cleanupIsolatedStaging({ repoRoot: fixture, stagingRoot }).catch(() => {});
  }
  await rm(fixture, { recursive: true, force: true });
}
