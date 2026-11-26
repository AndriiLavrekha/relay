import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { sha256Buffer } from '../src/hash.mjs';
import * as staging from '../src/staging.mjs';

const { assertOutsideRepository, cleanupIsolatedStaging, copySelectedWorkingPaths, createIsolatedStaging, resolveStagingParent } = staging;

async function makeTempDir(t, prefix) {
  return makeTempDirAt(t, tmpdir(), prefix);
}

async function makeTempDirAt(t, parent, prefix) {
  const root = await mkdtemp(path.join(parent, prefix));
  t.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

async function initializeRepo(root) {
  await runProcess('git', ['init', '-b', 'main'], { cwd: root });
  await runProcess('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await runProcess('git', ['config', 'user.name', 'ATB Staging Test'], { cwd: root });
  await writeFile(path.join(root, 'README.md'), '# staging fixture\n');
  await runProcess('git', ['add', 'README.md'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

async function makeRepo(t) {
  return initializeRepo(await makeTempDir(t, 'atb-staging-repo-'));
}

async function makeRepoWithDirtyFiles(t) {
  const root = await makeRepo(t);
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'notes'));
  await writeFile(path.join(root, 'src', 'selected.js'), 'export const value = "base";\n');
  await writeFile(path.join(root, 'src', 'deleted.js'), 'export const deleted = true;\n');
  await runProcess('git', ['add', 'src'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'add fixture files'], { cwd: root });
  await writeFile(path.join(root, 'src', 'selected.js'), 'export const value = "dirty";\n');
  await unlink(path.join(root, 'src', 'deleted.js'));
  await writeFile(path.join(root, 'notes', 'selected.md'), 'selected context\n');
  await writeFile(path.join(root, 'notes', 'unrelated.md'), 'unrelated context\n');
  return { root };
}

async function exists(file) {
  try {
    await lstat(file);
    return true;
  } catch {
    return false;
  }
}

async function makeCrossDriveRepoAlias(t) {
  const physicalDrive = path.parse(process.cwd()).root;
  const aliasDrive = path.parse(tmpdir()).root;
  if (physicalDrive.toLowerCase() === aliasDrive.toLowerCase()) {
    t.skip(`Distinct-drive fixture unavailable: repository and temporary directory both use ${physicalDrive}`);
    return null;
  }
  let physicalFixture;
  try {
    physicalFixture = await makeTempDirAt(t, path.dirname(process.cwd()), '.atb-staging-drive-');
  } catch (error) {
    t.skip(`Cannot create a writable external same-drive fixture: ${error.message}`);
    return null;
  }
  assert.equal(isPathInside(process.cwd(), physicalFixture), false);
  const repo = path.join(physicalFixture, 'repo');
  await mkdir(repo);
  await initializeRepo(repo);
  const alias = path.join(await makeTempDir(t, 'atb-staging-drive-alias-'), 'repo-alias');
  try {
    await symlink(repo, alias, 'junction');
  } catch (error) {
    t.skip(`Windows cannot create a cross-drive repository junction fixture: ${error.message}`);
    return null;
  }
  return { alias, physicalDrive, physicalFixture };
}

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function fingerprintIdentity({ pathSetHash, files }) {
  return { pathSetHash, files };
}

test('fingerprintActiveTree deterministically records Git-visible regular files', async (t) => {
  const root = await makeRepo(t);
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, '.ignored'));
  await mkdir(path.join(root, '.relay'));
  await mkdir(path.join(root, '.agent-task-bridge'));
  await writeFile(path.join(root, '.gitignore'), '.ignored/\n');
  await writeFile(path.join(root, 'src', 'untracked.txt'), 'visible\n');
  await writeFile(path.join(root, '.ignored', 'private.txt'), 'ignored\n');
  await writeFile(path.join(root, '.relay', 'local.json'), '{}\n');
  await writeFile(path.join(root, '.agent-task-bridge', 'legacy.json'), '{}\n');

  const before = await staging.fingerprintActiveTree(root);
  const after = await staging.fingerprintActiveTree(root);

  assert.deepEqual(fingerprintIdentity(after), fingerprintIdentity(before));
  assert.deepEqual(before.files.map((file) => file.path), ['.gitignore', 'README.md', 'src/untracked.txt']);
  assert.deepEqual(before.files.find((file) => file.path === 'src/untracked.txt'), {
    path: 'src/untracked.txt',
    type: 'file',
    sizeBytes: Buffer.byteLength('visible\n'),
    sha256: sha256Buffer(Buffer.from('visible\n')),
  });
  assert.equal(before.files.some((file) => file.path.startsWith('.ignored/')), false);
  assert.equal(before.files.some((file) => file.path.startsWith('.relay/')), false);
  assert.equal(before.files.some((file) => file.path.startsWith('.agent-task-bridge/')), false);
  assert.equal(typeof before.durationMs, 'number');
});

test('fingerprintActiveTree changes when a tracked file changes', async (t) => {
  const root = await makeRepo(t);
  const before = await staging.fingerprintActiveTree(root);
  await writeFile(path.join(root, 'README.md'), '# changed\n');
  const after = await staging.fingerprintActiveTree(root);
  assert.notDeepEqual(fingerprintIdentity(after), fingerprintIdentity(before));
});

test('fingerprintActiveTree changes when a non-ignored untracked file changes', async (t) => {
  const root = await makeRepo(t);
  await writeFile(path.join(root, 'untracked.txt'), 'before\n');
  const before = await staging.fingerprintActiveTree(root);
  await writeFile(path.join(root, 'untracked.txt'), 'after\n');
  const after = await staging.fingerprintActiveTree(root);
  assert.notDeepEqual(fingerprintIdentity(after), fingerprintIdentity(before));
});

test('fingerprintActiveTree ignores mutations to ignored files', async (t) => {
  const root = await makeRepo(t);
  await writeFile(path.join(root, '.gitignore'), 'ignored.txt\n');
  await runProcess('git', ['add', '.gitignore'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'ignore fixture'], { cwd: root });
  await writeFile(path.join(root, 'ignored.txt'), 'before\n');
  const before = await staging.fingerprintActiveTree(root);
  await writeFile(path.join(root, 'ignored.txt'), 'after\n');
  const after = await staging.fingerprintActiveTree(root);
  assert.deepEqual(fingerprintIdentity(after), fingerprintIdentity(before));
});

test('fingerprintActiveTree records Git-visible symlink metadata without reading its target', async (t) => {
  const root = await makeRepo(t);
  const external = await makeTempDir(t, 'atb-fingerprint-link-target-');
  const target = process.platform === 'win32' ? external : path.join(external, 'target.txt');
  const targetFile = process.platform === 'win32' ? path.join(external, 'target.txt') : target;
  const link = path.join(root, process.platform === 'win32' ? 'linked' : 'linked.txt');
  const linkPath = process.platform === 'win32' ? 'linked' : 'linked.txt';
  await writeFile(targetFile, 'before\n');
  try {
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'file');
  } catch (error) {
    t.skip(`Platform cannot create a symlink/reparse fingerprint fixture: ${error.message}`);
    return;
  }

  const before = await staging.fingerprintActiveTree(root);
  const linkInfo = await lstat(link);
  const entry = before.files.find((file) => file.path === linkPath);

  assert.deepEqual(entry, {
    path: linkPath,
    type: 'symlink',
    sizeBytes: linkInfo.size,
    sha256: null,
  });
  await writeFile(targetFile, 'after\n');
  const after = await staging.fingerprintActiveTree(root);
  assert.deepEqual(fingerprintIdentity(after), fingerprintIdentity(before));
});

