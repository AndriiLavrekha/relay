import crypto from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AtbError } from './errors.mjs';
import { assertSafeStorageRoot, atbRoot, LEGACY_STORAGE_DIR, STORAGE_DIR, safeExistingStorageDir } from './storage.mjs';

export const LIFECYCLE_STATES = Object.freeze([
  'exported', 'result-received', 'inspected', 'staged', 'reviewed', 'integrated',
  'rejected', 'failed', 'interrupted',
]);

const TRANSITIONS = new Map([
  ['exported', new Set(['result-received', 'rejected', 'failed', 'interrupted'])],
  ['result-received', new Set(['inspected', 'rejected', 'failed', 'interrupted'])],
  ['inspected', new Set(['staged', 'rejected', 'failed', 'interrupted'])],
  ['staged', new Set(['reviewed', 'rejected', 'failed', 'interrupted'])],
  ['reviewed', new Set(['integrated', 'rejected', 'failed', 'interrupted'])],
  ['integrated', new Set()],
  ['rejected', new Set()],
  ['failed', new Set()],
  ['interrupted', new Set()],
]);

function validateId(value, name) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) throw new AtbError('UNSAFE_LIFECYCLE_ID', `Invalid lifecycle ${name}`);
  return value;
}

function lifecyclePathInRoot(storageRoot, taskId, importId) {
  validateId(taskId, 'task ID');
  if (importId !== undefined && importId !== null) validateId(importId, 'import ID');
  return importId
    ? path.join(storageRoot, 'tasks', taskId, 'imports', importId, 'lifecycle.json')
    : path.join(storageRoot, 'tasks', taskId, 'lifecycle.json');
}

function lifecyclePath(repoRoot, taskId, importId) {
  return lifecyclePathInRoot(atbRoot(repoRoot), taskId, importId);
}

export function transitionLifecycle(record, nextState, details = {}) {
  if (!record || !LIFECYCLE_STATES.includes(record.state)) throw new AtbError('INVALID_LIFECYCLE', `Unknown current lifecycle state: ${record?.state}`);
  if (!LIFECYCLE_STATES.includes(nextState)) throw new AtbError('INVALID_LIFECYCLE', `Unknown lifecycle state: ${nextState}`);
  if (!TRANSITIONS.get(record.state).has(nextState)) throw new AtbError('INVALID_LIFECYCLE_TRANSITION', `Invalid lifecycle transition: ${record.state} -> ${nextState}`);
  if (['rejected', 'failed', 'interrupted'].includes(nextState) && !details.error && !details.code && !details.reason) {
    throw new AtbError('INVALID_LIFECYCLE_TRANSITION', `Recoverable lifecycle state ${nextState} requires error details`);
  }
  const event = { state: nextState, at: new Date().toISOString(), ...details };
  return { ...record, state: nextState, events: [...(record.events ?? []), event] };
}

export async function writeLifecycle(repoRoot, record) {
  const target = lifecyclePath(repoRoot, record.taskId, record.importId);
  await assertSafeStorageRoot(repoRoot);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify(record, null, 2), { encoding: 'utf8', flag: 'wx' });
  try {
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return target;
}

export async function loadLifecycle(repoRoot, taskId, importId) {
  await assertSafeStorageRoot(repoRoot, STORAGE_DIR);
  const target = lifecyclePath(repoRoot, taskId, importId);
  try { return JSON.parse(await readFile(target, 'utf8')); }
  catch (error) {
    if (error?.code !== 'ENOENT') throw new AtbError('INVALID_LIFECYCLE', `Lifecycle record is invalid: ${error.message}`);
  }
  const legacyDir = await safeExistingStorageDir(repoRoot, LEGACY_STORAGE_DIR);
  if (!legacyDir) return null;
  try { return JSON.parse(await readFile(lifecyclePathInRoot(legacyDir, taskId, importId), 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw new AtbError('INVALID_LIFECYCLE', `Lifecycle record is invalid: ${error.message}`);
  }
}
