import { copyFile, lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { AtbError } from './errors.mjs';
import { findImportArtifacts, atbRoot } from './storage.mjs';
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
    integrationRoot = await mkdtemp(path.join(parent, 'atb-integration-'));
    await rm(integrationRoot, { force: true, recursive: true });
    await runProcess('git', ['worktree', 'add', '-b', createdBranch, integrationRoot, 'HEAD']);
  }
  try {
    await applyReviewedFiles(report.stagingRoot, integrationRoot, report);
    const lifecycle = artifacts.lifecycle ?? await loadLifecycle(repoRoot, artifacts.taskId, importId);
    let nextLifecycle = lifecycle;
    if (nextLifecycle?.state === 'reviewed') {
      nextLifecycle = transitionLifecycle(nextLifecycle, 'integrated', { mode, branchName: createdBranch, integrationRoot });
      await writeLifecycle(repoRoot, nextLifecycle);
    }
    const integration = { mode, integrationRoot, branchName: createdBranch, files: report.stagedFiles ?? [], lifecycle: nextLifecycle };
    await writeFile(path.join(artifacts.directory, 'integration.json'), JSON.stringify(integration, null, 2), 'utf8');
    return integration;
  } catch (error) {
    if (mode === 'branch') await runProcess('git', ['worktree', 'remove', '--force', integrationRoot], { cwd: repoRoot, allowFailure: true });
    throw error;
  }
}
