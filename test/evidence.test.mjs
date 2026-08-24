import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAcceptanceEvidence } from '../src/evidence.mjs';

test('buildAcceptanceEvidence separates worker claims from local evidence', () => {
  const task = {
    delegation: {
      acceptance_criteria: ['src/a.js is staged', 'The implementation is complete'],
    },
  };
  const result = {
    manifest: {
      status: 'partial',
      acceptance_criteria: ['Worker says src/a.js is staged', 'Worker says implementation is complete'],
      validation: { executed: [{ name: 'test', status: 'PASS' }] },
    },
    report: '# Summary\nPartial implementation returned.\n',
  };
  const localState = {
    files: [
      { path: 'src/a.js', status: 'CLEAN_UNCHANGED', appliedToStaging: true },
      { path: 'src/b.js', status: 'LOCAL_CHANGED', appliedToStaging: false },
    ],
    conflicts: [{ path: 'src/b.js', status: 'LOCAL_CHANGED' }],
    validation: { passed: true, partial: true, blocked: false, results: [{ name: 'test', status: 'PASS' }] },
  };

  const evidence = buildAcceptanceEvidence(task, result, localState);
  assert.equal(evidence.criteria.length, 2);
  assert.equal(evidence.criteria[0].status, 'verified');
  assert.equal(evidence.criteria[0].workerClaim, 'Worker says src/a.js is staged');
  assert.ok(evidence.criteria[0].localEvidence.some((item) => /staged/i.test(item)));
  assert.equal(evidence.criteria[1].status, 'unverified');
  assert.ok(evidence.criteria[1].localEvidence.some((item) => /no deterministic/i.test(item)));
  assert.equal(evidence.overallStatus, 'unverified');
});

test('buildAcceptanceEvidence blocks criteria when local validation is blocked', () => {
  const evidence = buildAcceptanceEvidence(
    { delegation: { acceptance_criteria: ['Tests pass'] } },
    { manifest: { status: 'blocked', validation: { executed: [{ name: 'test', status: 'PASS' }] } }, report: null },
    { files: [], conflicts: [], validation: { blocked: true, reason: 'VALIDATION_CONFIG_CHANGED', results: [] } }
  );

  assert.equal(evidence.criteria[0].status, 'blocked');
  assert.match(evidence.criteria[0].localEvidence.join(' '), /blocked/i);
});
