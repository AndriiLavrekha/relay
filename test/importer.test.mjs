import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, access, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { exportTask } from '../src/exporter.mjs';
import { createZip } from '../src/zip.mjs';
import { importResult } from '../src/importer.mjs';
import { formatImportReport } from '../src/reporting.mjs';
import { AtbError } from '../src/errors.mjs';

async function exists(file) { try { await access(file); return true; } catch { return false; } }

async function worktreePaths(root) {
  const { stdout } = await runProcess('git', ['worktree', 'list', '--porcelain'], { cwd: root });
  return stdout.split(/\r?\n/).filter((line) => line.startsWith('worktree ')).map((line) => line.slice('worktree '.length));
}

function isInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

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
  assert.deepEqual(report.lifecycleHistory, ['inspected', 'staged', 'reviewed']);
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

test('importResult persists observed active-tree invariance when reconstruction fails', async (t) => {
  const { root, task } = await makeRepo();
  const external = await mkdtemp(path.join(tmpdir(), 'atb-import-reconstruction-target-'));
  t.after(() => rm(external, { force: true, recursive: true }));
  await writeFile(path.join(external, 'a.js'), 'export const a = 1;\n');
  await rm(path.join(root, 'src'), { force: true, recursive: true });
  try {
    await symlink(external, path.join(root, 'src'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`Platform cannot create a reconstruction reparse-point fixture: ${error.message}`);
    return;
  }
  const zip = await resultZip(root, task, [
    { path: 'src/a.js', operation: 'modify', content: 'export const a = 2;\n' },
  ]);
  const importsRoot = path.join(root, '.agent-task-bridge', 'tasks', task.taskId, 'imports');

  await assert.rejects(
    () => importResult({ repoRoot: root, resultPath: zip }),
    (error) => error.code === 'UNSAFE_WORKING_TREE_PATH'
  );

  assert.equal(await exists(importsRoot), true);
  const [importId] = await readdir(importsRoot);
  const savedReport = JSON.parse(await readFile(path.join(importsRoot, importId, 'report.json'), 'utf8'));
  assert.equal(savedReport.error.code, 'UNSAFE_WORKING_TREE_PATH');
  assert.equal(savedReport.activeWorktreeModifiedByImport, false);
  assert.equal(savedReport.activeTreeBefore.pathSetHash, savedReport.activeTreeAfter.pathSetHash);
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

test('importResult records a rejected lifecycle for an invalid result without copying result payload metadata', async () => {
  const { root } = await makeRepo();
  const resultPath = path.join(root, 'invalid-result.zip');
  await writeFile(resultPath, createZip([{ name: 'manifest.json', data: Buffer.from('{ not json') }]));

  await assert.rejects(
    () => importResult({ repoRoot: root, resultPath }),
    (error) => error.code === 'INVALID_RESULT_MANIFEST'
  );

  const rejectedRoot = path.join(root, '.agent-task-bridge', 'imports');
  const [importId] = await readdir(rejectedRoot);
  const report = JSON.parse(await readFile(path.join(rejectedRoot, importId, 'report.json'), 'utf8'));
  assert.equal(report.lifecycle, 'rejected');
  assert.equal(report.error.code, 'INVALID_RESULT_MANIFEST');
  assert.equal('resultSummary' in report, false);
  assert.equal('files' in report, false);
});

test('importResult records a failed staging-location lifecycle without creating a repository worktree', async () => {
  const { root, task } = await makeRepo();
  const zip = await resultZip(root, task, [{ path: 'src/a.js', operation: 'modify', content: 'export const a = 2;\n' }]);
  const stagingDir = path.join(root, 'unsafe-staging');

  await assert.rejects(
    () => importResult({ repoRoot: root, resultPath: zip, stagingDir }),
    (error) => error.code === 'UNSAFE_STAGING_LOCATION'
  );

  const importsRoot = path.join(root, '.agent-task-bridge', 'tasks', task.taskId, 'imports');
  const [importId] = await readdir(importsRoot);
  const report = JSON.parse(await readFile(path.join(importsRoot, importId, 'report.json'), 'utf8'));
  assert.equal(report.lifecycle, 'failed');
  assert.equal(report.error.code, 'UNSAFE_STAGING_LOCATION');
  assert.equal(report.stagingRoot, null);
  assert.equal((await worktreePaths(root)).filter((worktree) => path.resolve(worktree) !== path.resolve(root) && isInside(root, worktree)).length, 0);
});

test('formatImportReport describes lifecycle, staging, exclusions, and observed active-tree outcome', () => {
  const text = formatImportReport({
    taskId: 'atb_x',
    lifecycle: 'reviewed',
    resultStatus: 'legacy',
    sourceBaseCommit: 'a'.repeat(40),
    currentHead: 'a'.repeat(40),
    repositoryBaseChanged: false,
    stagingRoot: '/tmp/stage',
    stagingRetained: true,
    excludedPaths: ['src/missing.js'],
    files: [],
    conflicts: [],
    validation: { passed: true, partial: false, blocked: false, results: [] },
    activeWorktreeModifiedByImport: false,
  });

  assert.match(text, /Lifecycle: reviewed/);
  assert.match(text, /Result status: legacy/);
  assert.match(text, /Staging outcome: retained/);
  assert.match(text, /Excluded working-tree paths: 1/);
  assert.match(text, /Active-tree comparison: unchanged/);
});

test('formatImportReport does not claim an unobserved active worktree is clean', () => {
  const text = formatImportReport({
    taskId: 'atb_x', lifecycle: 'rejected', resultStatus: null,
    stagingRoot: null, stagingRetained: false, files: [], conflicts: [], validation: null,
    activeWorktreeModifiedByImport: null,
  });

  assert.match(text, /Active-tree comparison: not observed/);
  assert.doesNotMatch(text, /No changes have been applied to the active worktree/);
  assert.doesNotMatch(text, /WARNING: active worktree was modified/);
});

test('importResult persists an interrupted lifecycle for a pre-aborted signal', async () => {
  const { root, task } = await makeRepo();
  const zip = await resultZip(root, task, [{ path: 'src/a.js', operation: 'modify', content: 'export const a = 2;\n' }]);
  const controller = new AbortController();
  const abortError = new AtbError('ABORT_ERR', 'Test import cancellation');
  controller.abort(abortError);

  await assert.rejects(
    () => importResult({ repoRoot: root, resultPath: zip, signal: controller.signal }),
    (error) => error === abortError
  );

  const importsRoot = path.join(root, '.agent-task-bridge', 'imports');
  const [importId] = await readdir(importsRoot);
  const report = JSON.parse(await readFile(path.join(importsRoot, importId, 'report.json'), 'utf8'));
  assert.equal(report.lifecycle, 'interrupted');
  assert.equal(report.error.code, 'ABORT_ERR');
  assert.equal(report.stagingRoot, null);
  assert.equal(report.cleanup, null);
});

test('importResult normalizes a reasonless pre-abort to ABORT_ERR', async () => {
  const { root, task } = await makeRepo();
  const zip = await resultZip(root, task, [{ path: 'src/a.js', operation: 'modify', content: 'export const a = 2;\n' }]);
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => importResult({ repoRoot: root, resultPath: zip, signal: controller.signal }),
    (error) => error.code === 'ABORT_ERR'
  );
});