test('resolveStagingParent returns a path outside the repository', async (t) => {
  const repo = await makeRepo(t);
  const { parent } = await resolveStagingParent(repo);
  assert.equal(isPathInside(repo, parent), false);
});

test('createIsolatedStaging rejects unsafe task IDs before creating a worktree', async (t) => {
  const root = await makeRepo(t);
  const externalRoot = await makeTempDir(t, 'atb-task-id-staging-');
  const stagingDir = await makeTempDirAt(t, externalRoot, 'staging-');
  const worktreesBefore = (await runProcess('git', ['worktree', 'list', '--porcelain'], { cwd: root })).stdout;
  const externalEntriesBefore = await readdir(externalRoot);
  const unsafeTaskIds = [
    '../task-id-escape',
    path.resolve(externalRoot, 'task-id-absolute'),
    'task-id\0nul',
    '.git',
    '.relay',
    '.agent-task-bridge',
  ];

  try {
    for (const taskId of unsafeTaskIds) {
      await assert.rejects(
        () => createIsolatedStaging(root, taskId, { stagingDir }),
        (error) => error.code === 'UNSAFE_TASK_ID'
      );
    }
    assert.equal((await runProcess('git', ['worktree', 'list', '--porcelain'], { cwd: root })).stdout, worktreesBefore);
    assert.deepEqual(await readdir(externalRoot), externalEntriesBefore);
    assert.equal(await exists(path.join(root, '.relay')), false);
  } finally {
    const worktreesAfter = (await runProcess('git', ['worktree', 'list', '--porcelain'], { cwd: root })).stdout;
    const createdWorktrees = worktreesAfter
      .split(/\r?\n/)
      .filter((line) => line.startsWith('worktree '))
      .map((line) => line.slice('worktree '.length))
      .filter((worktree) => worktree !== root && isPathInside(externalRoot, worktree));
    for (const worktree of createdWorktrees) {
      await runProcess('git', ['worktree', 'remove', '--force', worktree], { cwd: root, allowFailure: true });
    }
  }
});

