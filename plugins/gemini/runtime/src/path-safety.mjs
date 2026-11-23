import path from 'node:path';
import { AtbError } from './errors.mjs';

const RESERVED_SEGMENTS = new Set(['.git', '.agent-task-bridge']);

export function normalizeRepoPath(input) {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    throw new AtbError('UNSAFE_PATH', 'Repository path must be a non-empty string');
  }
  if (/^[A-Za-z]:[\\/]/.test(input) || input.startsWith('\\\\') || input.startsWith('//') || input.startsWith('/')) {
    throw new AtbError('UNSAFE_PATH', `Absolute repository path is not allowed: ${input}`);
  }
  const replaced = input.replaceAll('\\', '/');
  const parts = replaced.split('/');
  if (parts.some((part) => RESERVED_SEGMENTS.has(part.toLowerCase()))) {
    throw new AtbError('UNSAFE_PATH', `Repository metadata/internal path is not allowed: ${input}`);
  }
  if (parts.some((part) => part === '..')) {
    throw new AtbError('UNSAFE_PATH', `Unsafe repository path contains parent traversal: ${input}`);
  }
  const normalized = path.posix.normalize(replaced).replace(/^\.\//, '');
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new AtbError('UNSAFE_PATH', `Unsafe repository path: ${input}`);
  }
  return normalized;
}

export function validateScopePattern(input) {
  if (typeof input !== 'string' || !input.trim()) throw new AtbError('UNSAFE_PATH', 'Scope pattern must be non-empty');
  const probe = input.replace(/[?*\[\]{}!]/g, 'x');
  normalizeRepoPath(probe);
  return input.replaceAll('\\', '/').replace(/^\.\//, '');
}
