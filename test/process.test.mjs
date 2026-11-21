import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../src/process.mjs';

test('runProcess kills a timed-out child and reports timeout', async () => {
  const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], {
    timeoutMs: 50,
    killTree: true,
    allowFailure: true,
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.killedTree, true);
  assert.ok(result.durationMs >= 0);
});

test('runProcess caps stdout and reports truncation', async () => {
  const result = await runProcess(process.execPath, ['-e', 'console.log("x".repeat(1000))'], {
    maxOutputBytes: 32,
    allowFailure: true,
  });

  assert.equal(result.stdoutTruncated, true);
  assert.ok(Buffer.byteLength(result.stdout) <= 32);
});

test('runProcess preserves command failures with bounded result metadata', async () => {
  const result = await runProcess(process.execPath, ['-e', 'console.error("bad"); process.exit(3)'], {
    maxOutputBytes: 32,
    allowFailure: true,
  });

  assert.equal(result.code, 3);
  assert.equal(result.timedOut, false);
  assert.equal(result.killedTree, false);
  assert.match(result.stderr, /bad/);
});

test('runProcess keeps output from later chunks while under the cap', async () => {
  const script = 'process.stdout.write("first,"); setTimeout(() => process.stdout.write("second"), 150)';
  const result = await runProcess(process.execPath, ['-e', script], { maxOutputBytes: 1000 });
  assert.equal(result.stdout, 'first,second');
  assert.equal(result.stdoutTruncated, false);
});