test('createIsolatedStaging excludes unrelated untracked files', async (t) => {
  const { root } = await makeRepoWithDirtyFiles(t);
  const stagingDir = await makeTempDir(t, 'atb-external-staging-');
  const result = await createIsolatedStaging(root, 'atb_test', {
    selectedPaths: ['src/selected.js', 'notes/selected.md'],
    stagingDir,
  });
  try {
    assert.equal(await exists(path.join(result.stagingRoot, 'src', 'selected.js')), true);
    assert.equal(await readFile(path.join(result.stagingRoot, 'src', 'selected.js'), 'utf8'), 'export const value = "dirty";\n');
    assert.equal(await exists(path.join(result.stagingRoot, 'notes', 'selected.md')), true);
    assert.equal(await exists(path.join(result.stagingRoot, 'notes', 'unrelated.md')), false);
  } finally {
    await runProcess('git', ['worktree', 'remove', '--force', result.stagingRoot], { cwd: root, allowFailure: true });
  }
});

test('createIsolatedStaging removes selected locally deleted files', async (t) => {
  const { root } = await makeRepoWithDirtyFiles(t);
  const stagingDir = await makeTempDir(t, 'atb-external-staging-');
  const result = await createIsolatedStaging(root, 'atb_deleted', {
    selectedPaths: ['src/deleted.js'],
    stagingDir,
  });
  try {
    assert.equal(await exists(path.join(result.stagingRoot, 'src', 'deleted.js')), false);
    assert.deepEqual(result.excludedWorkingTreePaths, ['src/deleted.js']);
  } finally {
    await runProcess('git', ['worktree', 'remove', '--force', result.stagingRoot], { cwd: root, allowFailure: true });
  }
});

test('copySelectedWorkingPaths rejects selected symbolic links and reparse points', async (t) => {
  const root = await makeRepo(t);
  const target = await makeTempDir(t, 'atb-reparse-target-');
  const linked = path.join(root, 'linked');
  try {
    await symlink(target, linked, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`Platform cannot create a reparse-point fixture: ${error.message}`);
    return;
  }
  const stagingRoot = await makeTempDir(t, 'atb-reparse-staging-');
  await assert.rejects(
    () => copySelectedWorkingPaths(root, stagingRoot, ['linked']),
    (error) => error.code === 'UNSAFE_WORKING_TREE_PATH'
  );
});

test('copySelectedWorkingPaths copies regular files byte-for-byte', async (t) => {
  const root = await makeRepo(t);
  const stagingRoot = await makeTempDir(t, 'atb-copy-staging-');
  await mkdir(path.join(root, 'assets'));
  const contents = Buffer.from([0, 1, 2, 255, 0, 42]);
  await writeFile(path.join(root, 'assets', 'binary.bin'), contents);

  const result = await copySelectedWorkingPaths(root, stagingRoot, ['assets/binary.bin']);
  assert.deepEqual(await readFile(path.join(stagingRoot, 'assets', 'binary.bin')), contents);
  assert.deepEqual(result, { copied: ['assets/binary.bin'], excluded: [], reparsePoints: [] });
});

test('copySelectedWorkingPaths rejects traversal before it reaches staging', async (t) => {
  const root = await makeRepo(t);
  const stagingRoot = await makeTempDir(t, 'atb-copy-staging-');
  const marker = path.join(path.dirname(stagingRoot), 'outside.txt');
  await writeFile(marker, 'keep\n');

  await assert.rejects(
    () => copySelectedWorkingPaths(root, stagingRoot, ['../outside.txt']),
    (error) => error.code === 'UNSAFE_PATH'
  );
  assert.equal(await readFile(marker, 'utf8'), 'keep\n');
});

