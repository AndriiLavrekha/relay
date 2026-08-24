import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeRepoPath } from './path-safety.mjs';
import { scanSecretPath, scanSecretText } from './secrets.mjs';

export const DEFAULT_PRIVACY_POLICY = Object.freeze({
  highConfidence: 'block',
  warning: 'confirm',
  redaction: 'metadata-only',
});

function withLocation(findings, { source, path: findingPath }) {
  return findings.map((finding) => ({
    category: finding.category,
    confidence: finding.confidence,
    severity: finding.severity,
    source,
    path: findingPath,
    detail: finding.detail,
  }));
}

function scanWarningText(text) {
  const findings = [];
  if (/\bhttps?:\/\/[^\s)\]}>,]+/i.test(text)) {
    findings.push({ category: 'url', confidence: 'low', severity: 'warning', detail: 'detected URL' });
  }
  if (/(?:\b[A-Za-z]:\\|(?<!:)\/(?:Users|home|etc|var|opt|tmp)\/)[^\s)\]}>,]*/.test(text)) {
    findings.push({ category: 'absolute-path', confidence: 'low', severity: 'warning', detail: 'detected absolute path' });
  }
  return findings;
}

export function applyPrivacyPolicy(findings, { mode = 'default', confirmed = false } = {}) {
  if (mode === 'allow') return { action: 'allow', findings };
  if (mode === 'redact') return { action: 'redact', findings };
  if (findings.some((finding) => finding.confidence === 'high')) {
    return { action: DEFAULT_PRIVACY_POLICY.highConfidence, findings };
  }
  if (findings.length > 0) {
    return { action: confirmed ? 'allow' : DEFAULT_PRIVACY_POLICY.warning, findings };
  }
  return { action: 'allow', findings };
}

function buildScanResult(findings, options) {
  const decision = applyPrivacyPolicy(findings, {
    mode: options.policy ?? 'default',
    confirmed: options.confirmed,
  });
  return {
    findings: decision.findings,
    blocked: decision.action === 'block',
    requiresConfirmation: decision.action === 'confirm',
  };
}

export function scanText(text, options = {}) {
  const findings = withLocation([
    ...scanSecretText(text),
    ...scanWarningText(text),
  ], options);
  return buildScanResult(findings, options);
}

export async function scanPath(repoRoot, repoPath, options = {}) {
  const normalized = normalizeRepoPath(repoPath);
  const location = { source: options.source ?? 'file', path: normalized };
  const findings = [...withLocation(scanSecretPath(normalized), location)];
  try {
    const buffer = await readFile(path.join(repoRoot, ...normalized.split('/')));
    if (!buffer.includes(0)) findings.push(...withLocation([
      ...scanSecretText(buffer.toString('utf8')),
      ...scanWarningText(buffer.toString('utf8')),
    ], location));
  } catch {
    // Missing or unreadable files still receive path-only screening.
  }
  return buildScanResult(findings, options);
}
