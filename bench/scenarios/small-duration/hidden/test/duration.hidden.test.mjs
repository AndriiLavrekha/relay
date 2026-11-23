import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration } from '../src/duration.mjs';
import { formatDuration } from '../src/format.mjs';

test('all four units', () => assert.equal(parseDuration('1d2h3m4s'), 86400 + 7200 + 180 + 4));
test('single units', () => {
  assert.equal(parseDuration('2d'), 172800);
  assert.equal(parseDuration('5h'), 18000);
  assert.equal(parseDuration('90m'), 5400);
  assert.equal(parseDuration('0s'), 0);
});
test('units are case-insensitive', () => assert.equal(parseDuration('1H30M'), 5400));
test('whitespace between and around parts is allowed', () => assert.equal(parseDuration('  1h 30m  '), 5400));
test('round-trips formatDuration', () => {
  for (const n of [0, 1, 59, 60, 3599, 3600, 5400, 86399, 86400, 90061]) assert.equal(parseDuration(formatDuration(n)), n);
});
test('non-strings throw TypeError', () => {
  for (const bad of [90, null, undefined, {}, ['1h']]) assert.throws(() => parseDuration(bad), TypeError);
});
test('empty or blank input throws RangeError', () => {
  assert.throws(() => parseDuration(''), RangeError);
  assert.throws(() => parseDuration('   '), RangeError);
});
test('a bare number without a unit throws RangeError', () => assert.throws(() => parseDuration('90'), RangeError));
test('unknown units and junk throw RangeError', () => {
  for (const bad of ['1w', '1x30m', 'h', '1h-30m', '1.5h', '-5s', '1h30']) assert.throws(() => parseDuration(bad), RangeError, bad);
});
test('duplicate units throw RangeError', () => assert.throws(() => parseDuration('1h1h'), RangeError));
test('out-of-order units throw RangeError', () => {
  assert.throws(() => parseDuration('30m1h'), RangeError);
  assert.throws(() => parseDuration('1s1d'), RangeError);
});
