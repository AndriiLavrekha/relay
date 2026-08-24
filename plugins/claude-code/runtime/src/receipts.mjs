import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AtbError } from './errors.mjs';
import { sha256Buffer, sha256Text } from './hash.mjs';
import { assertSafeStorageRoot, atbRoot } from './storage.mjs';

function safeId(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) throw new AtbError('UNSAFE_RECEIPT_ID', `Invalid receipt ${name}`);
  return value;
}

function summarizePrivacy(report) {
  const findings = report?.privacy?.findings ?? report?.privacyFindings ?? [];
  return {
    blocked: Boolean(report?.privacy?.blocked),
    requiresConfirmation: Boolean(report?.privacy?.requiresConfirmation),
    categories: [...new Set(findings.map((finding) => finding.category).filter(Boolean))],
    count: findings.length,
  };
}

export function createReceipt({ task, result, importReport, lifecycle, observedZipHash }) {
  const taskCapsule = task?.capsuleText ?? JSON.stringify(task?.manifest ?? {});
  const resultManifest = result?.manifest ?? {};
  return {
    receiptVersion: '1.0',
    createdAt: new Date().toISOString(),
    taskId: importReport?.taskId ?? task?.manifest?.task_id ?? resultManifest.task_id,
    importId: importReport?.importId,
    taskCapsuleSha256: sha256Text(taskCapsule),
    resultCapsuleSha256: observedZipHash ?? result?.archive_sha256 ?? null,
    sourceBaseCommit: resultManifest.source_base_commit ?? task?.manifest?.project?.base_commit ?? null,
    targetHead: importReport?.currentHead ?? null,
    lifecycle: lifecycle?.state ?? importReport?.lifecycle ?? null,
    workerClaims: {
      sourceAgent: resultManifest.source_agent ?? null,
      externalWorker: resultManifest.external_worker ?? null,
      model: resultManifest.model ?? null,
      status: resultManifest.status ?? 'legacy',
      validation: resultManifest.validation ?? null,
      acceptanceCriteria: resultManifest.acceptance_criteria ?? null,
    },
    localEvidence: {
      validation: importReport?.validation ?? null,
      acceptance: importReport?.acceptance ?? null,
      files: (importReport?.files ?? []).map(({ path: filePath, status, appliedToStaging }) => ({ path: filePath, status, appliedToStaging: Boolean(appliedToStaging) })),
      conflicts: importReport?.conflicts ?? [],
      activeWorktreeModifiedByImport: importReport?.activeWorktreeModifiedByImport ?? null,
      repositoryBaseChanged: importReport?.repositoryBaseChanged ?? null,
    },
    privacy: summarizePrivacy(importReport),
  };
}

export async function writeImmutableReceipt(repoRoot, taskId, importId, receipt) {
  safeId(taskId, 'task ID');
  safeId(importId, 'import ID');
  await assertSafeStorageRoot(repoRoot);
  const directory = path.join(atbRoot(repoRoot), 'tasks', taskId, 'imports', importId);
  await mkdir(directory, { recursive: true });
  const receiptPath = path.join(directory, 'receipt.json');
  try {
    await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') throw new AtbError('RECEIPT_EXISTS', `Receipt already exists for import: ${importId}`);
    throw error;
  }
  return receiptPath;
}
