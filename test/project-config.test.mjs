import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { exportTask } from '../src/exporter.mjs';
import { importResult } from '../src/importer.mjs';
import { parseTaskCapsule } from '../src/task-capsule.mjs';
import { createZip } from '../src/zip.mjs';
import { readFile } from 'node:fs/promises';
import {
  applyExtraHostOwnedSteps,
  loadProjectConfig,
  parseProjectConfig,
  projectConfigPath,
  resolveMaxTokens,
  resolveValidationPolicy,
} from '../src/config.mjs';
import { DEFAULT_HOST_OWNED_STEPS, validateDelegationRequest } from '../src/delegation.mjs';

const delegation = {
  objective: 'Change the exported value',
  work_unit: 'Update value',
  work_type: 'code',
  editable_scope: ['src/**'],
  acceptance_criteria: ['Keep ESM syntax'],
  files: { editable: ['src/index.js'], configuration: ['package.json'] },
};

async function makeRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-config-'));
  await runProcess('git', ['init', '-b', 'main'], { cwd: root });
  await runProcess('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await runProcess('git', ['config', 'user.name', 'ATB Test'], { cwd: root });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', scripts: { test: 'node --test' } }));
  await writeFile(path.join(root, 'src', 'index.js'), 'export const value = 1;\n');
  await runProcess('git', ['add', '.'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

async function writeConfig(root, value) {
  const file = projectConfigPath(root);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
  return file;
}

test('a missing project config keeps the shipped defaults', async () => {
  const root = await makeRepo();
  const config = await loadProjectConfig(root);
  assert.equal(config.present, false);
  assert.equal(resolveMaxTokens(undefined, config), null);
  assert.equal(resolveValidationPolicy(undefined, config), 'safe');
  assert.deepEqual(applyExtraHostOwnedSteps({}, { host_owned_steps: [...DEFAULT_HOST_OWNED_STEPS] }, config).host_owned_steps, [...DEFAULT_HOST_OWNED_STEPS]);
});

test('project config rejects malformed values and unknown keys', () => {
  assert.equal(parseProjectConfig('{"maxTokens":80,"validationPolicy":"prompt","extraHostOwnedSteps":["Release checklist sign-off"]}').maxTokens, 80);
  assert.throws(() => parseProjectConfig('{'), /parse/i);
  assert.throws(() => parseProjectConfig('[]'), /object/i);
  assert.throws(() => parseProjectConfig('{"privacy":"allow"}'), /unknown/i);
  assert.throws(() => parseProjectConfig('{"maxTokens":0}'), /positive integer/i);
  assert.throws(() => parseProjectConfig('{"validationPolicy":"allow"}'), /validationPolicy/i);
  assert.throws(() => parseProjectConfig('{"extraHostOwnedSteps":[""]}'), /extraHostOwnedSteps/i);
});

test('export applies config defaults and lets explicit inputs win', async () => {
  const root = await makeRepo();
  await writeConfig(root, {
    maxTokens: 10,
    extraHostOwnedSteps: ['Release checklist sign-off', DEFAULT_HOST_OWNED_STEPS[0]],
  });
  const delegationPath = path.join(root, 'delegation.json');
  await writeFile(delegationPath, JSON.stringify(delegation));
  await assert.rejects(
    () => exportTask({ repoRoot: root, delegationPath }),
    (error) => error?.code === 'CONTEXT_TOKEN_BUDGET_EXCEEDED' && error.details.maxTokens === 10,
  );

  const relaxed = await exportTask({ repoRoot: root, delegationPath, maxTokens: 1_000_000 });
  const parsed = parseTaskCapsule(await readFile(relaxed.outputPath, 'utf8'));
  assert.equal(parsed.delegation.host_owned_steps.length, 4);
  assert.equal(parsed.delegation.host_owned_steps.at(-1), 'Release checklist sign-off');
  assert.deepEqual(relaxed.projectConfig.extraHostOwnedStepsApplied, ['Release checklist sign-off', DEFAULT_HOST_OWNED_STEPS[0]]);

  await writeFile(delegationPath, JSON.stringify({ ...delegation, host_owned_steps: [] }));
  const explicit = await exportTask({ repoRoot: root, delegationPath, maxTokens: 1_000_000 });
  const explicitCapsule = parseTaskCapsule(await readFile(explicit.outputPath, 'utf8'));
  assert.deepEqual(explicitCapsule.delegation.host_owned_steps, []);
  assert.deepEqual(explicit.projectConfig.extraHostOwnedStepsApplied, []);
});

test('import uses the configured validation policy unless the caller passes one', async () => {
  const root = await makeRepo();
  const delegationPath = path.join(root, 'delegation.json');
  await writeFile(delegationPath, JSON.stringify(delegation));
  const task = await exportTask({ repoRoot: root, delegationPath, maxTokens: 1_000_000 });
  await writeConfig(root, { validationPolicy: 'skip' });
  const zipPath = path.join(root, 'result.zip');
  await writeFile(zipPath, createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({
      atb_protocol: '1.0',
      capsule_type: 'result',
      task_id: task.taskId,
      source_base_commit: task.manifest.project.base_commit,
      result_type: 'code',
      summary: 'candidate',
      files: [{ path: 'src/index.js', operation: 'modify' }],
      validation: { executed: [], not_executed: [] },
      assumptions: [],
      unresolved: [],
    })) },
    { name: 'files/src/index.js', data: Buffer.from('export const value = 2;\n') },
  ]));

  const skipped = await importResult({ repoRoot: root, resultPath: zipPath });
  assert.equal(skipped.validation.policy, 'skip');
  assert.equal(skipped.validation.skipped, true);

  const forced = await importResult({ repoRoot: root, resultPath: zipPath, validationPolicy: 'safe' });
  assert.equal(forced.validation.policy, 'safe');
  assert.equal(forced.validation.skipped, false);
});

