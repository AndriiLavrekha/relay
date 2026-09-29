import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { exportTask } from '../src/exporter.mjs';
import { loadStoredTask, listStoredTasks } from '../src/storage.mjs';
import { parseTaskCapsule } from '../src/task-capsule.mjs';

async function makeRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-export-'));
  await runProcess('git', ['init', '-b', 'main'], { cwd: root });
  await runProcess('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await runProcess('git', ['config', 'user.name', 'ATB Test'], { cwd: root });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node --test', lint: 'node --check src/index.js' } }, null, 2));
  await writeFile(path.join(root, 'src', 'index.js'), 'export const value = 1;\n');
  await runProcess('git', ['add', '.'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: root });
  await writeFile(path.join(root, 'src', 'index.js'), 'export const value = 2; // dirty state\n');
  return root;
}

test('exportTask writes a self-contained dirty-state capsule and durable task history', async () => {
  const root = await makeRepo();
  const delegationPath = path.join(root, 'delegation.json');
  await writeFile(delegationPath, JSON.stringify({
    objective: 'Change the exported value',
    work_unit: 'Update value behavior and tests',
    work_type: 'code',
    current_work_state: 'The source is already dirty and that exact state must be exported.',
    deliverables: ['Implementation'],
    editable_scope: ['src/**'],
    acceptance_criteria: ['Keep ESM syntax'],
    non_goals: [],
    files: { editable: ['src/index.js'], reference: [], contract: [], validation: [], configuration: ['package.json'] }
  }, null, 2));

  const result = await exportTask({ repoRoot: root, delegationPath, sourceAgent: 'claude-code' });
  assert.match(result.taskId, /^atb_[a-z0-9_]+$/);
  assert.ok(result.outputPath.endsWith(`task-${result.taskId}.md`));
  assert.match(await readFile(result.handoff.files.kickoff, 'utf8'), /complete resulting files/i);
  assert.match(await readFile(result.handoff.files.uploadChecklist, 'utf8'), /Upload only/);

  const capsuleText = await readFile(result.outputPath, 'utf8');
  const parsed = parseTaskCapsule(capsuleText);
  assert.equal(parsed.manifest.schema_version, '1.1');
  assert.equal(parsed.manifest.bridge_version, '0.2.2');
  assert.deepEqual(parsed.manifest.host_owned_steps, parsed.delegation.host_owned_steps);
  assert.equal(parsed.delegation.host_owned_steps.length, 3);
  assert.equal(parsed.manifest.hash_algorithm, 'sha256');
  assert.equal(parsed.manifest.source_agent, 'claude-code');
  assert.equal(parsed.manifest.project.dirty, true);
  assert.match(parsed.manifest.project.base_commit, /^[0-9a-f]{40}$/);
  assert.equal(parsed.files.find((f) => f.path === 'src/index.js').content, 'export const value = 2; // dirty state\n');
  assert.deepEqual(parsed.manifest.validation.map((v) => v.name), ['lint', 'test']);

  const stored = await loadStoredTask(root, result.taskId);
  assert.equal(stored.manifest.task_id, result.taskId);
  assert.equal(stored.files.find((f) => f.path === 'src/index.js').content, 'export const value = 2; // dirty state\n');
  assert.deepEqual((await listStoredTasks(root)).map((t) => t.taskId), [result.taskId]);

  const gitPath = (await runProcess('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: root })).stdout.trim();
  const excludePath = path.isAbsolute(gitPath) ? gitPath : path.join(root, gitPath);
  assert.match(await readFile(excludePath, 'utf8'), /^|\n\.agent-task-bridge\/\n/);
});

test('exportTask scans rendered metadata even when selected files are clean', async () => {
  const root = await makeRepo();
  const delegationPath = path.join(root, 'delegation.json');
  await writeFile(delegationPath, JSON.stringify({
    objective: 'Use the GitHub credential ghp_1234567890abcdefghijklmnopqrstuvwxyz1234 in the worker objective',
    work_unit: 'Update value behavior and tests',
    work_type: 'code',
    current_work_state: 'The selected source files contain no credentials.',
    deliverables: ['Implementation'],
    editable_scope: ['src/**'],
    acceptance_criteria: ['Keep ESM syntax'],
    non_goals: [],
    files: { editable: ['src/index.js'], reference: [], contract: [], validation: [], configuration: ['package.json'] }
  }, null, 2));

  await assert.rejects(
    () => exportTask({ repoRoot: root, delegationPath }),
    (error) => error?.code === 'PRIVACY_SCAN_BLOCKED'
  );
});

test('exportTask reports full-capsule estimates and enforces a token ceiling', async () => {
  const root = await makeRepo();
  const delegationPath = path.join(root, 'delegation.json');
  await writeFile(delegationPath, JSON.stringify({
    objective: 'Change the exported value',
    work_unit: 'Update value behavior and tests',
    work_type: 'code',
    current_work_state: 'The source is already dirty.',
    deliverables: ['Implementation'],
    editable_scope: ['src/**'],
    acceptance_criteria: ['Keep ESM syntax'],
    non_goals: [],
    files: { editable: ['src/index.js'], reference: [], contract: [], validation: [], configuration: ['package.json'] }
  }, null, 2));

  const result = await exportTask({ repoRoot: root, delegationPath });
  assert.ok(result.contextSummary.estimated_tokens > Math.ceil(result.contextSummary.embedded_bytes / 4));
  assert.ok(result.contextSummary.safety_margin_tokens > 0);
  assert.deepEqual(result.contextSummary.per_file.map((file) => file.path), ['package.json', 'src/index.js']);
  assert.ok(result.contextSummary.per_file.every((file) => file.estimated_tokens > 0));

  await assert.rejects(
    () => exportTask({ repoRoot: root, delegationPath, maxTokens: 10 }),
    (error) => error?.code === 'CONTEXT_TOKEN_BUDGET_EXCEEDED'
  );
});
