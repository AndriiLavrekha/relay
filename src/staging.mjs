import crypto from 'node:crypto';
import { mkdir, rm, copyFile, lstat, readlink, realpath, stat, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from './process.mjs';
import { atbRoot, ensureLocalStorageIgnored } from './storage.mjs';
import { getGitState } from './repository.mjs';
import { stagingLocationUnavailable, unsafeStagingLocation } from './errors.mjs';

async function existsInfo(file) {
  try { return await lstat(file); } catch { return null; }
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function realpathWithMissingTail(candidate) {
  let current = path.resolve(candidate);
  const tail = [];
  while (true) {
    try {
      return path.join(await realpath(current), ...tail);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(current);
      if (parent === current) return current;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

async function assertRealDirectoryPath(candidate) {
  const resolvedCandidate = path.resolve(candidate);
  const parsed = path.parse(resolvedCandidate);
  const relative = path.relative(parsed.root, resolvedCandidate);
  const segments = relative ? relative.split(path.sep) : [];
  let current = parsed.root;

  for (const segment of segments) {
    current = path.join(current, segment);
    let info;
    try { info = await lstat(current); }
    catch (error) {
      if (error?.code === 'ENOENT') return resolvedCandidate;
      throw error;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw unsafeStagingLocation(`Staging directory must be a real directory, not a file, symlink, junction, or reparse point: ${current}`);
    }
  }
  return resolvedCandidate;
}

export async function assertOutsideRepository(repoRoot, candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) {
    throw unsafeStagingLocation('Staging directory must be a non-empty path outside the repository');
  }
  const lexicalCandidate = await assertRealDirectoryPath(candidate);
  const [resolvedRepoRoot, resolvedCandidate] = await Promise.all([
    realpath(repoRoot),
    realpathWithMissingTail(lexicalCandidate),
  ]);
  if (isPathInside(resolvedRepoRoot, resolvedCandidate)) {
    throw unsafeStagingLocation(`Staging directory must be outside the repository: ${resolvedCandidate}`);
  }
  return resolvedCandidate;
}

async function prepareStagingParent(repoRoot, candidate) {
  try {
    const resolvedCandidate = await assertOutsideRepository(repoRoot, candidate);
    await mkdir(resolvedCandidate, { recursive: true });
    return await assertOutsideRepository(repoRoot, resolvedCandidate);
  } catch (error) {
    if (error?.code === 'UNSAFE_STAGING_LOCATION' || error?.code === 'STAGING_LOCATION_UNAVAILABLE') throw error;
    throw stagingLocationUnavailable(repoRoot, { candidate, cause: error?.message });
  }
}

async function isSameFilesystem(repoRoot, candidate) {
  if (process.platform === 'win32') {
    return path.parse(path.resolve(repoRoot)).root.toLowerCase() === path.parse(path.resolve(candidate)).root.toLowerCase();
  }
  const [repoInfo, candidateInfo] = await Promise.all([stat(repoRoot), stat(candidate)]);
  return repoInfo.dev === candidateInfo.dev;
}

export async function resolveStagingParent(repoRoot, requestedDir = undefined) {
  const stagingRepoRoot = process.platform === 'win32' ? await realpath(repoRoot) : repoRoot;
  if (requestedDir !== undefined) {
    const parent = await prepareStagingParent(stagingRepoRoot, requestedDir);
    return { parent, source: 'explicit' };
  }

  try {
    const parent = await prepareStagingParent(stagingRepoRoot, tmpdir());
    if (await isSameFilesystem(stagingRepoRoot, parent)) return { parent, source: 'temp' };
  } catch {}

  const fallback = path.join(path.dirname(stagingRepoRoot), '.agent-task-bridge-staging');
  try {
    const parent = await prepareStagingParent(stagingRepoRoot, fallback);
    if (await isSameFilesystem(stagingRepoRoot, parent)) return { parent, source: 'same-volume-fallback' };
  } catch (error) {
    if (error?.code === 'UNSAFE_STAGING_LOCATION') throw error;
  }

  throw stagingLocationUnavailable(stagingRepoRoot);
}

async function copyWorkingPath(sourceRoot, stagingRoot, repoPath) {
  const source = path.join(sourceRoot, ...repoPath.split('/'));
  const target = path.join(stagingRoot, ...repoPath.split('/'));
  const info = await existsInfo(source);
  if (!info) { await rm(target, { force: true, recursive: true }); return; }
  await mkdir(path.dirname(target), { recursive: true });
  if (info.isSymbolicLink()) {
    await rm(target, { force: true, recursive: true });
    await symlink(await readlink(source), target);
  } else if (info.isFile()) {
    await copyFile(source, target);
  }
}

function splitNul(value) {
  return value.split('\0').filter(Boolean);
}

export async function isSafeStagingPath(stagingRoot, repoPath) {
  const segments = repoPath.split('/');
  let current = stagingRoot;
  for (let i = 0; i < segments.length; i++) {
    current = path.join(current, segments[i]);
    const info = await existsInfo(current);
    if (!info) return true;
    if (info.isSymbolicLink()) return false;
    if (i < segments.length - 1 && !info.isDirectory()) return false;
  }
  return true;
}

export async function createIsolatedStaging(repoRoot, taskId) {
  await ensureLocalStorageIgnored(repoRoot);
  const git = await getGitState(repoRoot);
  const stagingParent = path.join(atbRoot(repoRoot), 'staging');
  await mkdir(stagingParent, { recursive: true });
  const stagingRoot = path.join(stagingParent, `${taskId}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`);
  await runProcess('git', ['worktree', 'add', '--detach', stagingRoot, git.head], { cwd: repoRoot });

  // Reconstruct the exact active working tree on top of the detached worktree.
  const tracked = splitNul((await runProcess('git', ['ls-files', '-z'], { cwd: repoRoot })).stdout);
  for (const repoPath of tracked) await copyWorkingPath(repoRoot, stagingRoot, repoPath.replaceAll('\\', '/'));
  const untracked = splitNul((await runProcess('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: repoRoot })).stdout);
  for (const repoPath of untracked) await copyWorkingPath(repoRoot, stagingRoot, repoPath.replaceAll('\\', '/'));
  return { stagingRoot, git };
}

export async function applyStagedFile(stagingRoot, file) {
  const target = path.join(stagingRoot, ...file.path.split('/'));
  if (file.operation === 'delete') {
    await rm(target, { force: true, recursive: true });
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await rm(target, { force: true, recursive: true });
  await import('node:fs/promises').then(({ writeFile }) => writeFile(target, file.content, 'utf8'));
}
