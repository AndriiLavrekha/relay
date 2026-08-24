import { normalizeRepoPath } from './path-safety.mjs';

function globToRegExp(pattern) {
  let source = '^';
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') { source += '.*'; i++; }
      else source += '[^/]*';
    } else if (ch === '?') source += '[^/]';
    else source += ch.replace(/[\\^$+?.()|{}\[\]]/g, '\\$&');
  }
  return new RegExp(`${source}$`);
}

export function matchesAnyScope(repoPath, patterns = []) {
  const normalized = normalizeRepoPath(repoPath);
  return patterns.some((pattern) => globToRegExp(pattern.replaceAll('\\', '/').replace(/^\.\//, '')).test(normalized));
}
