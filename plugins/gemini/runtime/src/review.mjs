import { runProcess } from './process.mjs';

const BRIEF_OUTPUT_LINES = 30;

function tail(text, lines = BRIEF_OUTPUT_LINES) {
  const all = String(text ?? '').trimEnd().split(/\r?\n/);
  return all.slice(-lines).join('\n');
}

// Compact review for the host agent: decisions and failures only, not full validation logs.
export function briefReview(review, importReport = null) {
  const files = importReport?.files ?? [];
  const validation = review?.validation ?? null;
  const criteria = review?.acceptance?.criteria ?? [];
  const withheld = files.filter((file) => !file.appliedToStaging).map((file) => ({
    path: file.path,
    status: file.status,
    ...(file.elision ? { elision: file.elision } : {}),
    ...(file.merge ? { merge: file.merge } : {}),
    ...(file.candidatePath ? { candidatePath: file.candidatePath } : {}),
  }));
  let next = 'Inspect the staged diff, then integrate with explicit confirmation.';
  if (validation?.passed === false) next = 'Validation failed: inspect the failing command output before integrating.';
  else if (withheld.length) next = 'Resolve withheld files (merge conflicts, suspected elision, scope) before integrating, or use follow-up.';
  else if (review?.partial) next = 'Result is partial: run deferred host steps and consider follow-up for unresolved criteria.';
  return {
    importId: importReport?.importId ?? review?.receipt?.importId ?? null,
    taskId: review?.task?.taskId ?? null,
    resultStatus: review?.result?.status ?? null,
    summary: review?.result?.summary ?? '',
    lifecycle: review?.lifecycle ?? null,
    partial: Boolean(review?.partial),
    transport: importReport?.transport ?? null,
    drift: review?.drift ?? null,
    activeWorktreeModified: review?.activeTree?.modified ?? importReport?.activeWorktreeModifiedByImport ?? null,
    stagingRoot: importReport?.stagingRoot ?? null,
    diffStat: review?.diffStat ?? null,
    staged: files.filter((file) => file.appliedToStaging).map((file) => ({ path: file.path, status: file.status, ...(file.eolNormalized ? { eolNormalized: true } : {}), ...(file.elision ? { elision: file.elision } : {}) })),
    withheld,
    validation: validation && {
      passed: validation.passed ?? null,
      blocked: Boolean(validation.blocked),
      ...(validation.reason ? { reason: validation.reason } : {}),
      partial: Boolean(validation.partial),
      dependencyLinks: validation.dependencyLinks ?? [],
      results: (validation.results ?? []).map((result) => ({
        name: result.name,
        status: result.status,
        exitCode: result.exitCode ?? null,
        ...(result.status === 'PASS' ? {} : { outputTail: tail(`${result.stdout ?? ''}\n${result.stderr ?? ''}`) }),
      })),
    },
    acceptance: { overallStatus: review?.acceptance?.overallStatus ?? null, criteria: criteria.map(({ id, status, text }) => ({ id, status, text })) },
    worker: review?.workerReport?.present ? { summary: review.workerReport.summary ?? '', unresolved: review.workerReport.unresolved ?? [], assumptions: review.workerReport.assumptions ?? [] } : null,
    deferredHostSteps: review?.deferredHostSteps ?? [],
    next,
  };
}

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
