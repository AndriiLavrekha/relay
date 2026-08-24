import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { assertOutsideRepository, resolveStagingParent } from '../src/staging.mjs';

async function makeRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-staging-repo-'));
  await runProcess('git', ['init', '-b', 'main'], { cwd: root });
  await runProcess('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await runProcess('git', ['config', 'user.name', 'ATB Staging Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# staging fixture\n');
  await runProcess('git', ['add', 'README.md'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

test('resolveStagingParent returns a path outside the repository', async () => {
  const repo = await makeRepo();
  const { parent } = await resolveStagingParent(repo);
  assert.equal(isPathInside(repo, parent), false);
});

test('resolveStagingParent rejects an explicit staging directory inside the repository', async () => {
  const repo = await makeRepo();
  await assert.rejects(
    () => resolveStagingParent(repo, path.join(repo, '.agent-task-bridge-staging')),
    (error) => error.code === 'UNSAFE_STAGING_LOCATION'
  );
});

test('resolveStagingParent creates and returns an explicit external directory', async () => {
  const repo = await makeRepo();
  const requestedDir = path.join(path.dirname(repo), 'atb-explicit-staging');
  const result = await resolveStagingParent(repo, requestedDir);
  const info = await lstat(requestedDir);
  assert.equal(result.parent, path.resolve(requestedDir));
  assert.equal(result.source, 'explicit');
  assert.equal(info.isDirectory(), true);
});

test('assertOutsideRepository rejects an existing file as a staging parent', async () => {
  const repo = await makeRepo();
  const file = path.join(path.dirname(repo), 'atb-staging-file');
  await writeFile(file, 'not a directory\n');
  await assert.rejects(
    () => assertOutsideRepository(repo, file),
    (error) => error.code === 'UNSAFE_STAGING_LOCATION'
  );
});

test('assertOutsideRepository rejects a symbolic-link staging parent', { skip: process.platform === 'win32' }, async () => {
  const repo = await makeRepo();
  const target = await mkdtemp(path.join(tmpdir(), 'atb-staging-target-'));
  const link = path.join(path.dirname(repo), 'atb-staging-link');
  await symlink(target, link);
  await assert.rejects(
    () => assertOutsideRepository(repo, link),
    (error) => error.code === 'UNSAFE_STAGING_LOCATION'
  );
});
