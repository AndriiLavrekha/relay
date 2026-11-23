import { matchesAnyScope } from './glob.mjs';

export function classifyDrift({ path, operation, baseline, current, editableScope }) {
  if (!matchesAnyScope(path, editableScope)) return 'OUT_OF_SCOPE';
  if (operation === 'create') {
    return baseline.has(path) || current.exists ? 'INVALID_OPERATION_PRECONDITION' : 'NEW_EXPECTED';
  }
  if (operation === 'modify' || operation === 'delete') {
    if (!baseline.has(path) || !current.exists) return 'INVALID_OPERATION_PRECONDITION';
    return current.sha256 === baseline.get(path).sha256 ? 'CLEAN_UNCHANGED' : 'LOCAL_CHANGED';
  }
  return 'INVALID_OPERATION_PRECONDITION';
}
