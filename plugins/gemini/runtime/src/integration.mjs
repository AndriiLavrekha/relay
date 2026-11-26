import { copyFile, lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { AtbError } from './errors.mjs';
import { assertSafeStorageRoot, findImportArtifacts, atbRoot } from './storage.mjs';
import { fingerprintActiveTree } from './staging.mjs';
import { getGitState } from './repository.mjs';
import { runProcess } from './process.mjs';
import { loadLifecycle, transitionLifecycle, writeLifecycle } from './lifecycle.mjs';

function comparableFingerprint(value) {
  return { pathSetHash: value?.pathSetHash ?? null, files: value?.files ?? [] };
}

function validateBranchName(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) || value.includes('..') || value.endsWith('/') || value.endsWith('.')) {
    throw new AtbError('INVALID_BRANCH_NAME', `Invalid integration branch name: ${value}`);
  }
  return value;
}

async function assertSafeTarget(root, repoPath) {
  let current = root;
  for (const segment of repoPath.split('/')) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) throw new AtbError('UNSAFE_INTEGRATION_PATH', `Integration path crosses a symlink: ${repoPath}`);
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function applyReviewedFiles(sourceRoot, targetRoot, report) {
  const staged = new Set(report.stagedFiles ?? []);
  for (const file of report.files ?? []) {
    if (!staged.has(file.path)) continue;
    await assertSafeTarget(targetRoot, file.path);
    const target = path.join(targetRoot, ...file.path.split('/'));
    if (file.operation === 'delete') {
      await rm(target, { force: true, recursive: true });
      continue;
    }
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(sourceRoot, ...file.path.split('/')), target);
  }
}

export async function integrateImport({ repoRoot, importId, mode = 'branch', branchName, confirmed = false }) {
  if (!confirmed) throw new AtbError('INTEGRATION_CONFIRMATION_REQUIRED', 'Integration requires explicit confirmation');
  if (!['branch', 'in-place'].includes(mode)) throw new AtbError('INVALID_INTEGRATION_MODE', `Unsupported integration mode: ${mode}`);
  const artifacts = await findImportArtifacts(repoRoot, importId);
  if (!artifacts) throw new AtbError('IMPORT_NOT_FOUND', `Import not found: ${importId}`);
  const report = artifacts.report;
  if (report.lifecycle !== 'reviewed' || !report.stagingRoot) throw new AtbError('INTEGRATION_NOT_REVIEWED', 'Import must have a retained reviewed staging worktree');
  if (report.currentHead !== (await getGitState(repoRoot)).head) throw new AtbError('INTEGRATION_HEAD_CHANGED', 'Target HEAD changed since import review');
  const currentFingerprint = await fingerprintActiveTree(repoRoot);
  if (!isDeepStrictEqual(comparableFingerprint(currentFingerprint), comparableFingerprint(report.activeTreeAfter ?? report.activeTreeBefore))) {
    throw new AtbError('INTEGRATION_ACTIVE_TREE_CHANGED', 'Active worktree changed since import review');
  }

  let integrationRoot = repoRoot;
  let createdBranch = null;
  if (mode === 'branch') {
    createdBranch = validateBranchName(branchName);
    const existing = await runProcess('git', ['show-ref', '--verify', '--quiet', `refs/heads/${createdBranch}`], { cwd: repoRoot, allowFailure: true });
    if (existing.code === 0) throw new AtbError('INTEGRATION_BRANCH_EXISTS', `Integration branch already exists: ${createdBranch}`);
    const parent = report.stagingRoot ? path.dirname(report.stagingRoot) : os.tmpdir();
    integrationRoot = await mkdtemp(path.join(parent, 'relay-integration-'));
    await rm(integrationRoot, { force: true, recursive: true });
    await runProcess('git', ['worktree', 'add', '-b', createdBranch, integrationRoot, 'HEAD'], { cwd: repoRoot });
  }
  try {
    await applyReviewedFiles(report.stagingRoot, integrationRoot, report);
    // Branch mode commits on the new branch and drops the temporary worktree; on commit failure the worktree stays for manual finishing.
    let commit = null;
    if (mode === 'branch') {
      commit = await commitIntegrationBranch(integrationRoot, report);
      if (commit.sha) {
        await runProcess('git', ['worktree', 'remove', integrationRoot], { cwd: repoRoot, allowFailure: true });
        integrationRoot = null;
      }
    }
    const lifecycle = await loadLifecycle(repoRoot, artifacts.taskId, importId) ?? artifacts.lifecycle;
    let nextLifecycle = lifecycle;
    if (nextLifecycle?.state === 'reviewed') {
      nextLifecycle = transitionLifecycle(nextLifecycle, 'integrated', { mode, branchName: createdBranch, integrationRoot, commit: commit?.sha ?? null });
      await writeLifecycle(repoRoot, nextLifecycle);
    }
    const integration = { mode, integrationRoot, branchName: createdBranch, commit: commit?.sha ?? null, commitError: commit?.error ?? null, files: report.stagedFiles ?? [], lifecycle: nextLifecycle };
    await assertSafeStorageRoot(repoRoot);
    const integrationDir = path.join(atbRoot(repoRoot), 'tasks', artifacts.taskId, 'imports', importId);
    await mkdir(integrationDir, { recursive: true });
    await writeFile(path.join(integrationDir, 'integration.json'), JSON.stringify(integration, null, 2), 'utf8');
    return integration;
  } catch (error) {
    if (mode === 'branch' && integrationRoot) await runProcess('git', ['worktree', 'remove', '--force', integrationRoot], { cwd: repoRoot, allowFailure: true });
    throw error;
  }
}

async function commitIntegrationBranch(root, report) {
  const paths = report.stagedFiles ?? [];
  if (paths.length === 0) return { sha: null, error: 'No staged files to commit' };
  await runProcess('git', ['add', '-A', '--', ...paths], { cwd: root });
  const message = `relay: integrate ${report.taskId ?? 'task'} (${report.importId ?? 'import'})`;
  const committed = await runProcess('git', ['commit', '-m', message], { cwd: root, allowFailure: true });
  if (committed.code !== 0) return { sha: null, error: (committed.stderr || committed.stdout).trim().slice(-2000) };
  return { sha: (await runProcess('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim(), error: null };
}
