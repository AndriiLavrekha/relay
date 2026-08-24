import { readFile } from 'node:fs/promises';
import { AtbError, invalidOperationPrecondition } from './errors.mjs';
import { normalizeRepoPath } from './path-safety.mjs';
import { readZip } from './zip.mjs';

function decodeText(buffer, label) {
  if (buffer.includes(0)) throw new AtbError('BINARY_RESULT_UNSUPPORTED', `Binary result files are not supported in v1: ${label}`);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { throw new AtbError('INVALID_UTF8', `Result file is not valid UTF-8: ${label}`); }
}

function validateManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AtbError('INVALID_RESULT_MANIFEST', 'Result manifest must be an object');
  if (value.atb_protocol !== '1.0') throw new AtbError('UNSUPPORTED_PROTOCOL', `Unsupported result protocol: ${value.atb_protocol}`);
  if (value.capsule_type !== 'result') throw new AtbError('INVALID_RESULT_MANIFEST', 'Result capsule_type must be result');
  if (typeof value.task_id !== 'string' || !value.task_id) throw new AtbError('INVALID_RESULT_MANIFEST', 'Result task_id is required');
  if (typeof value.source_base_commit !== 'string' || !/^[0-9a-f]{40}$/i.test(value.source_base_commit)) throw new AtbError('INVALID_RESULT_MANIFEST', 'Result source_base_commit must be a 40-character Git commit');
  if (!Array.isArray(value.files)) throw new AtbError('INVALID_RESULT_MANIFEST', 'Result files must be an array');
  const seen = new Set();
  const files = value.files.map((file) => {
    if (!file || typeof file !== 'object') throw new AtbError('INVALID_RESULT_MANIFEST', 'Result file declaration must be an object');
    const repoPath = normalizeRepoPath(file.path);
    if (!['create', 'modify', 'delete'].includes(file.operation)) throw invalidOperationPrecondition(repoPath, file.operation);
    if (seen.has(repoPath)) throw new AtbError('INVALID_RESULT_MANIFEST', `Duplicate result manifest path: ${repoPath}`);
    seen.add(repoPath);
    return { path: repoPath, operation: file.operation };
  });
  return { ...value, files };
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
  const files = manifest.files.map((decl) => ({
    ...decl,
    content: decl.operation === 'delete' ? null : decodeText(entries.get(`files/${decl.path}`).data, decl.path),
  }));
  const report = entries.has('REPORT.md') ? decodeText(entries.get('REPORT.md').data, 'REPORT.md') : null;
  return { manifest, report, files, entryNames: [...entries.keys()] };
}
