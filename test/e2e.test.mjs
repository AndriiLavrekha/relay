import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { exportTask } from '../src/exporter.mjs';
import { createZip } from '../src/zip.mjs';
import { importResult } from '../src/importer.mjs';

async function exists(file) { try { await access(file); return true; } catch { return false; } }

async function makeRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-e2e-'));
  await runProcess('git', ['init', '-b', 'main'], { cwd: root });
  await runProcess('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await runProcess('git', ['config', 'user.name', 'ATB Test'], { cwd: root });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'test'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'e2e-fixture', type: 'module', scripts: {
      lint: 'node --check src/value.js',
      test: 'node --test',
      build: 'node --check src/value.js'
    }
  }, null, 2));
  await writeFile(path.join(root, 'src', 'value.js'), 'export const value = 1;\n');
  await writeFile(path.join(root, 'test', 'value.test.js'), "import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../src/value.js'; test('value',()=>assert.equal(value,1));\n");
  await runProcess('git', ['add', '.'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

test('E2E export -> result capsule -> isolated import -> local validation succeeds without active mutation', async () => {
  const root = await makeRepo();
  const delegation = path.join(root, 'delegation.json');
  await writeFile(delegation, JSON.stringify({
    objective: 'Change value to 2', work_unit: 'Update source and focused test', work_type: 'code', editable_scope: ['src/**', 'test/**'],
    acceptance_criteria: ['Tests pass'], files: { editable: ['src/value.js', 'test/value.test.js'], reference: [], contract: [], validation: [], configuration: ['package.json'] }
  }));
  const task = await exportTask({ repoRoot: root, delegationPath: delegation, sourceAgent: 'codex' });
  const manifest = {
    atb_protocol: '1.0', capsule_type: 'result', task_id: task.taskId, source_base_commit: task.manifest.project.base_commit,
    result_type: 'code', summary: 'Set value to 2 and update test',
    files: [{ path: 'src/value.js', operation: 'modify' }, { path: 'test/value.test.js', operation: 'modify' }],
    validation: { executed: [], not_executed: ['npm test'] }, assumptions: [], unresolved: []
  };
  const resultPath = path.join(root, 'chatgpt-result.zip');
  await writeFile(resultPath, createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
    { name: 'REPORT.md', data: Buffer.from('# Result\nImplemented requested change.\n') },
    { name: 'files/src/value.js', data: Buffer.from('export const value = 2;\n') },
    { name: 'files/test/value.test.js', data: Buffer.from("import test from 'node:test'; import assert from 'node:assert/strict'; import { value } from '../src/value.js'; test('value',()=>assert.equal(value,2));\n") },
  ]));

  const report = await importResult({ repoRoot: root, resultPath });
  assert.equal(report.validation.passed, true);
  assert.equal(report.validation.partial, false);
  assert.deepEqual(report.validation.results.map((r) => [r.name, r.status]), [['lint', 'PASS'], ['test', 'PASS'], ['build', 'PASS']]);
  assert.equal(await readFile(path.join(root, 'src', 'value.js'), 'utf8'), 'export const value = 1;\n');
  assert.equal(await readFile(path.join(report.stagingRoot, 'src', 'value.js'), 'utf8'), 'export const value = 2;\n');
});


test('E2E research delegation can return a report-only Result Capsule without repository changes', async () => {
  const root = await makeRepo();
  const delegation = path.join(root, 'research-delegation.json');
  await writeFile(delegation, JSON.stringify({
    objective: 'Analyze the value module design',
    work_unit: 'Return a short architecture assessment without modifying code',
    work_type: 'research',
    editable_scope: [],
    acceptance_criteria: ['Report describes the current design'],
    files: { editable: [], reference: ['src/value.js'], contract: [], validation: [], configuration: ['package.json'] }
  }));
  const task = await exportTask({ repoRoot: root, delegationPath: delegation, sourceAgent: 'claude-code' });
  const resultPath = path.join(root, 'research-result.zip');
  await writeFile(resultPath, createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({
      atb_protocol: '1.0', capsule_type: 'result', task_id: task.taskId,
      source_base_commit: task.manifest.project.base_commit,
      result_type: 'research', summary: 'Architecture assessment complete',
      files: [], validation: { executed: [], not_executed: [] }, assumptions: [], unresolved: []
    })) },
    { name: 'REPORT.md', data: Buffer.from('# Architecture assessment\n\nThe fixture exposes one small value module.\n') }
  ]));

  const report = await importResult({ repoRoot: root, resultPath });
  assert.equal(report.files.length, 0);
  assert.equal(report.stagedFiles.length, 0);
  assert.equal(report.conflicts.length, 0);
  assert.equal(report.activeWorktreeModifiedByImport, false);
  assert.equal(await readFile(path.join(root, 'src', 'value.js'), 'utf8'), 'export const value = 1;\n');
  assert.equal(report.validation.passed, true);
});

