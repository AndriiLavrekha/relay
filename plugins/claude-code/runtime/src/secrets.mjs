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

const CONTENT_PATTERNS = [
  { name: 'private key material', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  { name: 'OpenAI-style secret key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
];

export async function scanFileForSecrets(repoRoot, repoPath) {
  const normalized = normalizeRepoPath(repoPath);
  const reasons = [];
  const base = path.posix.basename(normalized).toLowerCase();
  if (SENSITIVE_BASENAMES.has(base)) reasons.push(`sensitive filename/path: ${normalized}`);
  if (SENSITIVE_PATH_PATTERNS.some((re) => re.test(normalized))) reasons.push(`sensitive filename/path pattern: ${normalized}`);
  let buffer;
  try { buffer = await readFile(path.join(repoRoot, ...normalized.split('/'))); }
  catch { return { blocked: reasons.length > 0, reasons }; }
  if (!buffer.includes(0)) {
    const text = buffer.toString('utf8');
    for (const pattern of CONTENT_PATTERNS) if (pattern.re.test(text)) reasons.push(pattern.name);
  }
  return { blocked: reasons.length > 0, reasons };
}
