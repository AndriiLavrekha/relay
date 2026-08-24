import { matchesAnyScope } from './glob.mjs';

export function classifyDrift({ path, operation, baseline, current, editableScope }) {
  if (!matchesAnyScope(path, editableScope)) return 'OUT_OF_SCOPE';
  const base = baseline.get(path);
  if (base) {
    if (!current.exists) return 'DELETED_LOCALLY';
    return current.sha256 === base.sha256 ? 'CLEAN_UNCHANGED' : 'LOCAL_CHANGED';
  }
  if (operation === 'create') return current.exists ? 'NEW_UNEXPECTED' : 'NEW_EXPECTED';
  return 'BASELINE_MISSING';
}
