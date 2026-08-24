import { readFile } from 'node:fs/promises';
import { AtbError, invalidOperationPrecondition, resultIntegrityMismatch } from './errors.mjs';
import { normalizeRepoPath } from './path-safety.mjs';
import { readZip } from './zip.mjs';
import { sha256Buffer, verifyResultPayload } from './hash.mjs';

function decodeText(buffer, label) {
  if (buffer.includes(0)) throw new AtbError('BINARY_RESULT_UNSUPPORTED', `Binary result files are not supported in v1: ${label}`);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new AtbError('INVALID_UTF8', `Result file is not valid UTF-8: ${label}`); }
}

const RESULT_STATUSES = new Set(['complete', 'partial', 'blocked', 'research-only']);

export function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AtbError('INVALID_RESULT_MANIFEST', 'Result manifest must be an object');
  if (value.atb_protocol !== '1.0') throw new AtbError('UNSUPPORTED_PROTOCOL', `Unsupported result protocol: ${value.atb_protocol}`);
  if (value.capsule_type !== 'result') throw new AtbError('INVALID_RESULT_MANIFEST', 'Result capsule_type must be result');
  if (typeof value.task_id !== 'string' || !value.task_id) throw new AtbError('INVALID_RESULT_MANIFEST', 'Result task_id is required');
  if (typeof value.source_base_commit !== 'string' || !/^[0-9a-f]{40}$/i.test(value.source_base_commit)) throw new AtbError('INVALID_RESULT_MANIFEST', 'Result source_base_commit must be a 40-character Git commit');
  if (!Array.isArray(value.files)) throw new AtbError('INVALID_RESULT_MANIFEST', 'Result files must be an array');
  const schemaVersion = value.schema_version ?? '1.0';
  if (!['1.0', '1.1'].includes(schemaVersion)) throw new AtbError('UNSUPPORTED_SCHEMA', `Unsupported result schema version: ${schemaVersion}`);
  const legacy = schemaVersion === '1.0';
  const status = value.status ?? (legacy ? 'legacy' : null);
  if (!legacy && !RESULT_STATUSES.has(status)) throw new AtbError('INVALID_RESULT_MANIFEST', `Invalid result status: ${status}`);
  if (!legacy && value.hash_algorithm !== 'sha256') throw new AtbError('INVALID_RESULT_MANIFEST', 'Schema 1.1 results must declare hash_algorithm sha256');
  const seen = new Set();
  const files = value.files.map((file) => {
    if (!file || typeof file !== 'object') throw new AtbError('INVALID_RESULT_MANIFEST', 'Result file declaration must be an object');
    const repoPath = normalizeRepoPath(file.path);
    if (!['create', 'modify', 'delete'].includes(file.operation)) throw invalidOperationPrecondition(repoPath, file.operation);
    if (seen.has(repoPath)) throw new AtbError('INVALID_RESULT_MANIFEST', `Duplicate result manifest path: ${repoPath}`);
    seen.add(repoPath);
    if (!legacy && file.operation !== 'delete') {
      if (typeof file.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(file.sha256)) throw new AtbError('INVALID_RESULT_MANIFEST', `Result file sha256 is required for schema 1.1: ${repoPath}`);
      if (!Number.isInteger(file.size_bytes) || file.size_bytes < 0) throw new AtbError('INVALID_RESULT_MANIFEST', `Result file size_bytes is required for schema 1.1: ${repoPath}`);
    }
    return {
      path: repoPath,
      operation: file.operation,
      ...(file.operation !== 'delete' && file.sha256 ? { sha256: file.sha256.toLowerCase(), size_bytes: file.size_bytes } : {}),
      ...(legacy && file.operation !== 'delete' ? { legacy_integrity: true } : {}),
    };
  });
  return { ...value, schema_version: schemaVersion, status, legacy_integrity: legacy, files };
}

export async function inspectResultCapsule(filePath, limits = {}) {
  const entries = readZip(await readFile(filePath), limits);
  const manifestEntry = entries.get('manifest.json');
  if (!manifestEntry) throw new AtbError('INVALID_RESULT_CAPSULE', 'Result Capsule is missing manifest.json');
  let manifestRaw;
  try { manifestRaw = JSON.parse(decodeText(manifestEntry.data, 'manifest.json')); }
  catch (error) {
    if (error instanceof AtbError) throw error;
    throw new AtbError('INVALID_RESULT_MANIFEST', `manifest.json is invalid JSON: ${error.message}`);
  }
  const manifest = validateManifest(manifestRaw);
  const declaredPayloads = new Set(manifest.files.filter((f) => f.operation !== 'delete').map((f) => `files/${f.path}`));
  const actualPayloads = new Set([...entries.keys()].filter((name) => name.startsWith('files/') && !name.endsWith('/')));
  for (const payload of declaredPayloads) if (!actualPayloads.has(payload)) throw new AtbError('INVALID_RESULT_CAPSULE', `Declared result file is missing from archive: ${payload.slice(6)}`);
  for (const payload of actualPayloads) if (!declaredPayloads.has(payload)) throw new AtbError('INVALID_RESULT_CAPSULE', `Unexpected/undeclared result file in archive: ${payload.slice(6)}`);
  for (const name of entries.keys()) {
    if (name === 'manifest.json' || name === 'REPORT.md' || name.startsWith('files/') || name.endsWith('/')) continue;
    throw new AtbError('INVALID_RESULT_CAPSULE', `Unexpected top-level archive entry: ${name}`);
  }
  const files = manifest.files.map((decl) => {
    if (decl.operation === 'delete') return { ...decl, content: null };
    const entry = entries.get(`files/${decl.path}`).data;
    if (!manifest.legacy_integrity) {
      const observed = verifyResultPayload(entry, decl);
      if (observed.sha256 !== decl.sha256) throw resultIntegrityMismatch(decl.path, 'sha256', decl.sha256, observed.sha256);
      if (observed.sizeBytes !== decl.size_bytes) throw resultIntegrityMismatch(decl.path, 'size_bytes', decl.size_bytes, observed.sizeBytes);
    }
    return { ...decl, content: decodeText(entry, decl.path) };
  });
  const report = entries.has('REPORT.md') ? decodeText(entries.get('REPORT.md').data, 'REPORT.md') : null;
  if (!manifest.legacy_integrity && (manifest.status === 'research-only' || manifest.status !== 'complete') && report === null) {
    throw new AtbError('RESULT_REPORT_REQUIRED', `REPORT.md is required for result status ${manifest.status}`);
  }
  if (!manifest.legacy_integrity && manifest.status === 'research-only' && manifest.result_type !== 'research') {
    throw new AtbError('INVALID_RESULT_MANIFEST', 'research-only results must declare result_type research');
  }
  return {
    manifest,
    report,
    files,
    entryNames: [...entries.keys()],
    archive_sha256: sha256Buffer(await readFile(filePath)),
  };
}
