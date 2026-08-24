import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LIFECYCLE_STATES, loadLifecycle, transitionLifecycle, writeLifecycle } from '../src/lifecycle.mjs';

test('transitionLifecycle allows a partial result to become staged', () => {
  const record = { taskId: 'atb_test', importId: 'import_test', state: 'inspected', events: [] };
  const next = transitionLifecycle(record, 'staged', { resultStatus: 'partial' });
  assert.equal(next.state, 'staged');
  assert.equal(next.events.at(-1).resultStatus, 'partial');
  assert.deepEqual(LIFECYCLE_STATES.includes(next.state), true);
});

test('transitionLifecycle rejects integrated before reviewed and permits recoverable failure', () => {
  assert.throws(() => transitionLifecycle({ state: 'inspected', events: [] }, 'integrated'), /transition/i);
  const failed = transitionLifecycle({ state: 'staged', events: [] }, 'failed', { error: { code: 'TEST_FAILURE' } });
  assert.equal(failed.state, 'failed');
});

test('lifecycle records persist under task import storage and load again', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-lifecycle-'));
  const record = { taskId: 'atb_test', importId: 'import_test', state: 'exported', events: [] };
  const lifecyclePath = await writeLifecycle(root, record);
  assert.match(lifecyclePath, /tasks[\\/]atb_test[\\/]imports[\\/]import_test[\\/]lifecycle\.json$/);
  const loaded = await loadLifecycle(root, 'atb_test', 'import_test');
  assert.equal(loaded.state, 'exported');
  assert.equal(loaded.taskId, 'atb_test');
});
