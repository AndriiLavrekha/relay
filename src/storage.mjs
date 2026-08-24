import crypto from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './process.mjs';
import { AtbError } from './errors.mjs';
import { parseTaskCapsule } from './task-capsule.mjs';

export function atbRoot(repoRoot) {
  return path.join(repoRoot, '.agent-task-bridge');
}

export async function assertSafeStorageRoot(repoRoot) {
  const root = atbRoot(repoRoot);
  try {
    const info = await lstat(root);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new AtbError('UNSAFE_STORAGE_ROOT', '.agent-task-bridge must be a real directory inside the repository, not a symlink or file');
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return root;
    throw error;
  }
  return root;
}

export async function ensureLocalStorageIgnored(repoRoot) {
  await assertSafeStorageRoot(repoRoot);
  const result = await runProcess('git', ['rev-parse', '--git-path', 'info/exclude'], { cwd: repoRoot });
  const value = result.stdout.trim();
  const excludePath = path.isAbsolute(value) ? value : path.resolve(repoRoot, value);
  let current = '';
  try { current = await readFile(excludePath, 'utf8'); } catch {}
  const line = '.agent-task-bridge/';
  if (!current.split(/\r?\n/).includes(line)) {
    const prefix = current && !current.endsWith('\n') ? '\n' : '';
    await writeFile(excludePath, `${current}${prefix}${line}\n`);
  }
  return excludePath;
}

export async function removeIsolatedStagingWorktree(repoRoot, stagingRoot) {
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

export async function loadStoredTask(repoRoot, taskId) {
  await assertSafeStorageRoot(repoRoot);
  const taskPath = path.join(atbRoot(repoRoot), 'tasks', taskId, 'task.md');
  let text;
  try { text = await readFile(taskPath, 'utf8'); }
  catch { throw new AtbError('TASK_NOT_FOUND', `Stored task not found: ${taskId}`); }
  return { ...parseTaskCapsule(text), capsuleText: text };
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

export async function listStoredTasks(repoRoot) {
  await assertSafeStorageRoot(repoRoot);
  const tasksDir = path.join(atbRoot(repoRoot), 'tasks');
  let names;
  try { names = await readdir(tasksDir, { withFileTypes: true }); }
  catch { return []; }
  const tasks = [];
  for (const entry of names) {
    if (!entry.isDirectory()) continue;
    try {
      const parsed = await loadStoredTask(repoRoot, entry.name);
      tasks.push({
        taskId: parsed.manifest.task_id,
        createdAt: parsed.manifest.created_at,
        title: parsed.manifest.work?.title ?? parsed.delegation.work_unit,
        sourceAgent: parsed.manifest.source_agent,
      });
    } catch {}
  }
  return tasks.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
}

export async function findImportArtifacts(repoRoot, importId) {
  await assertSafeStorageRoot(repoRoot);
  const tasksDir = path.join(atbRoot(repoRoot), 'tasks');
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
