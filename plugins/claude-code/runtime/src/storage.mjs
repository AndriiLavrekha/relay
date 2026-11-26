import crypto from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './process.mjs';
import { AtbError } from './errors.mjs';
import { parseTaskCapsule } from './task-capsule.mjs';

export const STORAGE_DIR = '.relay';
export const LEGACY_STORAGE_DIR = '.agent-task-bridge';

export function relayRoot(repoRoot) {
  return path.join(repoRoot, STORAGE_DIR);
}

export const atbRoot = relayRoot;

export function legacyAtbRoot(repoRoot) {
  return path.join(repoRoot, LEGACY_STORAGE_DIR);
}

export async function assertSafeStorageRoot(repoRoot, dirName = STORAGE_DIR) {
  const root = path.join(repoRoot, dirName);
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new AtbError('UNSAFE_STORAGE_ROOT', `${dirName} must be a real directory inside the repository, not a symlink or file`);
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return root;
    throw error;
  }
  return root;
}

export async function safeExistingStorageDir(repoRoot, dirName = STORAGE_DIR) {
  const root = await assertSafeStorageRoot(repoRoot, dirName);
  try {
    await lstat(root);
    return root;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function ensureLocalStorageIgnored(repoRoot) {
  await assertSafeStorageRoot(repoRoot);
  const result = await runProcess('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: repoRoot });
  const value = result.stdout.trim();
  const excludePath = path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
  let current = '';
  try { current = await readFile(excludePath, 'utf8'); } catch {}
  const line = `${STORAGE_DIR}/`;
  if (!current.split(/\r?\n/).includes(line)) {
    const prefix = current && !current.endsWith('\n') ? '\n' : '';
    await writeFile(excludePath, `${current}${prefix}${line}\n`);
  }
  return excludePath;
}

async function untrackedDirectories(cwd, extraArgs = []) {
  const listed = await runProcess('git', ['ls-files', '--others', '--directory', ...extraArgs, '-z'], { cwd, allowFailure: true });
  return listed.code === 0 ? listed.stdout.split('\0').filter(Boolean).map((entry) => entry.replaceAll('\\', '/').replace(/\/+$/, '')) : [];
}

// `git worktree remove --force` follows Windows junctions and deletes their targets (the active repo's
// node_modules). Detach every link first: untracked entries of the staging tree, plus the repository's
// ignored directories, which is where validation links dependencies.
async function detachStagingLinks(repoRoot, stagingRoot) {
  const candidates = new Set([
    ...await untrackedDirectories(stagingRoot),
    ...await untrackedDirectories(repoRoot, ['--ignored', '--exclude-standard']),
  ]);
  for (const relative of candidates) {
    const target = path.join(stagingRoot, ...relative.split('/'));
    const info = await lstat(target).catch(() => null);
    if (!info?.isSymbolicLink()) continue;
    await unlink(target).catch(() => rmdir(target));
  }
}

export async function removeIsolatedStagingWorktree(repoRoot, stagingRoot) {
  await detachStagingLinks(repoRoot, stagingRoot);
  await runProcess('git', ['worktree', 'remove', '--force', stagingRoot], { cwd: repoRoot });
  await rm(stagingRoot, { force: true, recursive: true });
}

function stagingOwnershipPath(repoRoot, stagingRoot) {
  const key = crypto.createHash('sha256').update(stagingRoot).digest('hex');
  return path.join(atbRoot(repoRoot), 'staging-ownership', `${key}.json`);
}

export async function registerIsolatedStagingWorktree(repoRoot, stagingRoot, stagingParent) {
  const [canonicalRepoRoot, canonicalStagingRoot, canonicalStagingParent] = await Promise.all([
    realpath(repoRoot),
    realpath(stagingRoot),
    realpath(stagingParent),
  ]);
  if (path.dirname(canonicalStagingRoot) !== canonicalStagingParent) {
    throw new AtbError('UNSAFE_STAGING_LOCATION', `Staging worktree is not directly contained by its staging parent: ${canonicalStagingRoot}`);
  }
  await assertSafeStorageRoot(canonicalRepoRoot);
  const ownershipPath = stagingOwnershipPath(canonicalRepoRoot, canonicalStagingRoot);
  await mkdir(path.dirname(ownershipPath), { recursive: true });
  await writeFile(ownershipPath, JSON.stringify({
    repoRoot: canonicalRepoRoot,
    stagingRoot: canonicalStagingRoot,
    stagingParent: canonicalStagingParent,
  }), 'utf8');
  return ownershipPath;
}

export async function loadIsolatedStagingOwnership(repoRoot, stagingRoot) {
  const canonicalRepoRoot = await realpath(repoRoot);
  await assertSafeStorageRoot(canonicalRepoRoot);
  const ownershipPath = stagingOwnershipPath(canonicalRepoRoot, stagingRoot);
  let value;
  try { value = await readFile(ownershipPath, 'utf8'); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
  try { return { ownershipPath, ...JSON.parse(value) }; }
  catch { return null; }
}

export async function removeIsolatedStagingOwnership(ownershipPath) {
  await rm(ownershipPath, { force: true });
}

export async function storeTask(repoRoot, taskId, capsuleText) {
  await ensureLocalStorageIgnored(repoRoot);
  const root = atbRoot(repoRoot);
  const exportDir = path.join(root, 'exports');
  const taskDir = path.join(root, 'tasks', taskId);
  await mkdir(exportDir, { recursive: true });
  await mkdir(taskDir, { recursive: true });
  const outputPath = path.join(exportDir, `task-${taskId}.md`);
  const taskPath = path.join(taskDir, 'task.md');
  await Promise.all([writeFile(outputPath, capsuleText, 'utf8'), writeFile(taskPath, capsuleText, 'utf8')]);
  return { outputPath, taskPath };
}

async function readTaskFromRoot(rootDir, taskId) {
  const taskPath = path.join(rootDir, 'tasks', taskId, 'task.md');
  const text = await readFile(taskPath, 'utf8');
  return { ...parseTaskCapsule(text), capsuleText: text };
}

export async function loadStoredTask(repoRoot, taskId) {
  // Task IDs reach here from untrusted result manifests; only a single safe path segment may name a stored task.
  if (typeof taskId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(taskId)) {
    throw new AtbError('UNSAFE_TASK_ID', `Task ID is not a safe stored-task name: ${String(taskId).slice(0, 80)}`);
  }
  await assertSafeStorageRoot(repoRoot, STORAGE_DIR);
  try {
    return await readTaskFromRoot(relayRoot(repoRoot), taskId);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const legacyDir = await safeExistingStorageDir(repoRoot, LEGACY_STORAGE_DIR);
  if (legacyDir) {
    try {
      return await readTaskFromRoot(legacyDir, taskId);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  throw new AtbError('TASK_NOT_FOUND', `Stored task not found: ${taskId}`);
}

export async function persistImportReport(repoRoot, { taskId = null, importId, report }) {
  await assertSafeStorageRoot(repoRoot);
  const importRoot = taskId
    ? path.join(atbRoot(repoRoot), 'tasks', taskId, 'imports', importId)
    : path.join(atbRoot(repoRoot), 'imports', importId);
  await mkdir(importRoot, { recursive: true });
  const reportPath = path.join(importRoot, 'report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return reportPath;
}

async function listTasksInDir(repoRoot, storageDirName, seenIds, tasks) {
  const storageDir = await safeExistingStorageDir(repoRoot, storageDirName);
  if (!storageDir) return;
  const tasksDir = path.join(storageDir, 'tasks');
  let names;
  try { names = await readdir(tasksDir, { withFileTypes: true }); }
  catch { return; }
  for (const entry of names) {
    if (!entry.isDirectory() || seenIds.has(entry.name)) continue;
    try {
      const parsed = await readTaskFromRoot(storageDir, entry.name);
      const id = parsed.manifest.task_id;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      tasks.push({
        taskId: id,
        createdAt: parsed.manifest.created_at,
        title: parsed.manifest.work?.title ?? parsed.delegation.work_unit,
        sourceAgent: parsed.manifest.source_agent,
      });
    } catch {}
  }
}

export async function listStoredTasks(repoRoot) {
  await assertSafeStorageRoot(repoRoot, STORAGE_DIR);
  const seenIds = new Set();
  const tasks = [];
  await listTasksInDir(repoRoot, STORAGE_DIR, seenIds, tasks);
  await listTasksInDir(repoRoot, LEGACY_STORAGE_DIR, seenIds, tasks);
  return tasks.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

async function findImportInDir(repoRoot, storageDirName, importId) {
  const storageDir = await safeExistingStorageDir(repoRoot, storageDirName);
  if (!storageDir) return null;
  const tasksDir = path.join(storageDir, 'tasks');
  let tasks;
  try { tasks = await readdir(tasksDir, { withFileTypes: true }); }
  catch { return null; }
  for (const task of tasks) {
    if (!task.isDirectory()) continue;
    const directory = path.join(tasksDir, task.name, 'imports', importId);
    try {
      const report = JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8'));
      const readJson = async (name) => { try { return JSON.parse(await readFile(path.join(directory, name), 'utf8')); } catch { return null; } };
      return { taskId: task.name, importId, directory, report, receipt: await readJson('receipt.json'), review: await readJson('review.json'), lifecycle: await readJson('lifecycle.json') };
    } catch {}
  }
  return null;
}

export async function findImportArtifacts(repoRoot, importId) {
  await assertSafeStorageRoot(repoRoot, STORAGE_DIR);
  const primary = await findImportInDir(repoRoot, STORAGE_DIR, importId);
  if (primary) return primary;
  const legacy = await findImportInDir(repoRoot, LEGACY_STORAGE_DIR, importId);
  if (!legacy) return null;
  // v1.x follow-up/integrate writes updated lifecycle.json to .relay/ while report/review remain in .agent-task-bridge/.
  try {
    const updated = JSON.parse(await readFile(path.join(relayRoot(repoRoot), 'tasks', legacy.taskId, 'imports', importId, 'lifecycle.json'), 'utf8'));
    return { ...legacy, lifecycle: updated };
  } catch {
    return legacy;
  }
}
