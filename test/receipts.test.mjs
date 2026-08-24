import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createReceipt, writeImmutableReceipt } from '../src/receipts.mjs';

test('createReceipt stores provenance, claims, and local evidence without payload text', () => {
  const receipt = createReceipt({
    task: { capsuleText: '# task capsule\n', manifest: { task_id: 'atb_receipt', project: { base_commit: 'a'.repeat(40) } } },
    result: { manifest: { status: 'partial', source_base_commit: 'a'.repeat(40), model: 'worker-claim' }, archive_sha256: 'b'.repeat(64) },
    importReport: { taskId: 'atb_receipt', importId: 'import_receipt', currentHead: 'c'.repeat(40), resultStatus: 'partial', validation: { passed: null, blocked: true }, acceptance: { criteria: [{ id: 'criterion-1', status: 'unverified' }] }, activeWorktreeModifiedByImport: false },
    lifecycle: { state: 'reviewed' },
    observedZipHash: 'b'.repeat(64),
  });
  assert.equal(receipt.taskId, 'atb_receipt');
  assert.match(receipt.taskCapsuleSha256, /^[0-9a-f]{64}$/);
  assert.equal(receipt.resultCapsuleSha256, 'b'.repeat(64));
  assert.equal(receipt.workerClaims.model, 'worker-claim');
  assert.equal(receipt.localEvidence.validation.blocked, true);
  assert.equal(JSON.stringify(receipt).includes('task capsule'), false);
});

test('writeImmutableReceipt refuses overwrite for the same import', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-receipt-'));
  const receipt = { taskId: 'atb_receipt', importId: 'import_receipt', value: 'first' };
  const receiptPath = await writeImmutableReceipt(root, 'atb_receipt', 'import_receipt', receipt);
  await assert.rejects(() => writeImmutableReceipt(root, 'atb_receipt', 'import_receipt', { ...receipt, value: 'second' }), (error) => error?.code === 'RECEIPT_EXISTS');
  assert.equal(JSON.parse(await readFile(receiptPath, 'utf8')).value, 'first');
});
