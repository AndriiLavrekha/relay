import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AtbError } from './errors.mjs';
import { VALIDATION_POLICIES } from './validation.mjs';

export const PROJECT_CONFIG_FILENAME = 'config.json';
export const PROJECT_CONFIG_KEYS = Object.freeze(['maxTokens', 'validationPolicy', 'extraHostOwnedSteps']);

export function emptyProjectConfig() {
  return {
    present: false,
    path: null,
    maxTokens: null,
    validationPolicy: null,
    extraHostOwnedSteps: [],
  };
}

export function projectConfigPath(repoRoot) {
  return path.join(repoRoot, '.agent-task-bridge', PROJECT_CONFIG_FILENAME);
}

export function parseProjectConfig(text, filePath = PROJECT_CONFIG_FILENAME) {
  let value;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new AtbError('INVALID_PROJECT_CONFIG', `Cannot parse project config: ${error.message}`, { path: filePath });
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AtbError('INVALID_PROJECT_CONFIG', 'Project config must be a JSON object', { path: filePath });
  }
  const unknown = Object.keys(value).filter((key) => !PROJECT_CONFIG_KEYS.includes(key));
  if (unknown.length > 0) {
    throw new AtbError('INVALID_PROJECT_CONFIG', `Unknown project config keys: ${unknown.join(', ')}`, { path: filePath, keys: unknown });
  }
  const config = emptyProjectConfig();
  config.present = true;
  config.path = filePath;
  if (value.maxTokens !== undefined) {
    if (!Number.isInteger(value.maxTokens) || value.maxTokens < 1) {
      throw new AtbError('INVALID_PROJECT_CONFIG', 'maxTokens must be a positive integer', { path: filePath });
    }
    config.maxTokens = value.maxTokens;
  }
  if (value.validationPolicy !== undefined) {
    if (!Object.values(VALIDATION_POLICIES).includes(value.validationPolicy)) {
      throw new AtbError('INVALID_PROJECT_CONFIG', 'validationPolicy must be safe, prompt, or skip', { path: filePath });
    }
    config.validationPolicy = value.validationPolicy;
  }
  if (value.extraHostOwnedSteps !== undefined) {
    if (!Array.isArray(value.extraHostOwnedSteps) || value.extraHostOwnedSteps.some((item) => typeof item !== 'string' || !item.trim())) {
      throw new AtbError('INVALID_PROJECT_CONFIG', 'extraHostOwnedSteps must be an array of non-empty strings', { path: filePath });
    }
    config.extraHostOwnedSteps = value.extraHostOwnedSteps.map((item) => item.trim());
  }
  return config;
}

export function resolveMaxTokens(explicit, config) {
  if (explicit !== undefined && explicit !== null && explicit !== '') return Number(explicit);
  return config?.maxTokens ?? null;
}

export function resolveValidationPolicy(explicit, config) {
  if (explicit !== undefined && explicit !== null && explicit !== '') return explicit;
  return config?.validationPolicy ?? 'safe';
}

export function applyExtraHostOwnedSteps(raw, delegation, config) {
  const extras = config?.extraHostOwnedSteps ?? [];
  if (raw?.host_owned_steps !== undefined || extras.length === 0) return delegation;
  const seen = new Set(delegation.host_owned_steps);
  const hostOwnedSteps = [...delegation.host_owned_steps];
  for (const step of extras) {
    if (seen.has(step)) continue;
    seen.add(step);
    hostOwnedSteps.push(step);
  }
  return { ...delegation, host_owned_steps: hostOwnedSteps };
}

export async function loadProjectConfig(repoRoot) {
  const filePath = projectConfigPath(repoRoot);
  let info;
  try {
    info = await lstat(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyProjectConfig();
    throw error;
  }
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new AtbError('INVALID_PROJECT_CONFIG', 'Project config must be a regular file', { path: filePath });
  }
  return parseProjectConfig(await readFile(filePath, 'utf8'), filePath);
}
