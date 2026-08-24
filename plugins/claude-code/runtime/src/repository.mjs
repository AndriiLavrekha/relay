import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { AtbError } from './errors.mjs';
import { runProcess } from './process.mjs';

export async function findGitRoot(startDir = process.cwd()) {
  const start = await realpath(startDir);
  const result = await runProcess('git', ['rev-parse', '--show-toplevel'], { cwd: start, allowFailure: true });
  if (result.code !== 0) throw new AtbError('NOT_GIT_REPOSITORY', `Not inside a Git repository: ${start}`);
  return path.resolve(result.stdout.trim());
}

export async function getGitState(repoRoot) {
  const [head, branch, status] = await Promise.all([
    runProcess('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }),
    runProcess('git', ['branch', '--show-current'], { cwd: repoRoot }),
    runProcess('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: repoRoot }),
  ]);
  return {
    head: head.stdout.trim(),
    branch: branch.stdout.trim() || null,
    dirty: status.stdout.length > 0,
    status: status.stdout,
  };
}
