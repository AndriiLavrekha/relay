import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { exportTask } from '../src/exporter.mjs';
import { createZip, readZip } from '../src/zip.mjs';
import { importResult } from '../src/importer.mjs';

async function exists(file) { try { await access(file); return true; } catch { return false; } }

async function initRepo(prefix = 'atb-security-') {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  await runProcess('git', ['init', '-b', 'main'], { cwd: root });
  await runProcess('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await runProcess('git', ['config', 'user.name', 'ATB Security Test'], { cwd: root });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'security-fixture' }));
  await writeFile(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
  await runProcess('git', ['add', '.'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

async function writeDelegation(root, overrides = {}) {
  const value = {
    objective: 'Safely change source code',
    work_unit: 'Change selected source files',
    work_type: 'code',
    editable_scope: ['src/**'],
    acceptance_criteria: ['Do not escape the repository'],
    files: { editable: ['src/a.js'], reference: [], contract: [], validation: [], configuration: ['package.json'] },
    ...overrides,
  };
  const file = path.join(root, `delegation-${Math.random().toString(16).slice(2)}.json`);
  await writeFile(file, JSON.stringify(value));
  return file;
}

async function makeResult(root, task, files, entryOverrides = []) {
  const manifest = {
    atb_protocol: '1.0',
    capsule_type: 'result',
    task_id: task.taskId,
    source_base_commit: task.manifest.project.base_commit,
    summary: 'security fixture',
    files: files.map(({ path, operation }) => ({ path, operation })),
  };
  const entries = [{ name: 'manifest.json', data: JSON.stringify(manifest) }];
  for (const file of files) if (file.operation !== 'delete') entries.push({ name: `files/${file.path}`, data: file.content ?? '' });
  entries.push(...entryOverrides);
  const result = path.join(root, `result-${Math.random().toString(16).slice(2)}.zip`);
  await writeFile(result, createZip(entries));
  return result;
}

test('export blocks selected secret files rather than embedding them', async () => {
  const root = await initRepo();
  await writeFile(path.join(root, '.env'), 'ORDINARY_NAME=ordinary-value\n');
  const delegation = await writeDelegation(root, {
    files: { editable: ['src/a.js'], reference: ['.env'], contract: [], validation: [], configuration: ['package.json'] },
  });
  await assert.rejects(() => exportTask({ repoRoot: root, delegationPath: delegation }), (error) => error?.code === 'SENSITIVE_CONTEXT');
});

test('export rejects repository metadata and bridge-internal paths even if explicitly requested', async () => {
  const root = await initRepo();
  const gitDelegation = await writeDelegation(root, {
    editable_scope: ['**'],
    files: { editable: ['src/a.js'], reference: ['.git/config'], contract: [], validation: [], configuration: [] },
  });
  await assert.rejects(() => exportTask({ repoRoot: root, delegationPath: gitDelegation }), (error) => error?.code === 'UNSAFE_PATH');

  await mkdir(path.join(root, '.agent-task-bridge'), { recursive: true });
  await writeFile(path.join(root, '.agent-task-bridge', 'private.txt'), 'internal state\n');
  const internalDelegation = await writeDelegation(root, {
    editable_scope: ['**'],
    files: { editable: ['src/a.js'], reference: ['.agent-task-bridge/private.txt'], contract: [], validation: [], configuration: [] },
  });
  await assert.rejects(() => exportTask({ repoRoot: root, delegationPath: internalDelegation }), (error) => error?.code === 'UNSAFE_PATH');
});

test('export refuses a symlinked internal storage root', { skip: process.platform === 'win32' }, async () => {
  const root = await initRepo();
  const outside = await mkdtemp(path.join(tmpdir(), 'atb-outside-storage-'));
  await symlink(outside, path.join(root, '.agent-task-bridge'));
  const delegation = await writeDelegation(root);
  await assert.rejects(() => exportTask({ repoRoot: root, delegationPath: delegation }), (error) => error?.code === 'UNSAFE_STORAGE_ROOT');
  assert.equal(await exists(path.join(outside, 'exports')), false);
});

test('export rejects selected context reached through a symlink', { skip: process.platform === 'win32' }, async () => {
  const root = await initRepo();
  const outside = await mkdtemp(path.join(tmpdir(), 'atb-outside-context-'));
  await writeFile(path.join(outside, 'innocent.txt'), 'external but not obviously secret\n');
  await symlink(outside, path.join(root, 'src', 'external'));
  const delegation = await writeDelegation(root, {
    files: { editable: ['src/a.js'], reference: ['src/external/innocent.txt'], contract: [], validation: [], configuration: [] },
  });
  await assert.rejects(() => exportTask({ repoRoot: root, delegationPath: delegation }), (error) => error?.code === 'CONTEXT_SYMLINK_UNSUPPORTED');
});

test('import quarantines a returned file whose staging path crosses a repository symlink', { skip: process.platform === 'win32' }, async () => {
  const root = await initRepo();
  const outside = await mkdtemp(path.join(tmpdir(), 'atb-outside-write-'));
  await symlink(outside, path.join(root, 'src', 'linked'));
  await runProcess('git', ['add', 'src/linked'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'add symlink'], { cwd: root });

  const delegation = await writeDelegation(root);
  const task = await exportTask({ repoRoot: root, delegationPath: delegation, sourceAgent: 'codex' });
  const result = await makeResult(root, task, [{ path: 'src/linked/pwn.txt', operation: 'create', content: 'must remain contained\n' }]);
  const report = await importResult({ repoRoot: root, resultPath: result });

  assert.equal(report.files[0].status, 'UNSAFE_SYMLINK_PATH');
  assert.equal(report.files[0].appliedToStaging, false);
  assert.equal(await exists(path.join(outside, 'pwn.txt')), false);
  assert.equal(await readFile(path.join(report.candidateRoot, 'src', 'linked', 'pwn.txt'), 'utf8'), 'must remain contained\n');
});

test('ZIP parser rejects traversal, symlinks, and duplicate logical entries', () => {
  const traversal = createZip([{ name: '../escape.txt', data: 'x' }]);
  assert.throws(() => readZip(traversal), /path|traversal|unsafe/i);

  const symlinkZip = createZip([{ name: 'files/link', data: 'target', externalAttributes: (0o120777 << 16) >>> 0 }]);
  assert.throws(() => readZip(symlinkZip), /symlink/i);

  const duplicate = createZip([{ name: 'files/a.js', data: 'one' }, { name: 'files/a.js', data: 'two' }]);
  assert.throws(() => readZip(duplicate), /duplicate/i);
});

test('out-of-scope returned files are withheld and active worktree remains unchanged', async () => {
  const root = await initRepo();
  await writeFile(path.join(root, 'README.md'), 'local\n');
  const delegation = await writeDelegation(root);
  const task = await exportTask({ repoRoot: root, delegationPath: delegation });
  const before = await readFile(path.join(root, 'src', 'a.js'), 'utf8');
  const result = await makeResult(root, task, [
    { path: 'src/a.js', operation: 'modify', content: 'export const a = 2;\n' },
    { path: 'README.md', operation: 'modify', content: 'unrequested\n' },
  ]);
  const report = await importResult({ repoRoot: root, resultPath: result });
  assert.equal(report.files.find((file) => file.path === 'README.md').status, 'OUT_OF_SCOPE');
  assert.equal(report.files.find((file) => file.path === 'README.md').appliedToStaging, false);
  assert.equal(report.activeWorktreeModifiedByImport, false);
  assert.equal(await readFile(path.join(root, 'src', 'a.js'), 'utf8'), before);
  assert.equal(await readFile(path.join(root, 'README.md'), 'utf8'), 'local\n');
});