test('copySelectedWorkingPaths rejects absolute selected paths', async (t) => {
  const root = await makeRepo(t);
  const stagingRoot = await makeTempDir(t, 'atb-copy-staging-');

  await assert.rejects(
    () => copySelectedWorkingPaths(root, stagingRoot, [path.join(path.dirname(root), 'outside.txt')]),
    (error) => error.code === 'UNSAFE_PATH'
  );
});

test('copySelectedWorkingPaths rejects a selected source path beneath a reparse ancestor', async (t) => {
  const root = await makeRepo(t);
  const external = await makeTempDir(t, 'atb-external-source-');
  await writeFile(path.join(external, 'outside.txt'), 'outside\n');
  try {
    await symlink(external, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`Platform cannot create a reparse-point fixture: ${error.message}`);
    return;
  }
  const stagingRoot = await makeTempDir(t, 'atb-copy-staging-');

  await assert.rejects(
    () => copySelectedWorkingPaths(root, stagingRoot, ['linked/outside.txt']),
    (error) => error.code === 'UNSAFE_WORKING_TREE_PATH'
  );
  assert.equal(await exists(path.join(stagingRoot, 'linked', 'outside.txt')), false);
});

test('copySelectedWorkingPaths rejects a selected target path beneath a reparse ancestor', async (t) => {
  const root = await makeRepo(t);
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'inside.txt'), 'inside\n');
  const stagingRoot = await makeTempDir(t, 'atb-copy-staging-');
  const external = await makeTempDir(t, 'atb-external-target-');
  try {
    await symlink(external, path.join(stagingRoot, 'src'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`Platform cannot create a reparse-point fixture: ${error.message}`);
    return;
  }

  await assert.rejects(
    () => copySelectedWorkingPaths(root, stagingRoot, ['src/inside.txt']),
    (error) => error.code === 'UNSAFE_WORKING_TREE_PATH'
  );
  assert.equal(await exists(path.join(external, 'inside.txt')), false);
});

test('copySelectedWorkingPaths does not treat non-ENOENT filesystem errors as selected deletions', async (t) => {
  const stagingRoot = await makeTempDir(t, 'atb-copy-staging-');
  const marker = path.join(stagingRoot, 'selected.txt');
  await writeFile(marker, 'keep\n');

  await assert.rejects(
    () => copySelectedWorkingPaths('\0', stagingRoot, ['selected.txt']),
    (error) => error.code === 'ERR_INVALID_ARG_VALUE'
  );
  assert.equal(await readFile(marker, 'utf8'), 'keep\n');
});

test('createIsolatedStaging removes its worktree when selected reconstruction fails', async (t) => {
  const root = await makeRepo(t);
  const stagingDir = await makeTempDir(t, 'atb-external-staging-');
  const external = await makeTempDir(t, 'atb-external-source-');
  await writeFile(path.join(external, 'outside.txt'), 'outside\n');
  try {
    await symlink(external, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`Platform cannot create a reparse-point fixture: ${error.message}`);
    return;
  }

  try {
    await assert.rejects(
      () => createIsolatedStaging(root, 'atb_rollback', { selectedPaths: ['linked/outside.txt'], stagingDir }),
      (error) => error.code === 'UNSAFE_WORKING_TREE_PATH'
    );
    assert.deepEqual(await readdir(stagingDir), []);
  } finally {
    for (const entry of await readdir(stagingDir)) {
      await runProcess('git', ['worktree', 'remove', '--force', path.join(stagingDir, entry)], { cwd: root, allowFailure: true });
    }
  }
});

test('createIsolatedStaging validates selected paths before registering a worktree', async (t) => {
  const root = await makeRepo(t);
  const stagingDir = await makeTempDir(t, 'atb-external-staging-');
  try {
    await assert.rejects(
      () => createIsolatedStaging(root, 'atb_invalid_path', { selectedPaths: ['../outside.txt'], stagingDir }),
      (error) => error.code === 'UNSAFE_PATH'
    );
    assert.deepEqual(await readdir(stagingDir), []);
  } finally {
    for (const entry of await readdir(stagingDir)) {
      await runProcess('git', ['worktree', 'remove', '--force', path.join(stagingDir, entry)], { cwd: root, allowFailure: true });
    }
  }
});

