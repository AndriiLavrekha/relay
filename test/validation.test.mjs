import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { discoverValidationCommands, runValidation } from '../src/validation.mjs';
import { formatImportReport } from '../src/reporting.mjs';

async function makeProject(scripts) {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-validation-'));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'validation-fixture', scripts }, null, 2));
  return root;
}

test('discoverValidationCommands returns supported npm scripts in deterministic order', async () => {
  const root = await makeProject({ build: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"', typecheck: 'node -e "process.exit(0)"', 'format:check': 'node -e "process.exit(0)"' });
  const commands = await discoverValidationCommands(root);
  assert.deepEqual(commands.map((c) => c.name), ['format', 'lint', 'typecheck', 'test', 'build']);
  assert.deepEqual(commands.find((c) => c.name === 'test').args, ['test']);
  assert.deepEqual(commands.find((c) => c.name === 'lint').args, ['run', 'lint']);
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
    conflicts: [{ path: 'src/b.js', status: 'LOCAL_CHANGED' }], validation: { passed: true, partial: true, results: [{ name: 'test', status: 'PASS', exitCode: 0 }] }, activeWorktreeModifiedByImport: false
  });
  assert.match(text, /atb_x/);
  assert.match(text, /LOCAL_CHANGED/);
  assert.match(text, /test: PASS/);
  assert.match(text, /No changes have been applied to the active worktree/i);
});
