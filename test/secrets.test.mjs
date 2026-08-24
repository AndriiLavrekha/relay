import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanFileForSecrets } from '../src/secrets.mjs';
import { collectContext } from '../src/context.mjs';

async function root() {
  const dir = await mkdtemp(path.join(tmpdir(), 'atb-secret-'));
  await mkdir(path.join(dir, 'src'), { recursive: true });
  return dir;
}

test('secret scanner flags known sensitive filenames', async () => {
  const dir = await root();
  await writeFile(path.join(dir, '.env'), 'SAFE_NAME=value\n');
  const scan = await scanFileForSecrets(dir, '.env');
  assert.equal(scan.blocked, true);
  assert.match(scan.reasons.join(' '), /filename|path/i);
});

test('secret scanner flags high-confidence private key content', async () => {
  const dir = await root();
  await writeFile(path.join(dir, 'src', 'config.txt'), '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n');
  const scan = await scanFileForSecrets(dir, 'src/config.txt');
  assert.equal(scan.blocked, true);
  assert.match(scan.reasons.join(' '), /private key/i);
});

test('context collection blocks a selected secret instead of silently embedding it', async () => {
  const dir = await root();
  await writeFile(path.join(dir, '.env'), 'TOKEN=abc\n');
  await assert.rejects(() => collectContext(dir, {
    files: { editable: [], reference: ['.env'], contract: [], validation: [], configuration: [] }
  }), /secret|sensitive/i);
});
