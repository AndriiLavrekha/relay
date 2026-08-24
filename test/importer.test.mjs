import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { exportTask } from '../src/exporter.mjs';
import { createZip } from '../src/zip.mjs';
import { importResult } from '../src/importer.mjs';

async function exists(file) { try { await access(file); return true; } catch { return false; } }

async function makeRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-import-'));
  await runProcess('git', ['init', '-b', 'main'], { cwd: root });
  await runProcess('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await runProcess('git', ['config', 'user.name', 'ATB Test'], { cwd: root });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'import-fixture' }));
  await writeFile(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
  await runProcess('git', ['add', '.'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: root });
  const delegationPath = path.join(root, 'delegation.json');
  await writeFile(delegationPath, JSON.stringify({
    objective: 'Change module a', work_unit: 'Modify a and optionally add modules', work_type: 'code', editable_scope: ['src/**'],
    files: { editable: ['src/a.js'], reference: [], contract: [], validation: [], configuration: ['package.json'] }
  }));
  const task = await exportTask({ repoRoot: root, delegationPath, sourceAgent: 'claude-code' });
  return { root, task };
}

async function resultZip(root, task, files, baseCommit = task.manifest.project.base_commit) {
  const entries = [{ name: 'manifest.json', data: Buffer.from(JSON.stringify({
    atb_protocol: '1.0', capsule_type: 'result', task_id: task.taskId, source_base_commit: baseCommit,
    result_type: 'code', summary: 'candidate', files: files.map(({ path, operation }) => ({ path, operation })),
    validation: { executed: [], not_executed: [] }, assumptions: [], unresolved: []
  })) }];
  for (const file of files) if (file.operation !== 'delete') entries.push({ name: `files/${file.path}`, data: Buffer.from(file.content) });
  const zipPath = path.join(root, `result-${Math.random().toString(16).slice(2)}.zip`);
  await writeFile(zipPath, createZip(entries));
  return zipPath;
}

test('importResult stages clean and expected-new files without mutating the active worktree', async () => {
  const { root, task } = await makeRepo();
  const zip = await resultZip(root, task, [
    { path: 'src/a.js', operation: 'modify', content: 'export const a = 2;\n' },
    { path: 'src/new.js', operation: 'create', content: 'export const n = 1;\n' },
  ]);
  const before = await readFile(path.join(root, 'src', 'a.js'), 'utf8');
  const report = await importResult({ repoRoot: root, resultPath: zip });
  assert.equal(report.taskId, task.taskId);
  assert.equal(report.repositoryBaseChanged, false);
  assert.deepEqual(report.files.map((f) => [f.path, f.status]), [
    ['src/a.js', 'CLEAN_UNCHANGED'],
    ['src/new.js', 'NEW_EXPECTED'],
  ]);
  assert.equal(await readFile(path.join(root, 'src', 'a.js'), 'utf8'), before);
  assert.equal(await readFile(path.join(report.stagingRoot, 'src', 'a.js'), 'utf8'), 'export const a = 2;\n');
  assert.equal(await readFile(path.join(report.stagingRoot, 'src', 'new.js'), 'utf8'), 'export const n = 1;\n');
  assert.equal(report.stagedFiles.length, 2);
});

test('importResult records observed active-tree invariance before and after staging', async () => {
  const { root, task } = await makeRepo();
  const zip = await resultZip(root, task, [
    { path: 'src/a.js', operation: 'modify', content: 'export const a = 2;\n' },
  ]);

  const report = await importResult({ repoRoot: root, resultPath: zip });
  const savedReport = JSON.parse(await readFile(report.reportPath, 'utf8'));

  assert.equal(report.activeWorktreeModifiedByImport, false);
  assert.deepEqual(
    { pathSetHash: report.activeTreeAfter.pathSetHash, files: report.activeTreeAfter.files },
    { pathSetHash: report.activeTreeBefore.pathSetHash, files: report.activeTreeBefore.files }
  );
  assert.equal(typeof report.activeTreeBefore.durationMs, 'number');
  assert.deepEqual(savedReport.activeTreeBefore, report.activeTreeBefore);
  assert.deepEqual(savedReport.activeTreeAfter, report.activeTreeAfter);
  assert.equal(savedReport.activeWorktreeModifiedByImport, false);
});

test('importResult reconstructs selected local drift and excludes unrelated out-of-scope files', async () => {
  const { root, task } = await makeRepo();
  await writeFile(path.join(root, 'src', 'a.js'), 'export const a = 99; // local\n');
  await writeFile(path.join(root, 'README.md'), 'local readme\n');
  const zip = await resultZip(root, task, [
    { path: 'src/a.js', operation: 'modify', content: 'export const a = 2;\n' },
    { path: 'README.md', operation: 'modify', content: 'model readme\n' },
  ]);
  const report = await importResult({ repoRoot: root, resultPath: zip });
  assert.deepEqual(report.files.map((f) => [f.path, f.status]), [
    ['src/a.js', 'LOCAL_CHANGED'],
    ['README.md', 'OUT_OF_SCOPE'],
  ]);
  assert.equal(await readFile(path.join(report.stagingRoot, 'src', 'a.js'), 'utf8'), 'export const a = 99; // local\n');
  assert.equal(await exists(path.join(report.stagingRoot, 'README.md')), false);
  assert.equal(report.stagedFiles.length, 0);
  assert.equal(await exists(report.candidateRoot), true);
  assert.equal(await readFile(path.join(report.candidateRoot, 'src', 'a.js'), 'utf8'), 'export const a = 2;\n');
});

test('importResult rejects a result whose source baseline does not match the stored task', async () => {
  const { root, task } = await makeRepo();
  const zip = await resultZip(root, task, [{ path: 'src/a.js', operation: 'modify', content: 'x\n' }], 'b'.repeat(40));
  await assert.rejects(() => importResult({ repoRoot: root, resultPath: zip }), /base|baseline|commit|task/i);
});
