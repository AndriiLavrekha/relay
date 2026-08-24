import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AtbError } from './errors.mjs';
import { sha256Buffer } from './hash.mjs';
import { normalizeRepoPath } from './path-safety.mjs';
import { scanFileForSecrets } from './secrets.mjs';
import { runProcess } from './process.mjs';

const ROLE_PRIORITY = new Map([
  ['editable', 50], ['contract', 40], ['validation', 30], ['reference', 20], ['configuration', 10]
]);

const LANGUAGE_BY_EXT = new Map([
  ['.ts', 'typescript'], ['.tsx', 'typescript'], ['.mts', 'typescript'], ['.cts', 'typescript'],
  ['.js', 'javascript'], ['.jsx', 'javascript'], ['.mjs', 'javascript'], ['.cjs', 'javascript'],
  ['.json', 'json'], ['.md', 'markdown'], ['.yaml', 'yaml'], ['.yml', 'yaml'], ['.toml', 'toml'],
  ['.py', 'python'], ['.rs', 'rust'], ['.go', 'go'], ['.cs', 'csharp'], ['.java', 'java'], ['.cpp', 'cpp'], ['.h', 'cpp']
]);

function languageFor(file) {
  const base = path.posix.basename(file);
  if (base === 'Dockerfile') return 'dockerfile';
  return LANGUAGE_BY_EXT.get(path.posix.extname(file).toLowerCase()) ?? 'text';
}

async function safeContextStat(repoRoot, repoPath) {
  const segments = repoPath.split('/');
  let current = repoRoot;
  let info = null;
  for (let i = 0; i < segments.length; i++) {
    current = path.join(current, segments[i]);
    try { info = await lstat(current); }
    catch { throw new AtbError('CONTEXT_FILE_MISSING', `Selected context file does not exist: ${repoPath}`); }
    if (info.isSymbolicLink()) {
      throw new AtbError('CONTEXT_SYMLINK_UNSUPPORTED', `Selected context path crosses a symlink, unsupported in v1: ${repoPath}`);
    }
    if (i < segments.length - 1 && !info.isDirectory()) {
      throw new AtbError('CONTEXT_NOT_FILE', `Selected context path cannot be resolved as a regular repository file: ${repoPath}`);
    }
  }
  return info;
}

async function isGitIgnored(repoRoot, repoPath) {
  const result = await runProcess('git', ['check-ignore', '-q', '--', repoPath], { cwd: repoRoot, allowFailure: true });
  if (result.code === 0) return true;
  if (result.code === 1) return false;
  throw new AtbError('GIT_IGNORE_CHECK_FAILED', `Failed to evaluate Git ignore rules for: ${repoPath}`, result);
}

export async function collectContext(repoRoot, delegation, options = {}) {
  const maxFileBytes = options.maxFileBytes ?? 200_000;
  const maxEmbeddedBytes = options.maxEmbeddedBytes ?? 2_000_000;
  const selected = new Map();
  for (const [role, paths] of Object.entries(delegation.files ?? {})) {
    for (const rawPath of paths ?? []) {
      const normalized = normalizeRepoPath(rawPath);
      const previous = selected.get(normalized);
      if (!previous || (ROLE_PRIORITY.get(role) ?? 0) > (ROLE_PRIORITY.get(previous) ?? 0)) selected.set(normalized, role);
    }
  }
  const files = [];
  let embeddedBytes = 0;
  for (const [repoPath, role] of selected) {
    const fullPath = path.join(repoRoot, ...repoPath.split('/'));
    const info = await safeContextStat(repoRoot, repoPath);
    if (!info.isFile()) throw new AtbError('CONTEXT_NOT_FILE', `Selected context path is not a file: ${repoPath}`);
    const secret = await scanFileForSecrets(repoRoot, repoPath);
    if (secret.blocked) throw new AtbError('SENSITIVE_CONTEXT', `Selected context file is secret/sensitive: ${repoPath}`, secret);
    if (await isGitIgnored(repoRoot, repoPath)) {
      throw new AtbError('IGNORED_CONTEXT', `Selected context file is ignored by Git and is excluded by default: ${repoPath}`);
    }
    if (info.size > maxFileBytes) throw new AtbError('CONTEXT_FILE_TOO_LARGE', `Selected context file exceeds ${maxFileBytes} bytes: ${repoPath}`);
    if (embeddedBytes + info.size > maxEmbeddedBytes) {
      throw new AtbError('CONTEXT_BUDGET_EXCEEDED', `Selected context exceeds the ${maxEmbeddedBytes} byte aggregate limit`, { maxEmbeddedBytes, nextFile: repoPath });
    }
    const buffer = await readFile(fullPath);
    if (buffer.includes(0)) throw new AtbError('BINARY_CONTEXT_UNSUPPORTED', `Binary context is not supported in v1: ${repoPath}`);
    const content = buffer.toString('utf8');
    embeddedBytes += buffer.length;
    files.push({
      path: repoPath,
      role,
      sha256: sha256Buffer(buffer),
      size_bytes: buffer.length,
      language: languageFor(repoPath),
      content,
    });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const totalChars = files.reduce((sum, file) => sum + file.content.length, 0);
  return {
    files,
    repositoryTree: files.map((file) => file.path),
    embedded_bytes: embeddedBytes,
    estimated_tokens: Math.ceil(totalChars / 4),
  };
}
