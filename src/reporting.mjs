export function formatImportReport(report) {
  const lines = [
    'Agent Task Bridge Import',
    `Task ID: ${report.taskId}`,
    `Source baseline: ${report.sourceBaseCommit}`,
    `Current HEAD: ${report.currentHead}`,
    `Repository base changed since export: ${report.repositoryBaseChanged ? 'YES' : 'NO'}`,
    `Staging: ${report.stagingRoot}`,
    '',
    `Returned files: ${report.files?.length ?? 0}`,
  ];
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
  lines.push('', report.activeWorktreeModifiedByImport ? 'WARNING: active worktree was modified.' : 'No changes have been applied to the active worktree.');
  return `${lines.join('\n')}\n`;
}
