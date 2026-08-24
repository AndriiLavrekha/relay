import { lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
  return parseTaskCapsule(text);
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
