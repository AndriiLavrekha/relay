import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { AtbError } from './errors.mjs';
import { crc32 } from './crc32.mjs';
import { normalizeRepoPath } from './path-safety.mjs';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const DEFAULT_LIMITS = {
  maxArchiveBytes: 25 * 1024 * 1024,
  maxExpandedBytes: 100 * 1024 * 1024,
  maxFileBytes: 10 * 1024 * 1024,
  maxFiles: 1000,
};

function assertRange(buffer, offset, length, label) {
  if (offset < 0 || length < 0 || offset + length > buffer.length) throw new AtbError('INVALID_ZIP', `Truncated ZIP while reading ${label}`);
}

function decodeName(buffer) {
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
}

function safeArchivePath(name) {
  if (name.includes('\\')) throw new AtbError('UNSAFE_ARCHIVE_PATH', `Backslash archive path is not allowed: ${name}`);
  if (name.endsWith('/')) {
    const trimmed = name.replace(/\/+$/, '');
    if (!trimmed) throw new AtbError('UNSAFE_ARCHIVE_PATH', `Unsafe archive directory path: ${name}`);
    return `${normalizeRepoPath(trimmed)}/`;
  }
  return normalizeRepoPath(name);
}

function findEocd(buffer) {
  const min = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= min; i--) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) return i;
  }
  throw new AtbError('INVALID_ZIP', 'ZIP end-of-central-directory record not found');
}

export function readZip(buffer, limitOverrides = {}) {
  const limits = { ...DEFAULT_LIMITS, ...limitOverrides };
  if (!Buffer.isBuffer(buffer)) throw new AtbError('INVALID_ZIP', 'ZIP input must be a Buffer');
  if (buffer.length > limits.maxArchiveBytes) throw new AtbError('ZIP_LIMIT', `ZIP archive exceeds configured archive size limit (${limits.maxArchiveBytes})`);
  if (buffer.length < 22) throw new AtbError('INVALID_ZIP', 'ZIP archive is too small');
  const eocd = findEocd(buffer);
  assertRange(buffer, eocd, 22, 'EOCD');
  const diskNo = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  const commentLength = buffer.readUInt16LE(eocd + 20);
  if (diskNo !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw new AtbError('UNSUPPORTED_ZIP', 'Multi-disk ZIP archives are not supported');
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new AtbError('UNSUPPORTED_ZIP', 'ZIP64 archives are not supported in v1');
  if (entryCount > limits.maxFiles) throw new AtbError('ZIP_LIMIT', `ZIP file count exceeds configured limit (${limits.maxFiles})`);
  assertRange(buffer, eocd + 22, commentLength, 'ZIP comment');
  assertRange(buffer, centralOffset, centralSize, 'central directory');

  const entries = new Map();
  let cursor = centralOffset;
  let expandedTotal = 0;
  for (let i = 0; i < entryCount; i++) {
    assertRange(buffer, cursor, 46, 'central directory entry');
    if (buffer.readUInt32LE(cursor) !== SIG_CENTRAL) throw new AtbError('INVALID_ZIP', `Invalid central-directory signature at entry ${i}`);
    const versionMadeBy = buffer.readUInt16LE(cursor + 4);
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLen = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    assertRange(buffer, cursor + 46, nameLength + extraLength + commentLen, 'central entry payload');
    const rawName = decodeName(buffer.subarray(cursor + 46, cursor + 46 + nameLength));
    const name = safeArchivePath(rawName);
    if (entries.has(name)) throw new AtbError('DUPLICATE_ZIP_ENTRY', `Duplicate ZIP entry path: ${name}`);
    if (flags & 0x0001) throw new AtbError('UNSUPPORTED_ZIP_ENCRYPTION', `Encrypted ZIP entries are not supported: ${name}`);
    if (![0, 8].includes(method)) throw new AtbError('UNSUPPORTED_ZIP_COMPRESSION', `Unsupported ZIP compression method ${method} for ${name}`);
    const unixMode = externalAttributes >>> 16;
    if ((unixMode & 0o170000) === 0o120000) throw new AtbError('UNSAFE_ZIP_SYMLINK', `ZIP symlink entries are not allowed: ${name}`);
    if (uncompressedSize > limits.maxFileBytes) throw new AtbError('ZIP_LIMIT', `ZIP entry exceeds per-file expanded limit: ${name}`);
    expandedTotal += uncompressedSize;
    if (expandedTotal > limits.maxExpandedBytes) throw new AtbError('ZIP_LIMIT', `ZIP expanded size exceeds configured limit (${limits.maxExpandedBytes})`);

    assertRange(buffer, localOffset, 30, `local header for ${name}`);
    if (buffer.readUInt32LE(localOffset) !== SIG_LOCAL) throw new AtbError('INVALID_ZIP', `Invalid local-file header for ${name}`);
    const localFlags = buffer.readUInt16LE(localOffset + 6);
    const localMethod = buffer.readUInt16LE(localOffset + 8);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    if (localFlags !== flags || localMethod !== method) throw new AtbError('INVALID_ZIP', `Central/local header mismatch for ${name}`);
    assertRange(buffer, localOffset + 30, localNameLength + localExtraLength, `local metadata for ${name}`);
    const localName = safeArchivePath(decodeName(buffer.subarray(localOffset + 30, localOffset + 30 + localNameLength)));
    if (localName !== name) throw new AtbError('INVALID_ZIP', `Central/local filename mismatch for ${name}`);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    assertRange(buffer, dataOffset, compressedSize, `compressed data for ${name}`);
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let data;
    try { data = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed); }
    catch (error) { throw new AtbError('INVALID_ZIP', `Failed to decompress ${name}: ${error.message}`); }
    if (data.length !== uncompressedSize) throw new AtbError('INVALID_ZIP', `Expanded-size mismatch for ${name}`);
    if (crc32(data) !== expectedCrc) throw new AtbError('INVALID_ZIP_CRC', `CRC mismatch for ${name}`);
    entries.set(name, { name, data, method, flags, externalAttributes, versionMadeBy });
    cursor += 46 + nameLength + extraLength + commentLen;
  }
  if (cursor > centralOffset + centralSize) throw new AtbError('INVALID_ZIP', 'Central directory exceeds declared size');
  return entries;
}

