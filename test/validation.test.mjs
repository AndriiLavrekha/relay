import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { buildValidationEnvironment, captureValidationSnapshot, discoverValidationCommands, runValidation, validationConfigChanged } from '../src/validation.mjs';
import { runProcess } from '../src/process.mjs';
import { formatImportReport } from '../src/reporting.mjs';

async function makeProject(scripts) {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-validation-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'validation-fixture', scripts }, null, 2));
  await runProcess('git', ['init', '-b', 'main'], { cwd: root });
  return root;
}

test('discoverValidationCommands returns supported npm scripts in deterministic order', async () => {
  const root = await makeProject({ build: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"', typecheck: 'node -e "process.exit(0)"', 'format:check': 'node -e "process.exit(0)"' });
  const commands = await discoverValidationCommands(root);
  assert.deepEqual(commands.map((c) => c.name), ['format', 'lint', 'typecheck', 'test', 'build']);
  const testArgs = commands.find((c) => c.name === 'test').args;
  const lintArgs = commands.find((c) => c.name === 'lint').args;
  if (process.platform === 'win32') {
    assert.deepEqual(testArgs.slice(-2), ['npm.cmd', 'test']);
    assert.deepEqual(lintArgs.slice(-3), ['npm.cmd', 'run', 'lint']);
  } else {
    assert.deepEqual(testArgs, ['test']);
    assert.deepEqual(lintArgs, ['run', 'lint']);
  }
});

test('discoverValidationCommands resolves npm command shims on Windows', async () => {
  const root = await makeProject({ test: 'node --test' });
  const command = (await discoverValidationCommands(root)).find((item) => item.name === 'test');
  if (process.platform === 'win32') {
    assert.match(command.command, /(?:cmd|command)\.exe$/i);
    assert.deepEqual(command.args.slice(-2), ['npm.cmd', 'test']);
  } else {
    assert.equal(command.command, 'npm');
    assert.deepEqual(command.args, ['test']);
  }
});

test('runValidation captures pass and fail results without hiding later checks', async () => {
  const root = await makeProject({});
  const result = await runValidation(root, [
    { name: 'pass', command: process.execPath, args: ['-e', 'console.log("ok")'] },
    { name: 'fail', command: process.execPath, args: ['-e', 'console.error("bad"); process.exit(3)'] },
    { name: 'later', command: process.execPath, args: ['-e', 'console.log("later")'] },
  ]);
  assert.deepEqual(result.results.map((r) => r.status), ['PASS', 'FAIL', 'PASS']);
  assert.equal(result.passed, false);
  assert.match(result.results[0].stdout, /ok/);
  assert.equal(result.results[1].exitCode, 3);
  assert.match(result.results[2].stdout, /later/);
});

test('formatImportReport exposes conflicts, validation and active-worktree safety', () => {
  const text = formatImportReport({
    taskId: 'atb_x', sourceBaseCommit: 'a'.repeat(40), currentHead: 'b'.repeat(40), repositoryBaseChanged: true,
    stagingRoot: '/tmp/stage', stagedFiles: ['src/a.js'], files: [{ path: 'src/a.js', status: 'CLEAN_UNCHANGED' }, { path: 'src/b.js', status: 'LOCAL_CHANGED' }],
    conflicts: [{ path: 'src/b.js', status: 'LOCAL_CHANGED' }], validation: { passed: true, partial: true, blocked: false, results: [{ name: 'test', status: 'PASS', exitCode: 0 }] }, activeWorktreeModifiedByImport: false
  });
  assert.match(text, /atb_x/);
  assert.match(text, /LOCAL_CHANGED/);
  assert.match(text, /test: PASS/);
  assert.match(text, /No changes have been applied to the active worktree/i);
});

test('formatImportReport explains when validation is blocked by changed configuration', () => {
  const text = formatImportReport({
    taskId: 'atb_x', sourceBaseCommit: 'a'.repeat(40), currentHead: 'b'.repeat(40), repositoryBaseChanged: false,
    stagingRoot: '/tmp/stage', files: [], conflicts: [],
    validation: { passed: null, blocked: true, reason: 'VALIDATION_CONFIG_CHANGED', results: [] }, activeWorktreeModifiedByImport: false
  });
  assert.match(text, /Validation blocked/i);
  assert.match(text, /VALIDATION_CONFIG_CHANGED/);
});

test('buildValidationEnvironment removes credential variables and redirects home', async () => {
  const root = await makeProject({});
  const previous = {
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    NPM_TOKEN: process.env.NPM_TOKEN,
    SLACK_TOKEN: process.env.SLACK_TOKEN,
  };
  Object.assign(process.env, {
    OPENAI_API_KEY: 'openai-secret-value',
    AWS_ACCESS_KEY_ID: 'aws-secret-value',
    NPM_TOKEN: 'npm-secret-value',
    SLACK_TOKEN: 'slack-secret-value',
  });
  try {
    const environment = await buildValidationEnvironment({ repoRoot: root, policy: 'safe' });
    const child = await runProcess(process.execPath, ['-e', 'console.log(JSON.stringify({openai:!!process.env.OPENAI_API_KEY,aws:!!process.env.AWS_ACCESS_KEY_ID,npm:!!process.env.NPM_TOKEN,slack:!!process.env.SLACK_TOKEN,home:process.env.HOME||process.env.USERPROFILE}))'], {
      env: environment.env,
      envMode: 'provided',
      allowFailure: true,
    });
    const observed = JSON.parse(child.stdout);
    assert.deepEqual(observed, { openai: false, aws: false, npm: false, slack: false, home: environment.home });
    assert.ok(environment.removedNames.includes('OPENAI_API_KEY'));
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('runValidation supports prompt confirmation and skip policies without spawning', async () => {
  const root = await makeProject({});
  await assert.rejects(
    () => runValidation(root, [{ name: 'test', command: process.execPath, args: ['-e', 'process.exit(1)'] }], { policy: 'prompt' }),
    (error) => error?.code === 'VALIDATION_CONFIRMATION_REQUIRED'
  );
  const skipped = await runValidation(root, [{ name: 'test', command: process.execPath, args: ['-e', 'process.exit(1)'] }], { policy: 'skip' });
  assert.deepEqual(skipped, { passed: null, policy: 'skip', skipped: true, results: [] });
});

test('validationConfigChanged detects nested monorepo configuration changes', async () => {
  const root = await makeProject({});
  await mkdir(path.join(root, 'packages', 'api'), { recursive: true });
  await writeFile(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  await writeFile(path.join(root, 'packages', 'api', 'package.json'), JSON.stringify({ name: '@fixture/api' }));
  await writeFile(path.join(root, 'packages', 'api', 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const snapshot = await captureValidationSnapshot(root);
  assert.ok(snapshot.config.files['packages/api/package.json']);
  await writeFile(path.join(root, 'packages', 'api', 'package.json'), JSON.stringify({ name: '@fixture/api', private: true }));
  const changed = await validationConfigChanged(root, snapshot);
  assert.equal(changed.changed, true);
  assert.ok(changed.paths.includes('packages/api/package.json'));
});

test('runValidation reports timeout and bounded output metadata', async () => {
  const root = await makeProject({});
  const result = await runValidation(root, [
    { name: 'timeout', command: process.execPath, args: ['-e', 'console.log("x".repeat(1000)); setTimeout(() => {}, 5000)'] },
  ], { timeoutMs: 50, maxOutputBytes: 32 });
  assert.equal(result.passed, false);
  assert.equal(result.results[0].status, 'TIMEOUT');
  assert.equal(result.results[0].timedOut, true);
  assert.equal(result.results[0].stdoutTruncated, true);
  assert.ok(Buffer.byteLength(result.results[0].stdout) <= 32);
  assert.ok(result.results[0].killMethod);
});
