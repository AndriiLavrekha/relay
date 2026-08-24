import { AtbError } from './errors.mjs';
import { normalizeRepoPath, validateScopePattern } from './path-safety.mjs';

const ROLES = ['editable', 'reference', 'contract', 'validation', 'configuration'];

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new AtbError('INVALID_DELEGATION', `Delegation ${name} is required`);
  return value.trim();
}

function stringList(value, name, { required = false } = {}) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new AtbError('INVALID_DELEGATION', `Delegation ${name} must be an array of non-empty strings`);
  }
  if (required && value.length === 0) throw new AtbError('INVALID_DELEGATION', `Delegation ${name} cannot be empty`);
  return value.map((item) => item.trim());
}

export function validateDelegationRequest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AtbError('INVALID_DELEGATION', 'Delegation request must be an object');
  const workType = typeof value.work_type === 'string' && value.work_type.trim() ? value.work_type.trim() : 'code';
  const filesInput = value.files ?? {};
  if (typeof filesInput !== 'object' || Array.isArray(filesInput)) throw new AtbError('INVALID_DELEGATION', 'Delegation files must be an object');
  const files = {};
  for (const role of ROLES) files[role] = stringList(filesInput[role], `files.${role}`).map(normalizeRepoPath);
  const editableScope = stringList(value.editable_scope, 'editable_scope', { required: workType === 'code' }).map(validateScopePattern);
  return {
    objective: requiredString(value.objective, 'objective'),
    work_unit: requiredString(value.work_unit, 'work_unit'),
    work_type: workType,
    title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : requiredString(value.work_unit, 'work_unit'),
    current_work_state: typeof value.current_work_state === 'string' ? value.current_work_state.trim() : '',
    deliverables: stringList(value.deliverables, 'deliverables'),
    editable_scope: editableScope,
    acceptance_criteria: stringList(value.acceptance_criteria, 'acceptance_criteria'),
    non_goals: stringList(value.non_goals, 'non_goals'),
    architecture_context: typeof value.architecture_context === 'string' ? value.architecture_context.trim() : '',
    files,
  };
}

export const FILE_ROLES = Object.freeze(ROLES);