function writeLocal(entry, offset) {
  const name = Buffer.from(entry.name, 'utf8');
  const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data ?? '');
  const method = entry.compressionMethod ?? (entry.compression === 'store' ? 0 : 8);
  const compressed = method === 8 ? deflateRawSync(data) : Buffer.from(data);
  const flags = entry.flags ?? 0;
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(SIG_LOCAL, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(0, 10); local.writeUInt16LE(0, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  return { localParts: [local, name, compressed], name, data, compressed, method, flags, crc, offset };
}

export function createZip(entries) {
  const localParts = [];
  const records = [];
  let offset = 0;
  for (const input of entries) {
    const record = writeLocal(input, offset);
    for (const part of record.localParts) localParts.push(part);
    offset += record.localParts.reduce((sum, part) => sum + part.length, 0);
    records.push({ ...record, externalAttributes: input.externalAttributes ?? (0o100644 << 16) });
  }
  const centralParts = [];
  let centralSize = 0;
  for (const record of records) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(0x0314, 4); // Unix host, ZIP 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(record.flags, 8);
    central.writeUInt16LE(record.method, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0, 14);
    central.writeUInt32LE(record.crc, 16);
    central.writeUInt32LE(record.compressed.length, 20);
    central.writeUInt32LE(record.data.length, 24);
    central.writeUInt16LE(record.name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(record.externalAttributes >>> 0, 38);
    central.writeUInt32LE(record.offset, 42);
    centralParts.push(central, record.name);
    centralSize += central.length + record.name.length;
  }
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4); eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(records.length, 8); eocd.writeUInt16LE(records.length, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}
