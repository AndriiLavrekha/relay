import { runProcess } from './process.mjs';

function parseNameStatus(output) {
  return output.split(/\r?\n/).filter(Boolean).map((line) => {
    const [status, ...rest] = line.split('\t');
    return { status, path: rest.join('\t') };
  });
}

export async function buildReviewData({ repoRoot, importReport, lifecycle, receipt, workerReport = null }) {
  let diffStat = 'No staging diff available.';
  let changedFiles = [];
  if (importReport?.stagingRoot && importReport?.currentHead) {
    const [stat, names] = await Promise.all([
      runProcess('git', ['diff', '--stat', importReport.currentHead, '--'], { cwd: importReport.stagingRoot, allowFailure: true }),
      runProcess('git', ['diff', '--name-status', importReport.currentHead, '--'], { cwd: importReport.stagingRoot, allowFailure: true }),
    ]);
    if (stat.code === 0 && stat.stdout.trim()) diffStat = stat.stdout.trim();
    if (names.code === 0) changedFiles = parseNameStatus(names.stdout);
  }
  const withheldFiles = (importReport?.conflicts ?? []).map((file) => file.path);
  const validation = importReport?.validation ?? null;
  const criteria = importReport?.acceptance?.criteria ?? [];
  const hasUnresolvedWorkerCriteria = criteria.some((criterion) => (
    criterion.status === 'unverified' || criterion.status === 'unmet' || criterion.status === 'blocked'
  ));
  const hasDeferredHostCriteria = criteria.some((criterion) => criterion.status === 'deferred_to_host');
  const partial = Boolean(
    importReport?.resultStatus === 'partial' || importReport?.resultStatus === 'blocked' || importReport?.resultStatus === 'research-only'
    || withheldFiles.length > 0 || validation?.blocked || validation?.skipped
    || hasUnresolvedWorkerCriteria
  );
  return {
    task: { taskId: importReport?.taskId ?? receipt?.taskId, sourceBaseCommit: importReport?.sourceBaseCommit },
    result: { status: importReport?.resultStatus ?? 'legacy', summary: importReport?.resultSummary ?? '' },
    lifecycle: lifecycle?.state ?? importReport?.lifecycle ?? null,
    diffStat,
    changedFiles,
    withheldFiles,
    drift: { repositoryBaseChanged: Boolean(importReport?.repositoryBaseChanged), sourceBaseCommit: importReport?.sourceBaseCommit, currentHead: importReport?.currentHead },
    privacy: importReport?.privacy ?? receipt?.privacy ?? null,
    validation,
    acceptance: importReport?.acceptance ?? null,
    activeTree: { before: importReport?.activeTreeBefore ?? null, after: importReport?.activeTreeAfter ?? null, modified: importReport?.activeWorktreeModifiedByImport ?? null },
    workerReport: workerReport ?? { present: false },
    deferredToHost: hasDeferredHostCriteria,
    hasDeferredSteps: hasDeferredHostCriteria,
    deferredHostSteps: criteria.filter((criterion) => criterion.status === 'deferred_to_host').map((criterion) => criterion.text),
    receipt,
    partial,
  };
}
