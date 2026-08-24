import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { fingerprintActiveTree } from '../src/staging.mjs';
import { persistImportReport } from '../src/storage.mjs';
import { writeLifecycle } from '../src/lifecycle.mjs';
import { integrateImport } from '../src/integration.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-integration-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
  await runProcess('git', ['init', '-b', 'main'], { cwd: root });
  await runProcess('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await runProcess('git', ['config', 'user.name', 'ATB Test'], { cwd: root });
  await runProcess('git', ['add', '.'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: root });
  const head = (await runProcess('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  await writeFile(path.join(root, 'src', 'a.js'), 'export const a = 2;\n');
  const activeTree = await fingerprintActiveTree(root);
  const taskId = 'atb_integration';
  const importId = 'import_integration';
  const report = {
    taskId, importId, lifecycle: 'reviewed', stagingRoot: root, currentHead: head,
    sourceBaseCommit: head, resultStatus: 'complete', repositoryBaseChanged: false,
    files: [{ path: 'src/a.js', operation: 'modify', status: 'CLEAN_UNCHANGED', appliedToStaging: true }],
    stagedFiles: ['src/a.js'], conflicts: [], validation: { passed: true, blocked: false, results: [] },
    acceptance: { criteria: [], overallStatus: 'verified' }, activeTreeAfter: activeTree,
  };
  await persistImportReport(root, { taskId, importId, report });
  await writeLifecycle(root, { taskId, importId, state: 'reviewed', events: [{ state: 'reviewed', at: new Date().toISOString() }] });
  await writeFile(path.join(root, '.agent-task-bridge', 'tasks', taskId, 'imports', importId, 'review.json'), JSON.stringify({ partial: false }));
  return { root, taskId, importId, head };
}

test('integrateImport requires confirmation and preserves active tree for branch mode', async () => {
  const value = await fixture();
  const branchName = `atb-integration-${Date.now().toString(36)}`;
  await assert.rejects(() => integrateImport({ repoRoot: value.root, importId: value.importId, mode: 'branch', branchName, confirmed: false }), (error) => error?.code === 'INTEGRATION_CONFIRMATION_REQUIRED');
  const result = await integrateImport({ repoRoot: value.root, importId: value.importId, mode: 'branch', branchName, confirmed: true });
  assert.equal(result.branchName, branchName);
  assert.equal(await readFile(path.join(result.integrationRoot, 'src', 'a.js'), 'utf8'), 'export const a = 2;\n');
  assert.equal((await runProcess('git', ['branch', '--show-current'], { cwd: value.root })).stdout.trim(), 'main');
});

test('integrateImport refuses active-tree drift before in-place mutation', async () => {
  const value = await fixture();
  await writeFile(path.join(value.root, 'src', 'a.js'), 'changed after review\n');
  await assert.rejects(() => integrateImport({ repoRoot: value.root, importId: value.importId, mode: 'in-place', confirmed: true }), (error) => error?.code === 'INTEGRATION_ACTIVE_TREE_CHANGED');
});
