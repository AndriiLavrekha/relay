import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  applyPrivacyPolicy,
  scanPath,
  scanText,
} from '../src/privacy.mjs';

function privacyOptions() {
  return { source: 'task-metadata', path: 'architecture_context', policy: 'default' };
}

test('scanText blocks a private key without returning secret content', () => {
  const secret = 'private-key-test-value';
  const result = scanText(`-----BEGIN PRIVATE KEY-----\n${secret}\n-----END PRIVATE KEY-----`, privacyOptions());

  assert.equal(result.blocked, true);
  assert.equal(result.requiresConfirmation, false);
  assert.equal(result.findings.some((finding) => finding.category === 'private-key'), true);
  assert.equal(result.findings.some((finding) => finding.detail.includes(secret)), false);
  assert.deepEqual(Object.keys(result.findings[0]).sort(), [
    'category', 'confidence', 'detail', 'path', 'severity', 'source'
  ]);
});

test('scanText detects high-confidence provider and credential families', () => {
  const samples = [
    ['npm-token', 'npm_1234567890abcdefghijklmnopqrstuvwxyz'],
    ['gitlab-token', 'glpat-1234567890abcdefghijklmn'],
    ['slack-token', 'xoxb-123456789012-123456789012-abcdefghijklmnopqrstuvwx'],
    ['stripe-secret-key', 'sk_live_1234567890abcdefghijklmnopqrstuv'],
    ['azure-storage-connection-string', 'DefaultEndpointsProtocol=https;AccountName=sample;AccountKey=abcdef0123456789abcdef0123456789;EndpointSuffix=core.windows.net'],
    ['gcp-api-key', 'AIzaSyA1234567890abcdefghijklmnopqrstuv'],
    ['jwt', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.abcdefghijklmnopqrstuvwx'],
    ['database-url', 'postgresql://user:password@db.example.test:5432/app'],
    ['credential-assignment', 'DATABASE_PASSWORD=private-value'],
  ];

  for (const [category, text] of samples) {
    const result = scanText(text, privacyOptions());
    assert.equal(result.blocked, true, category);
    assert.equal(result.findings.some((finding) => finding.category === category), true, category);
    assert.equal(result.findings.some((finding) => finding.detail.includes(text)), false, category);
  }
});

test('scanText requires confirmation for URL and absolute-path warnings', () => {
  const result = scanText('Reference https://example.test/internal from C:\\Users\\alice\\project.', privacyOptions());

  assert.equal(result.blocked, false);
  assert.equal(result.requiresConfirmation, true);
  assert.deepEqual(result.findings.map((finding) => finding.category).sort(), ['absolute-path', 'url']);
});

test('scanText excludes fixture and checksum values from entropy warnings', () => {
  const result = scanText([
    'fixture=AbcDefGhiJklMnoPqrStuVwxYz0123456789',
    'integrity sha512-AbcDefGhiJklMnoPqrStuVwxYz0123456789AbcDefGhiJklMnoPqrSt',
  ].join('\n'), privacyOptions());

  assert.equal(result.findings.some((finding) => finding.category === 'entropy-candidate'), false);
});

test('scanPath blocks a sensitive filename without returning file content', async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'atb-privacy-'));
  const secret = 'file-secret-value';
  await writeFile(path.join(repoRoot, '.env'), `TOKEN=${secret}\n`);

  const result = await scanPath(repoRoot, '.env', { source: 'selected-context' });

  assert.equal(result.blocked, true);
  assert.equal(result.findings.some((finding) => finding.category === 'sensitive-path'), true);
  assert.equal(result.findings.some((finding) => finding.detail.includes(secret)), false);
});

test('applyPrivacyPolicy records explicit allow and metadata-only redaction actions', () => {
  const findings = scanText('https://example.test/internal', privacyOptions()).findings;
  const allowed = applyPrivacyPolicy(findings, { mode: 'allow', confirmed: true });
  const redacted = applyPrivacyPolicy(findings, { mode: 'redact', confirmed: true });

  assert.equal(allowed.action, 'allow');
  assert.equal(redacted.action, 'redact');
  assert.deepEqual(redacted.findings, findings);
  assert.equal(redacted.findings[0].detail.includes('example.test'), false);
});
