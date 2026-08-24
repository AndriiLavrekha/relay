import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createZip } from '../src/zip.mjs';
import { inspectResultCapsule } from '../src/result-capsule.mjs';
import { sha256Buffer } from '../src/hash.mjs';

async function writeResult(entries) {
  const dir = await mkdtemp(path.join(tmpdir(), 'atb-result-'));
  const file = path.join(dir, 'result.zip');
  await writeFile(file, createZip(entries));
  return file;
}

function manifest(files = [{ path: 'src/a.js', operation: 'modify' }], overrides = {}) {
  return {
    atb_protocol: '1.0',
    capsule_type: 'result',
    task_id: 'atb_test_123',
    source_base_commit: 'a'.repeat(40),
    result_type: 'code',
    summary: 'Changed a',
    files,
    validation: { executed: [], not_executed: ['npm test'] },
    assumptions: [],
    unresolved: [],
    ...overrides,
  };
}

function v11Manifest(file, overrides = {}) {
  return manifest([file], {
    schema_version: '1.1',
    bridge_version: '0.2.0',
    hash_algorithm: 'sha256',
    source_agent: 'codex',
    external_worker: 'chatgpt',
    status: 'complete',
    ...overrides,
  });
}

test('inspectResultCapsule validates manifest and returns declared complete files', async () => {
  const file = await writeResult([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest())) },
    { name: 'REPORT.md', data: Buffer.from('# Report\n') },
    { name: 'files/src/a.js', data: Buffer.from('export const a = 2;\n') },
  ]);
  const result = await inspectResultCapsule(file);
  assert.equal(result.manifest.task_id, 'atb_test_123');
  assert.equal(result.report, '# Report\n');
  assert.equal(result.files[0].path, 'src/a.js');
  assert.equal(result.files[0].content, 'export const a = 2;\n');
});

test('inspectResultCapsule rejects missing declared files and undeclared file entries', async () => {
  const missing = await writeResult([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest())) }]);
  await assert.rejects(() => inspectResultCapsule(missing), /missing.*src\/a\.js/i);

  const unexpected = await writeResult([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest([]))) },
    { name: 'files/src/extra.js', data: Buffer.from('x') },
  ]);
  await assert.rejects(() => inspectResultCapsule(unexpected), /undeclared|unexpected/i);
});

test('inspectResultCapsule supports delete operations without a file payload and rejects malformed protocol data', async () => {
  const deletion = await writeResult([{ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest([{ path: 'src/a.js', operation: 'delete' }]))) }]);
  const parsed = await inspectResultCapsule(deletion);
  assert.equal(parsed.files[0].operation, 'delete');
  assert.equal(parsed.files[0].content, null);

  const bad = await writeResult([{ name: 'manifest.json', data: Buffer.from(JSON.stringify({ ...manifest([]), atb_protocol: '9.9' })) }]);
  await assert.rejects(() => inspectResultCapsule(bad), /protocol|unsupported/i);
});

test('inspectResultCapsule rejects unsupported operations before import', async () => {
  const file = await writeResult([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest([{ path: 'src/a.js', operation: 'rename' }]))) },
  ]);
  await assert.rejects(
    () => inspectResultCapsule(file),
    (error) => error.code === 'INVALID_OPERATION_PRECONDITION'
  );
});

test('inspectResultCapsule validates schema 1.1 status and raw payload integrity', async () => {
  const content = Buffer.from('export const a = 2;\n');
  const file = await writeResult([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(v11Manifest({ path: 'src/a.js', operation: 'modify', sha256: sha256Buffer(content), size_bytes: content.length }))) },
    { name: 'files/src/a.js', data: content },
  ]);
  const result = await inspectResultCapsule(file);
  assert.equal(result.manifest.schema_version, '1.1');
  assert.equal(result.manifest.status, 'complete');
  assert.equal(result.files[0].size_bytes, content.length);
  assert.equal(result.files[0].sha256, sha256Buffer(content));
  assert.match(result.archive_sha256, /^[0-9a-f]{64}$/);
});

test('inspectResultCapsule rejects wrong raw payload hash and byte length', async () => {
  const content = Buffer.from('export const a = 2;\n');
  const wrongHash = await writeResult([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(v11Manifest({ path: 'src/a.js', operation: 'modify', sha256: '0'.repeat(64), size_bytes: content.length }))) },
    { name: 'files/src/a.js', data: content },
  ]);
  await assert.rejects(() => inspectResultCapsule(wrongHash), /hash/i);

  const wrongSize = await writeResult([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(v11Manifest({ path: 'src/a.js', operation: 'modify', sha256: sha256Buffer(content), size_bytes: content.length + 1 }))) },
    { name: 'files/src/a.js', data: content },
  ]);
  await assert.rejects(() => inspectResultCapsule(wrongSize), /byte|size/i);
});

test('inspectResultCapsule validates status and report requirements for schema 1.1', async () => {
  const content = Buffer.from('research result\n');
  const invalidStatus = await writeResult([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(v11Manifest({ path: 'notes/result.md', operation: 'create', sha256: sha256Buffer(content), size_bytes: content.length }, { status: 'done' }))) },
    { name: 'files/notes/result.md', data: content },
  ]);
  await assert.rejects(() => inspectResultCapsule(invalidStatus), /status/i);

  const missingReport = await writeResult([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(v11Manifest({ path: 'notes/result.md', operation: 'create', sha256: sha256Buffer(content), size_bytes: content.length }, { status: 'research-only', result_type: 'research' }))) },
    { name: 'files/notes/result.md', data: content },
  ]);
  await assert.rejects(() => inspectResultCapsule(missingReport), /REPORT\.md|report/i);
});

test('inspectResultCapsule marks legacy results with a legacy integrity warning', async () => {
  const file = await writeResult([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest())) },
    { name: 'files/src/a.js', data: Buffer.from('export const a = 2;\n') },
  ]);
  const result = await inspectResultCapsule(file);
  assert.equal(result.manifest.schema_version, '1.0');
  assert.equal(result.manifest.legacy_integrity, true);
  assert.equal(result.files[0].legacy_integrity, true);
});