test('cleanupIsolatedStaging removes the registered external worktree', async (t) => {
  const root = await makeRepo(t);
  const stagingDir = await makeTempDir(t, 'atb-external-staging-');
  const { stagingRoot } = await createIsolatedStaging(root, 'atb_cleanup', { stagingDir });
  const result = await cleanupIsolatedStaging({ repoRoot: root, stagingRoot });
  assert.deepEqual(result, { removed: true, errors: [] });
  assert.equal(await exists(stagingRoot), false);
});

test('cleanupIsolatedStaging leaves an unregistered directory intact', async (t) => {
  const root = await makeRepo(t);
  const stagingRoot = await makeTempDir(t, 'atb-unregistered-staging-');
  const marker = path.join(stagingRoot, 'keep.txt');
  await writeFile(marker, 'keep\n');

  const result = await cleanupIsolatedStaging({ repoRoot: root, stagingRoot });
  assert.equal(result.removed, false);
  assert.equal(result.errors.length, 1);
  assert.equal(await exists(marker), true);
});

test('cleanupIsolatedStaging preserves an unrelated registered external worktree', async (t) => {
  const root = await makeRepo(t);
  const externalParent = await makeTempDir(t, 'atb-unrelated-worktree-');
  const stagingRoot = path.join(externalParent, 'unrelated');
  await runProcess('git', ['worktree', 'add', '--detach', stagingRoot, 'HEAD'], { cwd: root });
  try {
    const result = await cleanupIsolatedStaging({ repoRoot: root, stagingRoot });
    assert.equal(result.removed, false);
    assert.equal(await exists(path.join(stagingRoot, 'README.md')), true);
  } finally {
    await runProcess('git', ['worktree', 'remove', '--force', stagingRoot], { cwd: root, allowFailure: true });
  }
});

test('cleanupIsolatedStaging rejects a staging path inside the repository', async (t) => {
  const root = await makeRepo(t);
  const stagingRoot = path.join(root, 'not-staging');
  await mkdir(stagingRoot);
  const marker = path.join(stagingRoot, 'keep.txt');
  await writeFile(marker, 'keep\n');

  const result = await cleanupIsolatedStaging({ repoRoot: root, stagingRoot });
  assert.equal(result.removed, false);
  assert.equal(result.errors[0].code, 'UNSAFE_STAGING_LOCATION');
  assert.equal(await exists(marker), true);
});

test('createIsolatedStaging uses the requested external staging parent', async (t) => {
  const root = await makeRepo(t);
  const stagingDir = await makeTempDir(t, 'atb-external-staging-');
  const { stagingRoot } = await createIsolatedStaging(root, 'atb_external', { stagingDir });
  try {
    assert.equal(isPathInside(root, stagingRoot), false);
    assert.equal(path.dirname(stagingRoot), stagingDir);
  } finally {
    await runProcess('git', ['worktree', 'remove', '--force', stagingRoot], { cwd: root, allowFailure: true });
  }
});

