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
    for (const result of report.validation.results) lines.push(`  ${result.name}: ${result.status}${result.exitCode === null ? '' : ` (exit ${result.exitCode})`}`);
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