test('a symlinked project config is rejected', { skip: process.platform === 'win32' }, async () => {
  const root = await makeRepo();
  const outside = path.join(root, 'outside.json');
  await writeFile(outside, '{"validationPolicy":"skip"}');
  await mkdir(path.join(root, '.relay'), { recursive: true });
  await symlink(outside, projectConfigPath(root));
  await assert.rejects(() => loadProjectConfig(root), (error) => error?.code === 'INVALID_PROJECT_CONFIG');
  const delegationPath = path.join(root, 'delegation.json');
  await writeFile(delegationPath, JSON.stringify(delegation));
  await assert.rejects(() => exportTask({ repoRoot: root, delegationPath }), (error) => error?.code === 'INVALID_PROJECT_CONFIG');
});

test('delegation validation still owns an explicit host step list', () => {
  const validated = validateDelegationRequest({ ...delegation, host_owned_steps: ['Git commit, branch creation, and repository push'] });
  const applied = applyExtraHostOwnedSteps(
    { host_owned_steps: ['Git commit, branch creation, and repository push'] },
    validated,
    { extraHostOwnedSteps: ['Release checklist sign-off'] },
  );
  assert.deepEqual(applied.host_owned_steps, ['Git commit, branch creation, and repository push']);
});


test('project config accepts metricsRates and rejects malformed metricsRates', async () => {
  const parsed = parseProjectConfig(JSON.stringify({
    metricsRates: {
      'claude-opus-4': { input: 15, output: 75, cacheWrite5m: 18.75, cacheWrite1h: 30, cacheRead: 1.5 },
    },
  }));
  assert.equal(parsed.metricsRates['claude-opus-4'].input, 15);
  assert.equal(parsed.metricsRates['claude-opus-4'].cacheRead, 1.5);
  assert.throws(() => parseProjectConfig(JSON.stringify({ metricsRates: { bad: { input: -1, output: 1 } } })), /metricsRates/);
  assert.throws(() => parseProjectConfig(JSON.stringify({ metricsRates: { bad: { input: 1 } } })), /metricsRates/);
  assert.throws(() => parseProjectConfig(JSON.stringify({ metricsRates: { bad: { input: 1, output: 2, extra: 3 } } })), /metricsRates/);

  const root = await makeRepo();
  await writeConfig(root, { metricsRates: { 'claude-opus-4': { input: 15, output: 75 } } });
  const delegationPath = path.join(root, 'delegation.json');
  await writeFile(delegationPath, JSON.stringify(delegation));
  const exported = await exportTask({ repoRoot: root, delegationPath, maxTokens: 1_000_000 });
  assert.equal(exported.projectConfig.present, true);
});

test('loadProjectConfig falls back to legacy .agent-task-bridge/config.json and prefers .relay/config.json', async () => {
  const root = await makeRepo();
  await mkdir(path.join(root, '.agent-task-bridge'), { recursive: true });
  await writeFile(path.join(root, '.agent-task-bridge', 'config.json'), JSON.stringify({ maxTokens: 42000 }));
  const legacyLoaded = await loadProjectConfig(root);
  assert.equal(legacyLoaded.present, true);
  assert.equal(legacyLoaded.maxTokens, 42000);

  await writeConfig(root, { maxTokens: 90000 });
  const primaryLoaded = await loadProjectConfig(root);
  assert.equal(primaryLoaded.maxTokens, 90000);
});

test('resolveMaxTokens rejects invalid explicit values and parseMetricsRates rejects prototype keys', () => {
  assert.throws(() => resolveMaxTokens(true, {}), (error) => error?.code === 'INVALID_ARGUMENT');
  assert.throws(() => resolveMaxTokens('abc', {}), (error) => error?.code === 'INVALID_ARGUMENT');
  assert.throws(() => resolveMaxTokens(0, {}), (error) => error?.code === 'INVALID_ARGUMENT');
  assert.throws(() => resolveMaxTokens('-5', {}), (error) => error?.code === 'INVALID_ARGUMENT');
  assert.equal(resolveMaxTokens('4096', {}), 4096);
  assert.throws(() => parseProjectConfig('{"metricsRates":{"__proto__":{"input":1,"output":2}}}'), /metricsRates/);
});
