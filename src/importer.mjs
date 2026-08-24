import crypto from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { findGitRoot, getGitState } from './repository.mjs';
import { loadStoredTask, atbRoot } from './storage.mjs';
import { inspectResultCapsule } from './result-capsule.mjs';
import { sha256Buffer } from './hash.mjs';
import { classifyDrift } from './drift.mjs';
import { createIsolatedStaging, applyStagedFile, isSafeStagingPath } from './staging.mjs';
import { AtbError } from './errors.mjs';
import { captureValidationSnapshot, runValidation, validationConfigChanged } from './validation.mjs';

async function currentState(repoRoot, repoPath) {
  const full = path.join(repoRoot, ...repoPath.split('/'));
  try {
    const info = await stat(full);
    if (!info.isFile()) return { exists: true, sha256: null };
    const buffer = await readFile(full);
    return { exists: true, sha256: sha256Buffer(buffer) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, sha256: null };
    throw error;
  }
}

async function saveCandidate(candidateRoot, file) {
  if (file.operation === 'delete' || file.content === null) return null;
  const target = path.join(candidateRoot, ...file.path.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, file.content, 'utf8');
  return target;
}

export async function importResult({ repoRoot, resultPath }) {
  const root = repoRoot ? await findGitRoot(repoRoot) : await findGitRoot(process.cwd());
  const result = await inspectResultCapsule(path.resolve(resultPath));
  const task = await loadStoredTask(root, result.manifest.task_id);
  const taskBase = task.manifest.project?.base_commit;
  if (result.manifest.source_base_commit !== taskBase) {
    throw new AtbError('RESULT_BASE_MISMATCH', `Result source base commit does not match stored task baseline (${result.manifest.source_base_commit} != ${taskBase})`);
  }
  const baseline = new Map(task.files.map((file) => [file.path, file]));
  const currentGit = await getGitState(root);
  const validationSnapshot = await captureValidationSnapshot(root);
  const fileReports = [];
  for (const file of result.files) {
    const current = await currentState(root, file.path);
    const status = classifyDrift({ path: file.path, operation: file.operation, baseline, current, editableScope: task.delegation.editable_scope ?? [] });
    fileReports.push({ path: file.path, operation: file.operation, status, current });
  }

  const { stagingRoot } = await createIsolatedStaging(root, result.manifest.task_id, {
    selectedPaths: task.files.map((file) => file.path),
  });
  const importId = `import_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const importRoot = path.join(atbRoot(root), 'tasks', result.manifest.task_id, 'imports', importId);
  const candidateRoot = path.join(importRoot, 'candidates');
  await mkdir(candidateRoot, { recursive: true });
  const stagedFiles = [];
  for (let i = 0; i < result.files.length; i++) {
    const file = result.files[i];
    let status = fileReports[i].status;
    if ((status === 'CLEAN_UNCHANGED' || status === 'NEW_EXPECTED') && !(await isSafeStagingPath(stagingRoot, file.path))) {
      status = 'UNSAFE_SYMLINK_PATH';
      fileReports[i].status = status;
    }
    if (status === 'CLEAN_UNCHANGED' || status === 'NEW_EXPECTED') {
      await applyStagedFile(stagingRoot, file);
      stagedFiles.push(file.path);
      fileReports[i].appliedToStaging = true;
    } else {
      fileReports[i].candidatePath = await saveCandidate(candidateRoot, file);
      fileReports[i].appliedToStaging = false;
    }
  }
  const report = {
    protocol: '1.0',
    taskId: result.manifest.task_id,
    importId,
    sourceAgent: task.manifest.source_agent,
    sourceBaseCommit: taskBase,
    currentHead: currentGit.head,
    repositoryBaseChanged: currentGit.head !== taskBase,
    stagingRoot,
    candidateRoot,
    resultSummary: result.manifest.summary ?? '',
    files: fileReports,
    stagedFiles,
    conflicts: fileReports.filter((file) => !file.appliedToStaging).map((file) => ({ path: file.path, status: file.status })),
    validation: null,
    activeWorktreeModifiedByImport: false,
  };
  if (await validationConfigChanged(stagingRoot, validationSnapshot)) {
    report.validation = {
      passed: null,
      blocked: true,
      reason: 'VALIDATION_CONFIG_CHANGED',
      results: [],
    };
  } else {
    report.validation = await runValidation(stagingRoot, validationSnapshot.commands);
    report.validation.blocked = false;
  }
  report.validation.partial = report.conflicts.length > 0;
  await mkdir(importRoot, { recursive: true });
  const reportPath = path.join(importRoot, 'report.json');
  report.reportPath = reportPath;
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8');
  return report;
}