test('createIsolatedStaging uses targetHead for the detached worktree', async (t) => {
  const root = await makeRepo(t);
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src', 'target.js'), 'export const value = "target";\n');
  await runProcess('git', ['add', 'src/target.js'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'add target version'], { cwd: root });
  const targetHead = (await runProcess('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  await writeFile(path.join(root, 'src', 'target.js'), 'export const value = "current";\n');
  await runProcess('git', ['add', 'src/target.js'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'add current version'], { cwd: root });
  const stagingDir = await makeTempDir(t, 'atb-external-staging-');
  const { stagingRoot } = await createIsolatedStaging(root, 'atb_target', { stagingDir, targetHead });
  try {
    assert.equal((await readFile(path.join(stagingRoot, 'src', 'target.js'), 'utf8')).trim(), 'export const value = "target";');
  } finally {
    await runProcess('git', ['worktree', 'remove', '--force', stagingRoot], { cwd: root, allowFailure: true });
  }
});

test('resolveStagingParent rejects an explicit staging directory inside the repository', async (t) => {
  const repo = await makeRepo(t);
  await assert.rejects(
    () => resolveStagingParent(repo, path.join(repo, '.relay-staging')),
    (error) => error.code === 'UNSAFE_STAGING_LOCATION'
  );
});

test('resolveStagingParent creates and returns an explicit external directory', async (t) => {
  const repo = await makeRepo(t);
  const requestedDir = path.join(await makeTempDir(t, 'atb-explicit-staging-'), 'staging');
  const result = await resolveStagingParent(repo, requestedDir);
  const info = await lstat(requestedDir);
  assert.equal(result.parent, path.resolve(requestedDir));
  assert.equal(result.source, 'explicit');
  assert.equal(info.isDirectory(), true);
});

test('assertOutsideRepository rejects an existing file as a staging parent', async (t) => {
  const repo = await makeRepo(t);
  const file = path.join(await makeTempDir(t, 'atb-staging-file-'), 'staging');
  await writeFile(file, 'not a directory\n');
  await assert.rejects(
    () => assertOutsideRepository(repo, file),
    (error) => error.code === 'UNSAFE_STAGING_LOCATION'
  );
});

test('resolveStagingParent wraps an unusable explicit staging path', async (t) => {
  const repo = await makeRepo(t);
  await assert.rejects(
    () => resolveStagingParent(repo, '\0'),
    (error) => error.code === 'STAGING_LOCATION_UNAVAILABLE'
  );
});

test('resolveStagingParent wraps an unresolved repository root for an explicit parent', async (t) => {
  const fixture = await makeTempDir(t, 'atb-staging-missing-repo-');
  await assert.rejects(
    () => resolveStagingParent(path.join(fixture, 'missing-repo'), path.join(fixture, 'staging')),
    (error) => error.code === 'STAGING_LOCATION_UNAVAILABLE'
  );
});

test('assertOutsideRepository rejects a physical repository child through a repository alias', async (t) => {
  const repo = await makeRepo(t);
  const alias = path.join(await makeTempDir(t, 'atb-staging-repo-alias-'), 'repo-alias');
  try {
    await symlink(repo, alias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`Platform cannot create a repository alias fixture: ${error.message}`);
    return;
  }
  await assert.rejects(
    () => assertOutsideRepository(alias, path.join(repo, 'physical-staging')),
    (error) => error.code === 'UNSAFE_STAGING_LOCATION'
  );
});

test('resolveStagingParent uses the physical repository drive through a Windows junction alias', { skip: process.platform !== 'win32' }, async (t) => {
  const fixture = await makeCrossDriveRepoAlias(t);
  if (!fixture) return;
  const result = await resolveStagingParent(fixture.alias);
  assert.equal(result.source, 'same-volume-fallback');
  assert.equal(path.parse(result.parent).root.toLowerCase(), fixture.physicalDrive.toLowerCase());
  assert.equal(result.parent, path.join(fixture.physicalFixture, '.relay-staging'));
});

test('resolveStagingParent derives a canonical fallback root on the non-Windows branch', { skip: process.platform !== 'win32' }, async (t) => {
  const fixture = await makeCrossDriveRepoAlias(t);
  if (!fixture) return;
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  t.after(() => Object.defineProperty(process, 'platform', descriptor));
  Object.defineProperty(process, 'platform', { ...descriptor, value: 'linux' });
  const result = await resolveStagingParent(fixture.alias);
  assert.equal(result.source, 'same-volume-fallback');
  assert.equal(result.parent, path.join(fixture.physicalFixture, '.relay-staging'));
});

test('assertOutsideRepository rejects a symbolic-link staging parent', { skip: process.platform === 'win32' }, async (t) => {
  const repo = await makeRepo(t);
  const target = await makeTempDir(t, 'atb-staging-target-');
  const link = path.join(await makeTempDir(t, 'atb-staging-link-'), 'staging');
  await symlink(target, link);
  await assert.rejects(
    () => assertOutsideRepository(repo, link),
    (error) => error.code === 'UNSAFE_STAGING_LOCATION'
  );
});

test('assertOutsideRepository rejects a Windows junction staging parent', { skip: process.platform !== 'win32' }, async (t) => {
  const repo = await makeRepo(t);
  const fixture = await makeTempDir(t, 'atb-staging-junction-');
  const target = path.join(fixture, 'target');
  const junction = path.join(fixture, 'junction');
  await mkdir(target);
  try {
    await symlink(target, junction, 'junction');
  } catch (error) {
    t.skip(`Windows cannot create an unprivileged junction fixture: ${error.message}`);
    return;
  }
  await assert.rejects(
    () => assertOutsideRepository(repo, junction),
    (error) => error.code === 'UNSAFE_STAGING_LOCATION'
  );
});
