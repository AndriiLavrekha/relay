import { redactSecretText } from './secrets.mjs';

export const MAX_REVIEW_REPORT_BYTES = 64 * 1024;

const SECTION_MATCHERS = [
  ['summary', /^(?:#{1,3}\s*|\*\*)\s*(?:summary|overview)\b/i],
  ['assumptions', /^(?:#{1,3}\s*|\*\*)\s*(?:assumptions?)\b/i],
  ['validationClaims', /^(?:#{1,3}\s*|\*\*)\s*(?:validation\s*claims?|tested|testing\s*claims?)\b/i],
  ['unresolved', /^(?:#{1,3}\s*|\*\*)\s*(?:unresolved(?:\s*work)?|follow-?up|open\s*issues?|deferred)\b/i],
  ['findings', /^(?:#{1,3}\s*|\*\*)\s*(?:findings?|analysis)\b/i],
  ['recommendations', /^(?:#{1,3}\s*|\*\*)\s*(?:recommendations?|next\s*steps?)\b/i],
];

function capUtf8(text, maxBytes) {
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.length <= maxBytes) return { text, truncated: false };
  let end = maxBytes;
  while (end > 0 && (buffer[end] & 0b11000000) === 0b10000000) end -= 1;
  return { text: buffer.subarray(0, end).toString('utf8'), truncated: true };
}

function sectionKey(line) {
  const trimmed = line.trim();
  for (const [key, matcher] of SECTION_MATCHERS) {
    if (matcher.test(trimmed)) return key;
  }
  return null;
}

function toItems(body) {
  const lines = body.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const bullets = [];
  for (const line of lines) {
    const match = /^(?:[-*]|\d+[.)])\s+(.+)$/.exec(line);
    if (match) bullets.push(match[1].trim());
  }
  return bullets.length ? bullets : lines;
}

function extractSections(text) {
  const sections = {
    summary: '',
    assumptions: [],
    validationClaims: [],
    unresolved: [],
    findings: [],
    recommendations: [],
  };
  const buckets = {
    summary: [],
    assumptions: [],
    validationClaims: [],
    unresolved: [],
    findings: [],
    recommendations: [],
  };
  let current = null;
  let recognized = false;
  for (const line of text.split(/\r?\n/)) {
    const key = sectionKey(line);
    if (key) {
      current = key;
      recognized = true;
      continue;
    }
    if (current) buckets[current].push(line);
  }
  if (!recognized) {
    const paragraph = text.split(/\r?\n\s*\r?\n/).map((block) => block.trim()).find(Boolean) ?? '';
    sections.summary = paragraph;
    return sections;
  }
  sections.summary = buckets.summary.join('\n').trim();
  for (const key of ['assumptions', 'validationClaims', 'unresolved', 'findings', 'recommendations']) {
    sections[key] = toItems(buckets[key].join('\n'));
  }
  return sections;
}

export function emptyWorkerReport(reportPath = null) {
  return {
    present: false,
    path: reportPath,
    summary: '',
    assumptions: [],
    validationClaims: [],
    unresolved: [],
    findings: [],
    recommendations: [],
    privacyFindings: [],
    rawText: '',
    truncated: false,
  };
}

export function parseWorkerReport(rawText, options = {}) {
  const original = typeof rawText === 'string' ? rawText : '';
  const findings = options.findings ?? [];
  const redacted = redactSecretText(original, findings);
  const capped = capUtf8(redacted, options.maxBytes ?? MAX_REVIEW_REPORT_BYTES);
  const sections = extractSections(capped.text);
  const privacyFindings = findings
    .filter((finding) => finding?.confidence === 'high')
    .map((finding) => ({ category: finding.category, detail: finding.detail }));
  return {
    present: true,
    path: options.path ?? null,
    summary: sections.summary,
    assumptions: sections.assumptions,
    validationClaims: sections.validationClaims,
    unresolved: sections.unresolved,
    findings: sections.findings,
    recommendations: sections.recommendations,
    privacyFindings,
    rawText: capped.text,
    truncated: capped.truncated,
  };
}

function bulletBlock(lines, title, items) {
  lines.push('', `${title}:`);
  if (!items?.length) lines.push('_None reported_');
  else for (const item of items) lines.push(`- ${item}`);
}

export function formatImportReport(report) {
  const lines = [
    'Agent Task Bridge Import',
    `Task ID: ${report.taskId}`,
    `Lifecycle: ${report.lifecycle ?? 'unknown'}`,
    `Result status: ${report.resultStatus ?? 'unknown'}`,
    report.workerReportPath
      ? `Worker Report: present (${report.workerReportPath})`
      : 'Worker Report: not included',
    ...(report.workerReportRedactions
      ? [`Worker report privacy: ${report.workerReportRedactions} high-confidence secret(s) redacted in review output`]
      : []),
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
  if (review.workerReport?.present) {
    lines.push('', '# Worker Report (REPORT.md)');
    lines.push('', 'Summary:', review.workerReport.summary || '_None reported_');
    bulletBlock(lines, 'Assumptions', review.workerReport.assumptions);
    bulletBlock(lines, 'Validation Claims', review.workerReport.validationClaims);
    bulletBlock(lines, 'Unresolved / Follow-up', review.workerReport.unresolved);
    if (review.workerReport.findings?.length) bulletBlock(lines, 'Findings', review.workerReport.findings);
    if (review.workerReport.recommendations?.length) bulletBlock(lines, 'Recommendations', review.workerReport.recommendations);
    if (review.workerReport.privacyFindings?.length) {
      lines.push('', `Privacy: ${review.workerReport.privacyFindings.length} high-confidence secret(s) redacted from this review.`);
    }
    if (review.workerReport.truncated) lines.push('', 'Worker report text was truncated for review.');
  }
  if (review.deferredToHost) {
    lines.push('', '# Deferred Host Steps');
    lines.push('These gates are owned by the local host agent. They are not worker defects.');
    for (const step of review.deferredHostSteps ?? []) lines.push(`- ${step}`);
  }
  return `${lines.join('\n')}\n`;
}
