import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createZip } from '../src/zip.mjs';
import { inspectResultCapsule } from '../src/result-capsule.mjs';

async function writeResult(entries) {
  const dir = await mkdtemp(path.join(tmpdir(), 'atb-result-'));
  const file = path.join(dir, 'result.zip');
  await writeFile(file, createZip(entries));
  return file;
}

function manifest(files = [{ path: 'src/a.js', operation: 'modify' }]) {
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
    unresolved: []
  };
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
