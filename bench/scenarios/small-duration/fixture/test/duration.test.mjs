import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/duration.mjs';
import { formatDuration } from '../src/format.mjs';

test('parseDuration reads a combined duration', () => {
  assert.equal(parseDuration('1h30m'), 5400);
});

test('parseDuration reads a single unit', () => {
  assert.equal(parseDuration('45s'), 45);
});

test('formatDuration is unchanged', () => {
  assert.equal(formatDuration(5400), '1h30m');
});
