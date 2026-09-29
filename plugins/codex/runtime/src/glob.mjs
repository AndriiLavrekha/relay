import { normalizeRepoPath } from './path-safety.mjs';

function normalizeGlobPattern(pattern) {
  let normalized = String(pattern ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
  const isNegative = normalized.startsWith('!');
  if (isNegative) normalized = normalized.slice(1).trim().replace(/^\.\//, '');
  normalized = normalized.replace(/\*{3,}/g, '**');
  let previous;
  do {
    previous = normalized;
    normalized = normalized.replace(/\*\*(?:\/\*\*)+/g, '**');
  } while (normalized !== previous);
  return { normalized, isNegative };
}

function globToRegExp(pattern) {
  let source = '';
  for (let i = 0; i < pattern.length; i++) {
    if (pattern.startsWith('**/', i)) {
      source += '(?:[^/]+/)*';
      i += 2;
      continue;
    }
    if (pattern.startsWith('**', i)) {
      source += '(?:[^/]+/)*[^/]*';
      i += 1;
      continue;
    }
    const ch = pattern[i];
    if (ch === '*') source += '[^/]*';
    else if (ch === '?') source += '[^/]';
    else source += ch.replace(/[\\^$+?.()|{}\[\]]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

export function compileGlob(pattern) {
  const { normalized, isNegative } = normalizeGlobPattern(pattern);
  return {
    pattern: String(pattern ?? ''),
    normalized,
    isNegative,
    regex: globToRegExp(normalized),
  };
}

export function matchesGlob(repoPath, pattern) {
  const compiled = pattern && typeof pattern === 'object' && pattern.regex ? pattern : compileGlob(pattern);
  return compiled.regex.test(normalizeRepoPath(repoPath));
}

export function partitionScopePatterns(patterns = []) {
  const positive = [];
  const negative = [];
  for (const pattern of patterns ?? []) {
    const compiled = pattern && typeof pattern === 'object' && pattern.regex ? pattern : compileGlob(pattern);
    (compiled.isNegative ? negative : positive).push(compiled);
  }
  return { positive, negative };
}

export function matchesAnyScope(repoPath, patterns = []) {
  const normalized = normalizeRepoPath(repoPath);
  const partitioned = Array.isArray(patterns) ? partitionScopePatterns(patterns) : patterns;
  const positive = partitioned?.positive ?? [];
  const negative = partitioned?.negative ?? [];
  if (positive.length === 0) return false;
  if (!positive.some((item) => item.regex.test(normalized))) return false;
  if (negative.some((item) => item.regex.test(normalized))) return false;
  return true;
}
