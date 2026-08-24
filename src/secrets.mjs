import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeRepoPath } from './path-safety.mjs';

const SENSITIVE_BASENAMES = new Set([
  '.env', '.npmrc', '.pypirc', '.netrc', 'id_rsa', 'id_dsa', 'id_ed25519',
  'credentials', 'credentials.json', 'service-account.json', 'secrets.json'
]);

const SENSITIVE_PATH_PATTERNS = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)(?:\.aws|\.ssh|\.gnupg)(?:\/|$)/i,
  /(^|\/)secrets?(?:\/|\.|$)/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /\.key$/i,
];

const HIGH_CONFIDENCE_CONTENT_PATTERNS = [
  { category: 'private-key', detail: 'detected private key marker', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { category: 'aws-access-key', detail: 'detected AWS access key format', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { category: 'github-token', detail: 'detected GitHub token format', re: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  { category: 'openai-secret-key', detail: 'detected OpenAI-style secret key format', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { category: 'npm-token', detail: 'detected npm token format', re: /\bnpm_[A-Za-z0-9]{30,}\b/ },
  { category: 'gitlab-token', detail: 'detected GitLab token format', re: /\bglpat-[A-Za-z0-9_-]{20,}\b/ },
  { category: 'slack-token', detail: 'detected Slack token format', re: /\bxox(?:b|p|a|r|s)-[A-Za-z0-9-]{20,}\b/ },
  { category: 'stripe-secret-key', detail: 'detected Stripe secret key format', re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/ },
  { category: 'azure-storage-connection-string', detail: 'detected Azure storage connection string format', re: /DefaultEndpointsProtocol=https;AccountName=[^;\s]+;AccountKey=[^;\s]+;EndpointSuffix=[^;\s]+/i },
  { category: 'gcp-api-key', detail: 'detected Google Cloud API key format', re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { category: 'jwt', detail: 'detected JWT format', re: /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/ },
  { category: 'database-url', detail: 'detected database URL with credentials', re: /\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis):\/\/[^\s/@]+:[^\s/@]+@[^\s/]+/i },
  { category: 'credential-assignment', detail: 'detected credential assignment', re: /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|database[_-]?password|password|secret|token)\s*(?:=|:)\s*(?:"[^"\r\n]{8,}"|'[^'\r\n]{8,}'|[^\s#\r\n]{8,})/i },
];

function highConfidenceFinding(category, detail) {
  return { category, confidence: 'high', severity: 'high', detail };
}

function warningFinding(category, detail) {
  return { category, confidence: 'low', severity: 'warning', detail };
}

function isEntropyCandidate(value, line) {
  if (value.length < 32 || /^(?:[a-f0-9]{32,}|[A-F0-9]{32,})$/.test(value)) return false;
  if (/\b(?:fixture|example|test|checksum|integrity|sha(?:1|256|512))\b/i.test(line)) return false;
  const characterClasses = [/[a-z]/, /[A-Z]/, /\d/, /[+/_=-]/].filter((re) => re.test(value));
  return characterClasses.length >= 3;
}

export function scanSecretPath(normalizedPath) {
  const base = path.posix.basename(normalizedPath).toLowerCase();
  if (SENSITIVE_BASENAMES.has(base) || SENSITIVE_PATH_PATTERNS.some((re) => re.test(normalizedPath))) {
    return [highConfidenceFinding('sensitive-path', 'matched sensitive filename or path rule')];
  }
  return [];
}

export function scanSecretText(text) {
  const findings = [];
  for (const pattern of HIGH_CONFIDENCE_CONTENT_PATTERNS) {
    if (pattern.re.test(text)) findings.push(highConfidenceFinding(pattern.category, pattern.detail));
  }
  for (const line of text.split(/\r?\n/)) {
    const values = line.match(/[A-Za-z0-9+/_=-]{32,}/g) ?? [];
    if (values.some((value) => isEntropyCandidate(value, line))) {
      findings.push(warningFinding('entropy-candidate', 'detected high-entropy value candidate'));
      break;
    }
  }
  return findings;
}

export async function scanFileForSecrets(repoRoot, repoPath) {
  const normalized = normalizeRepoPath(repoPath);
  const findings = scanSecretPath(normalized);
  try {
    const buffer = await readFile(path.join(repoRoot, ...normalized.split('/')));
    if (!buffer.includes(0)) findings.push(...scanSecretText(buffer.toString('utf8')));
  } catch {
    // Missing or unreadable files still receive path-only screening.
  }
  return {
    blocked: findings.some((finding) => finding.confidence === 'high'),
    reasons: findings.map((finding) => finding.detail),
  };
}
