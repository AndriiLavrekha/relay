import test from 'node:test';
import assert from 'node:assert/strict';
import { sha256Text } from '../src/hash.mjs';
import { classifyDrift } from '../src/drift.mjs';
import { matchesAnyScope } from '../src/glob.mjs';

test('glob matcher supports **, *, and exact repository paths', () => {
  assert.equal(matchesAnyScope('src/auth/key.ts', ['src/**']), true);
  assert.equal(matchesAnyScope('src/auth/key.ts', ['src/*']), false);
  assert.equal(matchesAnyScope('src/key.ts', ['src/*']), true);
  assert.equal(matchesAnyScope('test/a.test.ts', ['src/**']), false);
  assert.equal(matchesAnyScope('README.md', ['README.md']), true);
});

test('classifyDrift distinguishes unchanged, local changes, expected new, and unsafe scope expansion', () => {
  const baseline = new Map([
    ['src/a.js', { sha256: sha256Text('base\n') }],
    ['src/deleted.js', { sha256: sha256Text('was here\n') }],
  ]);
  assert.equal(classifyDrift({ path: 'src/a.js', operation: 'modify', baseline, current: { exists: true, sha256: sha256Text('base\n') }, editableScope: ['src/**'] }), 'CLEAN_UNCHANGED');
  assert.equal(classifyDrift({ path: 'src/a.js', operation: 'modify', baseline, current: { exists: true, sha256: sha256Text('local\n') }, editableScope: ['src/**'] }), 'LOCAL_CHANGED');
  assert.equal(classifyDrift({ path: 'src/deleted.js', operation: 'modify', baseline, current: { exists: false, sha256: null }, editableScope: ['src/**'] }), 'DELETED_LOCALLY');
  assert.equal(classifyDrift({ path: 'src/new.js', operation: 'create', baseline, current: { exists: false, sha256: null }, editableScope: ['src/**'] }), 'NEW_EXPECTED');
  assert.equal(classifyDrift({ path: 'src/new.js', operation: 'create', baseline, current: { exists: true, sha256: sha256Text('local') }, editableScope: ['src/**'] }), 'NEW_UNEXPECTED');
  assert.equal(classifyDrift({ path: 'README.md', operation: 'modify', baseline, current: { exists: true, sha256: sha256Text('x') }, editableScope: ['src/**'] }), 'OUT_OF_SCOPE');
  assert.equal(classifyDrift({ path: 'src/unknown.js', operation: 'modify', baseline, current: { exists: false, sha256: null }, editableScope: ['src/**'] }), 'BASELINE_MISSING');
});
