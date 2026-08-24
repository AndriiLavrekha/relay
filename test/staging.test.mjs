import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { assertOutsideRepository, resolveStagingParent } from '../src/staging.mjs';

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

test('resolveStagingParent returns a path outside the repository', async (t) => {
  const repo = await makeRepo(t);
  const { parent } = await resolveStagingParent(repo);
  assert.equal(isPathInside(repo, parent), false);
});

test('resolveStagingParent rejects an explicit staging directory inside the repository', async (t) => {
  const repo = await makeRepo(t);
  await assert.rejects(
    () => resolveStagingParent(repo, path.join(repo, '.agent-task-bridge-staging')),
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
  assert.equal(result.parent, path.join(fixture.physicalFixture, '.agent-task-bridge-staging'));
});

test('resolveStagingParent derives a canonical fallback root on the non-Windows branch', { skip: process.platform !== 'win32' }, async (t) => {
  const fixture = await makeCrossDriveRepoAlias(t);
  if (!fixture) return;
  const descriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  t.after(() => Object.defineProperty(process, 'platform', descriptor));
  Object.defineProperty(process, 'platform', { ...descriptor, value: 'linux' });
  const result = await resolveStagingParent(fixture.alias);
  assert.equal(result.source, 'same-volume-fallback');
  assert.equal(result.parent, path.join(fixture.physicalFixture, '.agent-task-bridge-staging'));
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
