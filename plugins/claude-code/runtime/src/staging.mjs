import crypto from 'node:crypto';
import { mkdir, rm, copyFile, lstat, readlink, symlink, unlink } from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './process.mjs';
import { atbRoot, ensureLocalStorageIgnored } from './storage.mjs';
import { getGitState } from './repository.mjs';

async function existsInfo(file) {
  try { return await lstat(file); } catch { return null; }
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
