import test from 'node:test';
import assert from 'node:assert/strict';
import { createZip, readZip } from '../src/zip.mjs';

test('ZIP reader round trips stored and deflated entries with CRC validation', () => {
  const zip = createZip([
    { name: 'stored.txt', data: Buffer.from('stored data'), compression: 'store' },
    { name: 'deflated.txt', data: Buffer.from('deflated data '.repeat(20)), compression: 'deflate' },
  ]);
  const entries = readZip(zip);
  assert.equal(entries.get('stored.txt').data.toString(), 'stored data');
  assert.equal(entries.get('deflated.txt').data.toString(), 'deflated data '.repeat(20));
});

test('ZIP reader rejects CRC corruption', () => {
  const zip = createZip([{ name: 'a.txt', data: Buffer.from('hello'), compression: 'store' }]);
  const corrupted = Buffer.from(zip);
  const index = corrupted.indexOf(Buffer.from('hello'));
  assert.ok(index > 0);
  corrupted[index] ^= 0xff;
  assert.throws(() => readZip(corrupted), /crc/i);
});

test('ZIP reader rejects duplicate and unsafe paths', () => {
  assert.throws(() => readZip(createZip([
    { name: 'a.txt', data: Buffer.from('1') },
    { name: 'a.txt', data: Buffer.from('2') },
  ])), /duplicate/i);
  for (const name of ['../evil', '/etc/passwd', 'C:\\Windows\\evil', '\\\\server\\share\\evil']) {
    assert.throws(() => readZip(createZip([{ name, data: Buffer.from('x') }])), /path|unsafe|absolute|backslash/i, name);
  }
});

test('ZIP reader rejects symlinks, encryption, unsupported compression, and configured limits', () => {
  assert.throws(() => readZip(createZip([{ name: 'link', data: Buffer.from('target'), externalAttributes: 0o120777 << 16 }])), /symlink/i);
  assert.throws(() => readZip(createZip([{ name: 'secret.txt', data: Buffer.from('x'), flags: 1 }])), /encrypt/i);
  assert.throws(() => readZip(createZip([{ name: 'odd.txt', data: Buffer.from('x'), compressionMethod: 12 }])), /compression/i);
  const zip = createZip([{ name: 'large.txt', data: Buffer.alloc(100, 65), compression: 'store' }]);
  assert.throws(() => readZip(zip, { maxExpandedBytes: 50 }), /expanded|limit/i);
  assert.throws(() => readZip(createZip([
    { name: '1.txt', data: Buffer.from('1') },
    { name: '2.txt', data: Buffer.from('2') },
  ]), { maxFiles: 1 }), /file count|limit/i);
});