test('import blocks validation when returned package configuration changes', async () => {
  const root = await makeRepo();
  const delegation = path.join(root, 'config-delegation.json');
  await writeFile(delegation, JSON.stringify({
    objective: 'Change project validation configuration',
    work_unit: 'Update package scripts',
    work_type: 'code',
    editable_scope: ['package.json'],
    acceptance_criteria: ['Configuration is reviewed before validation runs'],
    files: { editable: ['package.json'], reference: [], contract: [], validation: [], configuration: [] }
  }));
  const task = await exportTask({ repoRoot: root, delegationPath: delegation, sourceAgent: 'codex' });
  const packageJson = JSON.stringify({ name: 'e2e-fixture', type: 'module', scripts: { test: 'node -e "console.log(\\"UNTRUSTED_SCRIPT_EXECUTED\\")"' } }, null, 2);
  const manifest = {
    atb_protocol: '1.0', capsule_type: 'result', task_id: task.taskId,
    source_base_commit: task.manifest.project.base_commit, result_type: 'code', summary: 'Change validation script',
    files: [{ path: 'package.json', operation: 'modify' }], validation: { executed: [], not_executed: [] }, assumptions: [], unresolved: []
  };
  const resultPath = path.join(root, 'config-result.zip');
  await writeFile(resultPath, createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
    { name: 'REPORT.md', data: Buffer.from('# Result\n') },
    { name: 'files/package.json', data: Buffer.from(packageJson) },
  ]));

  const report = await importResult({ repoRoot: root, resultPath });
  assert.equal(report.validation.blocked, true);
  assert.equal(report.validation.results.length, 0);
});

test('E2E removes staging and keeps a failed report when validation cannot start', async () => {
  const root = await makeRepo();
  const packagePath = path.join(root, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'));
  packageJson.packageManager = 'atb-missing-manager@1.0.0';
  await writeFile(packagePath, JSON.stringify(packageJson, null, 2));
  await runProcess('git', ['add', 'package.json'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'use unavailable validation manager'], { cwd: root });

  const delegation = path.join(root, 'validation-failure-delegation.json');
  await writeFile(delegation, JSON.stringify({
    objective: 'Change value', work_unit: 'Update the value module', work_type: 'code', editable_scope: ['src/**'],
    acceptance_criteria: ['Validation starts'], files: { editable: ['src/value.js'], reference: [], contract: [], validation: [], configuration: ['package.json'] }
  }));
  const task = await exportTask({ repoRoot: root, delegationPath: delegation, sourceAgent: 'codex' });
  const resultPath = path.join(root, 'validation-failure-result.zip');
  await writeFile(resultPath, createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({
      atb_protocol: '1.0', capsule_type: 'result', task_id: task.taskId, source_base_commit: task.manifest.project.base_commit,
      result_type: 'code', summary: 'Change value', files: [{ path: 'src/value.js', operation: 'modify' }],
      validation: { executed: [], not_executed: [] }, assumptions: [], unresolved: []
    })) },
    { name: 'files/src/value.js', data: Buffer.from('export const value = 2;\n') },
  ]));

  await assert.rejects(
    () => importResult({ repoRoot: root, resultPath }),
    (error) => error.code === 'VALIDATION_PROCESS_FAILED'
  );

  const importsRoot = path.join(root, '.agent-task-bridge', 'tasks', task.taskId, 'imports');
  const [importId] = await readdir(importsRoot);
  const report = JSON.parse(await readFile(path.join(importsRoot, importId, 'report.json'), 'utf8'));
  assert.equal(report.lifecycle, 'failed');
  assert.equal(report.error.code, 'VALIDATION_PROCESS_FAILED');
  assert.equal(report.stagingRetained, false);
  assert.equal(report.cleanup.removed, true);
  assert.equal(await exists(report.stagingRoot), false);
});
