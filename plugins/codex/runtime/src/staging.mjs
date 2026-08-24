import crypto from 'node:crypto';
import { mkdir, rm, copyFile, lstat, readFile, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from './process.mjs';
import {
  ensureLocalStorageIgnored,
  loadIsolatedStagingOwnership,
  registerIsolatedStagingWorktree,
  removeIsolatedStagingOwnership,
  removeIsolatedStagingWorktree,
} from './storage.mjs';
import { getGitState } from './repository.mjs';
import { AtbError, stagingLocationUnavailable, unsafeStagingLocation } from './errors.mjs';
import { sha256Buffer } from './hash.mjs';
import { normalizeRepoPath } from './path-safety.mjs';

async function existsInfo(file) {
  try { return await lstat(file); } catch { return null; }
}

function parseNullDelimitedPaths(output) {
  return output.split('\0').filter(Boolean);
}

function activeTreeEntryType(info) {
  if (info.isSymbolicLink()) return 'symlink';
  if (info.isFile()) return 'file';
  if (info.isDirectory()) return 'directory';
  return 'other';
}

function isBridgeMetadataPath(repoPath) {
  return repoPath === '.agent-task-bridge' || repoPath.startsWith('.agent-task-bridge/');
}

async function inspectActiveTreePath(repoRoot, repoPath) {
  const segments = repoPath.split('/');
  let filePath = repoRoot;
  for (let index = 0; index < segments.length; index++) {
    filePath = path.join(filePath, segments[index]);
    let info;
    try { info = await lstat(filePath); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    const type = activeTreeEntryType(info);
    if (type === 'symlink' || index === segments.length - 1) {
      const entry = {
        path: segments.slice(0, index + 1).join('/'),
        type,
        sizeBytes: info.size,
        sha256: null,
      };
      if (type === 'file') {
        const buffer = await readFile(filePath);
        entry.sizeBytes = buffer.length;
        entry.sha256 = sha256Buffer(buffer);
      }
      return entry;
    }
  }
  return null;
}

export async function fingerprintActiveTree(repoRoot) {
  const startedAt = performance.now();
  const [tracked, untracked] = await Promise.all([
    runProcess('git', ['ls-files', '-z'], { cwd: repoRoot }),
    runProcess('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: repoRoot }),
  ]);
  const paths = [...new Set([
    ...parseNullDelimitedPaths(tracked.stdout),
    ...parseNullDelimitedPaths(untracked.stdout),
  ])].filter((repoPath) => !isBridgeMetadataPath(repoPath)).sort();
  const entries = new Map();
  for (const repoPath of paths) {
    const entry = await inspectActiveTreePath(repoRoot, repoPath);
    if (entry) entries.set(entry.path, entry);
  }
  const files = [...entries.values()].sort((a, b) => {
    if (a.path < b.path) return -1;
    if (a.path > b.path) return 1;
    return 0;
  });
  return {
    pathSetHash: sha256Buffer(Buffer.from(JSON.stringify(files), 'utf8')),
    files,
    durationMs: performance.now() - startedAt,
  };
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
  let stagingRepoRoot;
  try {
    stagingRepoRoot = await realpath(repoRoot);
  } catch (error) {
    throw stagingLocationUnavailable(repoRoot, { candidate: requestedDir, cause: error?.message });
  }
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

export async function copySelectedWorkingPaths(sourceRoot, stagingRoot, selectedPaths) {
  if (!Array.isArray(selectedPaths)) throw new AtbError('UNSAFE_PATH', 'Selected working-tree paths must be an array');
  const copied = [];
  const excluded = [];
  const reparsePoints = [];
  for (const selectedPath of selectedPaths) {
    const repoPath = normalizeRepoPath(selectedPath);
    const source = path.join(sourceRoot, ...repoPath.split('/'));
    const target = path.join(stagingRoot, ...repoPath.split('/'));
    const [sourceInfo] = await Promise.all([
      inspectWorkingPath(sourceRoot, repoPath),
      inspectWorkingPath(stagingRoot, repoPath),
    ]);
    if (!sourceInfo) {
      await rm(target, { force: true, recursive: true });
      excluded.push(repoPath);
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    if (sourceInfo.isFile()) {
      await copyFile(source, target);
      copied.push(repoPath);
    }
  }
  return { copied, excluded, reparsePoints };
}

async function inspectWorkingPath(root, repoPath) {
  let rootInfo;
  try { rootInfo = await lstat(root); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
    throw new AtbError('UNSAFE_WORKING_TREE_PATH', `Working-tree root must be a real directory: ${root}`);
  }
  let current = root;
  let info;
  for (const segment of repoPath.split('/')) {
    current = path.join(current, segment);
    try { info = await lstat(current); }
    catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    if (info.isSymbolicLink()) {
      throw new AtbError('UNSAFE_WORKING_TREE_PATH', `Cannot reconstruct symbolic-link or reparse-point path: ${repoPath}`);
    }
  }
  return info;
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

const RESERVED_STAGING_TASK_IDS = new Set(['.git', '.agent-task-bridge']);
const WINDOWS_RESERVED_TASK_ID = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function validateStagingTaskId(taskId) {
  if (typeof taskId !== 'string'
    || taskId.length === 0
    || taskId !== taskId.trim()
    || taskId.endsWith('.')
    || taskId.endsWith(' ')
    || /[\0-\x1f<>:"/\\|?*]/.test(taskId)
    || taskId === '.'
    || taskId === '..'
    || RESERVED_STAGING_TASK_IDS.has(taskId.toLowerCase())
    || WINDOWS_RESERVED_TASK_ID.test(taskId)) {
    throw new AtbError('UNSAFE_TASK_ID', `Task ID must be a safe single staging-directory name: ${String(taskId)}`);
  }
  return taskId;
}

export async function createIsolatedStaging(repoRoot, taskId, { selectedPaths = [], stagingDir, targetHead } = {}) {
  const validatedTaskId = validateStagingTaskId(taskId);
  if (!Array.isArray(selectedPaths)) throw new AtbError('UNSAFE_PATH', 'Selected working-tree paths must be an array');
  const normalizedSelectedPaths = selectedPaths.map(normalizeRepoPath);
  await ensureLocalStorageIgnored(repoRoot);
  const git = await getGitState(repoRoot);
  const { parent: stagingParent } = await resolveStagingParent(repoRoot, stagingDir);
  await mkdir(stagingParent, { recursive: true });
  const stagingRoot = path.join(stagingParent, `${validatedTaskId}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`);
  await runProcess('git', ['worktree', 'add', '--detach', stagingRoot, targetHead ?? git.head], { cwd: repoRoot });

  let registered = false;
  try {
    await registerIsolatedStagingWorktree(repoRoot, stagingRoot, stagingParent);
    registered = true;
    const reconstruction = await copySelectedWorkingPaths(repoRoot, stagingRoot, normalizedSelectedPaths);
    return { stagingRoot, git, excludedWorkingTreePaths: reconstruction.excluded, reparsePoints: reconstruction.reparsePoints };
  } catch (error) {
    if (registered) await cleanupIsolatedStaging({ repoRoot, stagingRoot });
    else await removeIsolatedStagingWorktree(repoRoot, stagingRoot).catch(() => {});
    throw error;
  }
}

export async function cleanupIsolatedStaging({ repoRoot, stagingRoot }) {
  try {
    const validatedStagingRoot = await assertOutsideRepository(repoRoot, stagingRoot);
    const ownership = await loadIsolatedStagingOwnership(repoRoot, validatedStagingRoot);
    const validatedStagingParent = ownership?.stagingParent
      ? await assertOutsideRepository(repoRoot, ownership.stagingParent)
      : null;
    const canonicalRepoRoot = await realpath(repoRoot);
    if (!ownership
      || ownership.repoRoot !== canonicalRepoRoot
      || ownership.stagingRoot !== validatedStagingRoot
      || path.dirname(validatedStagingRoot) !== validatedStagingParent) {
      throw unsafeStagingLocation(`Staging worktree is not registered within the trusted ownership boundary: ${validatedStagingRoot}`);
    }
    await removeIsolatedStagingWorktree(repoRoot, validatedStagingRoot);
    await removeIsolatedStagingOwnership(ownership.ownershipPath);
    return { removed: true, errors: [] };
  } catch (error) {
    return { removed: false, errors: [{ code: error?.code ?? 'STAGING_CLEANUP_FAILED', message: error?.message ?? String(error) }] };
  }
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
