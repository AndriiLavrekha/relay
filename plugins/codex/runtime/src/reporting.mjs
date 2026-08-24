export function formatImportReport(report) {
  const lines = [
    'Agent Task Bridge Import',
    `Task ID: ${report.taskId}`,
    `Lifecycle: ${report.lifecycle ?? 'unknown'}`,
    `Result status: ${report.resultStatus ?? 'unknown'}`,
    `Source baseline: ${report.sourceBaseCommit}`,
    `Current HEAD: ${report.currentHead}`,
    `Repository base changed since export: ${report.repositoryBaseChanged ? 'YES' : 'NO'}`,
    `Staging: ${report.stagingRoot ?? 'not created'}`,
    `Staging outcome: ${report.stagingRetained ? 'retained' : report.cleanup ? (report.cleanup.removed ? 'cleaned' : 'cleanup failed') : 'not retained'}`,
    `Excluded working-tree paths: ${report.excludedPaths?.length ?? 0}`,
    '',
    `Returned files: ${report.files?.length ?? 0}`,
  ];
  for (const excludedPath of report.excludedPaths ?? []) lines.push(`  ${excludedPath}`);
  for (const file of report.files ?? []) lines.push(`  ${file.path}: ${file.status}${file.appliedToStaging ? ' (staged)' : ''}`);
  lines.push('', `Conflicts / withheld files: ${report.conflicts?.length ?? 0}`);
  for (const conflict of report.conflicts ?? []) lines.push(`  ${conflict.path}: ${conflict.status}`);
  lines.push('', 'Validation:');
  if (report.validation?.blocked) lines.push(`  Validation blocked: ${report.validation.reason ?? 'UNSPECIFIED'}.`);
  else if (!report.validation || report.validation.results.length === 0) lines.push('  No validation commands discovered.');
  else {
    if (report.validation.policy) lines.push(`  Policy: ${report.validation.policy}`);
    if (report.validation.environment?.removedNames?.length) lines.push(`  Scrubbed environment variables: ${report.validation.environment.removedNames.length}`);
    for (const result of report.validation.results) lines.push(`  ${result.name}: ${result.status}${result.exitCode === null ? '' : ` (exit ${result.exitCode})`}`);
    for (const result of report.validation.results) {
      if (result.stdoutTruncated || result.stderrTruncated) lines.push(`  ${result.name}: output truncated`);
      if (result.timedOut) lines.push(`  ${result.name}: timed out; tree termination ${result.killMethod ?? 'unknown'}`);
    }
    if (report.validation.partial) lines.push('  Note: validation is partial because one or more returned files were withheld for conflict/scope review.');
  }
  lines.push('', 'Worker claims:');
  const criteria = report.acceptance?.criteria ?? [];
  if (criteria.length === 0) lines.push('  No acceptance criteria were recorded.');
  else for (const criterion of criteria) lines.push(`  ${criterion.id}: ${criterion.workerClaim ?? 'none'}`);
  lines.push('', 'Local evidence:');
  if (criteria.length === 0) lines.push('  No local acceptance evidence was derived.');
  else for (const criterion of criteria) for (const evidence of criterion.localEvidence ?? []) lines.push(`  ${criterion.id}: ${evidence}`);
  lines.push('', 'Acceptance criteria:');
  if (criteria.length === 0) lines.push('  No acceptance criteria were recorded.');
  else for (const criterion of criteria) lines.push(`  ${criterion.id}: ${criterion.status.toUpperCase()} — ${criterion.text}`);
  if (report.activeWorktreeModifiedByImport === null || report.activeWorktreeModifiedByImport === undefined) lines.push('', 'Active-tree comparison: not observed.');
  else if (report.activeWorktreeModifiedByImport) lines.push('', 'Active-tree comparison: changed.', 'WARNING: active worktree was modified.');
  else lines.push('', 'Active-tree comparison: unchanged.', 'No changes have been applied to the active worktree.');
  return `${lines.join('\n')}\n`;
}

export function formatReviewReport(review) {
  const lines = [
    'Agent Task Bridge Review',
    `Task ID: ${review.task?.taskId ?? 'unknown'}`,
    `Lifecycle: ${review.lifecycle ?? 'unknown'}`,
    `Result status: ${review.result?.status ?? 'unknown'}`,
    `Partial review: ${review.partial ? 'YES' : 'NO'}`,
    '',
    'Diff stat:',
    review.diffStat ?? 'No diff available.',
    '',
    `Changed files: ${review.changedFiles?.length ?? 0}`,
  ];
  for (const file of review.changedFiles ?? []) lines.push(`  ${file.status}: ${file.path}`);
  lines.push('', `Withheld files: ${review.withheldFiles?.length ?? 0}`);
  for (const file of review.withheldFiles ?? []) lines.push(`  ${file}`);
  lines.push('', `Validation: ${review.validation?.blocked ? `blocked (${review.validation.reason ?? 'unknown'})` : review.validation?.passed === true ? 'passed' : 'not fully verified'}`);
  lines.push(`Acceptance criteria: ${review.acceptance?.overallStatus ?? 'not recorded'}`);
  return `${lines.join('\n')}\n`;
}
