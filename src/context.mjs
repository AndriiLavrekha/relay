import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { AtbError } from './errors.mjs';
import { sha256Buffer } from './hash.mjs';
import { matchesAnyScope, partitionScopePatterns } from './glob.mjs';
import { normalizeRepoPath } from './path-safety.mjs';
import { scanFileForSecrets } from './secrets.mjs';
import { runProcess } from './process.mjs';

const ROLE_PRIORITY = new Map([
  ['editable', 50], ['contract', 40], ['validation', 30], ['reference', 20], ['configuration', 10]
]);

export const KNOWN_BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp', '.tiff',
  '.pdf', '.zip', '.tar', '.gz', '.tgz', '.7z', '.rar',
  '.woff', '.woff2', '.ttf', '.eot', '.otf',
  '.exe', '.dll', '.so', '.dylib', '.class', '.jar', '.bin', '.pyc', '.wasm',
  '.mp4', '.webm', '.mp3', '.wav', '.ogg', '.flac',
]);

const DEFAULT_MAX_REPO_FILES = 50_000;
const DEFAULT_MAX_FINDINGS = 50;

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
  const fileBreakdown = files.map((file) => ({
    path: file.path,
    role: file.role,
    size_bytes: file.size_bytes,
    estimated_tokens: Math.ceil(file.size_bytes / 4),
  }));
  const totalBytes = files.reduce((sum, file) => sum + file.size_bytes, 0);
  return {
    files,
    repositoryTree: files.map((file) => file.path),
    embedded_bytes: embeddedBytes,
    estimated_tokens: Math.ceil(totalBytes / 4),
    file_breakdown: fileBreakdown,
  };
}

function isBridgeMetadataPath(repoPath) {
  const normalized = String(repoPath ?? '').replaceAll('\\', '/').replace(/^\.\//, '');
  return normalized === '.git' || normalized.startsWith('.git/')
    || normalized === '.relay' || normalized.startsWith('.relay/')
    || normalized === '.agent-task-bridge' || normalized.startsWith('.agent-task-bridge/');
}

function isBinaryPath(repoPath) {
  return KNOWN_BINARY_EXTENSIONS.has(path.posix.extname(repoPath).toLowerCase());
}

function isLiteralScopePath(pattern) {
  return typeof pattern === 'string' && pattern.length > 0 && !/[*?[\]]/.test(pattern);
}

function selectedPathSet(selectedFiles) {
  let values = [];
  if (selectedFiles instanceof Map) values = [...selectedFiles.keys()];
  else if (Array.isArray(selectedFiles)) values = selectedFiles.map((file) => (typeof file === 'string' ? file : file?.path)).filter(Boolean);
  else if (selectedFiles && typeof selectedFiles === 'object') values = Object.keys(selectedFiles);
  const selected = new Set();
  for (const value of values) {
    try { selected.add(normalizeRepoPath(value)); }
    catch { selected.add(value); }
  }
  return selected;
}

function parseGitList(stdout) {
  return stdout.split('\0').map((item) => item.replaceAll('\\', '/').replace(/^\.\//, '')).filter(Boolean);
}

async function gitPathList(repoRoot, args) {
  const result = await runProcess('git', args, { cwd: repoRoot, allowFailure: true });
  if (result.code !== 0) return { ok: false, paths: [], error: result.stderr?.trim() || `git exited ${result.code}` };
  return { ok: true, paths: parseGitList(result.stdout) };
}

function intendedNewFile(repoPath, delegation) {
  const sources = [delegation?.objective ?? '', ...(delegation?.deliverables ?? [])];
  return sources.some((value) => typeof value === 'string' && value.includes(repoPath));
}

async function literalExists(repoRoot, repoPath) {
  try {
    await lstat(path.join(repoRoot, ...repoPath.split('/')));
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

export async function evaluateContextCoverage(repoRoot, delegation, selectedFiles, options = {}) {
  const maxRepoFiles = options.maxRepoFiles ?? DEFAULT_MAX_REPO_FILES;
  const maxFindings = options.maxFindings ?? DEFAULT_MAX_FINDINGS;
  const scopePatterns = delegation?.editable_scope ?? [];
  const scope = partitionScopePatterns(scopePatterns);
  const selectedPaths = selectedPathSet(selectedFiles);
  const [tracked, untracked] = await Promise.all([
    gitPathList(repoRoot, ['ls-files', '-z']),
    gitPathList(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']),
  ]);
  const candidates = new Set();
  for (const repoPath of [...tracked.paths, ...untracked.paths]) {
    if (isBridgeMetadataPath(repoPath)) continue;
    candidates.add(repoPath);
  }
  const sorted = [...candidates].sort((a, b) => a.localeCompare(b));
  const candidateScanCapped = sorted.length > maxRepoFiles;
  const scanned = candidateScanCapped ? sorted.slice(0, maxRepoFiles) : sorted;
  const omittedFiles = [];
  let totalOmittedCount = 0;
  for (const candidate of scanned) {
    if (isBinaryPath(candidate)) continue;
    if (!matchesAnyScope(candidate, scope)) continue;
    if (selectedPaths.has(candidate)) continue;
    totalOmittedCount += 1;
    if (omittedFiles.length < maxFindings) {
      const pattern = scope.positive.find((item) => item.regex.test(candidate))?.pattern;
      omittedFiles.push({ path: candidate, ...(pattern ? { pattern } : {}), reason: 'OMITTED_MATCHING_FILE' });
    }
  }
  const scopeViolations = [];
  for (const rawPath of delegation?.files?.editable ?? []) {
    let repoPath = rawPath;
    try { repoPath = normalizeRepoPath(rawPath); } catch { repoPath = rawPath; }
    if (!matchesAnyScope(repoPath, scope)) {
      scopeViolations.push({
        path: repoPath,
        reason: 'EDITABLE_OUTSIDE_SCOPE',
        message: 'File is in files.editable but not covered by editable_scope; will be withheld as OUT_OF_SCOPE on import',
      });
    }
  }
  const missingRepoPaths = [];
  for (const compiled of scope.positive) {
    if (!isLiteralScopePath(compiled.normalized)) continue;
    let repoPath;
    try { repoPath = normalizeRepoPath(compiled.normalized); } catch { continue; }
    if (await literalExists(repoRoot, repoPath)) continue;
    if (intendedNewFile(repoPath, delegation)) {
      missingRepoPaths.push({ path: repoPath, reason: 'INTENDED_NEW_FILE', message: 'Literal scope path is named for worker creation and is not in the repository yet' });
    } else {
      missingRepoPaths.push({ path: repoPath, reason: 'NOT_FOUND_IN_REPO', message: 'Literal scope path not found in repository' });
    }
  }
  const discoveryError = !tracked.ok || !untracked.ok
    ? [tracked.error, untracked.error].filter(Boolean).join('; ')
    : null;
  const hasGaps = totalOmittedCount > 0 || scopeViolations.length > 0 || missingRepoPaths.length > 0 || Boolean(discoveryError);
  return {
    hasGaps,
    totalOmittedCount,
    omittedFiles,
    scopeViolations,
    missingRepoPaths,
    candidateScanCapped,
    ...(discoveryError ? { discoveryError } : {}),
  };
}
