import test from 'node:test';
import assert from 'node:assert/strict';
import { compileGlob, matchesAnyScope, matchesGlob, partitionScopePatterns } from '../src/glob.mjs';

test('negative globs exclude matches without treating the exclusion as a positive scope', () => {
  const patterns = ['src/**', '!src/ignore/**'];
  assert.equal(matchesAnyScope('src/keep.ts', patterns), true);
  assert.equal(matchesAnyScope('src/ignore/hidden.ts', patterns), false);
  assert.equal(matchesAnyScope('src/ignore/nested/hidden.ts', patterns), false);
  assert.equal(matchesGlob('src/ignore/hidden.ts', '!src/ignore/**'), true);
  const partitioned = partitionScopePatterns(patterns);
  assert.equal(partitioned.positive.length, 1);
  assert.equal(partitioned.negative.length, 1);
  assert.equal(partitioned.negative[0].isNegative, true);
  assert.equal(matchesAnyScope('src/keep.ts', ['!src/ignore/**']), false);
});

test('consecutive wildcards collapse to a single directory wildcard', () => {
  const collapsed = compileGlob('src/***');
  assert.equal(collapsed.normalized, 'src/**');
  const repeated = compileGlob('src/**/**/**/*.js');
  assert.equal(repeated.normalized, 'src/**/*.js');
  assert.equal(matchesGlob('src/a.js', 'src/**/**/*.js'), true);
  assert.equal(matchesGlob('src/dir/a.js', 'src/***/*.js'), true);
});

test('compiled scope matching stays linear across 10000 paths', () => {
  const { positive, negative } = partitionScopePatterns(['src/**/**/**/*.ts', '!**/skip/**', '***']);
  const paths = Array.from({ length: 10_000 }, (_, i) => `src/${'abc/'.repeat(6)}file-${i}.ts`);
  const hostile = 'a'.repeat(4000);
  const started = performance.now();
  let matches = 0;
  for (const repoPath of paths) {
    const included = positive.some((item) => item.regex.test(repoPath));
    const excluded = negative.some((item) => item.regex.test(repoPath));
    if (included && !excluded) matches += 1;
  }
  for (const item of [...positive, ...negative]) item.regex.test(hostile);
  const elapsed = performance.now() - started;
  assert.equal(matches, paths.length);
  assert.ok(elapsed < 50, `expected matching to finish under 50ms, took ${elapsed}ms`);
});
