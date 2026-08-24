import { readFile, access, mkdtemp, lstat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { abortReason, runProcess } from './process.mjs';
import { AtbError } from './errors.mjs';
import { sha256Buffer } from './hash.mjs';

const VALIDATION_CONFIG_BASENAMES = new Set([
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json', 'rush.json', '.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs',
]);
export const VALIDATION_POLICIES = Object.freeze({ safe: 'safe', prompt: 'prompt', skip: 'skip' });
const SAFE_ENV_NAMES = new Set([
  'PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'ComSpec', 'WINDIR',
  'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'TERM',
  'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles', 'CommonProgramFiles(x86)',
]);

async function exists(file) { try { await access(file); return true; } catch { return false; } }

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal, 'Validation interrupted');
}

export async function buildValidationEnvironment({ repoRoot, policy = VALIDATION_POLICIES.safe } = {}) {
  if (!Object.values(VALIDATION_POLICIES).includes(policy)) throw new AtbError('VALIDATION_POLICY_INVALID', `Unknown validation policy: ${policy}`);
  const home = await mkdtemp(path.join(tmpdir(), 'atb-validation-home-'));
  const env = {};
  const removedNames = [];
  for (const [name, value] of Object.entries(process.env)) {
    if (SAFE_ENV_NAMES.has(name)) env[name] = value;
    else removedNames.push(name);
  }
  env.HOME = home;
  env.USERPROFILE = home;
  env.APPDATA = path.join(home, 'AppData', 'Roaming');
  env.LOCALAPPDATA = path.join(home, 'AppData', 'Local');
  env.XDG_CONFIG_HOME = path.join(home, '.config');
  if (process.platform === 'win32' && process.env.ComSpec) env.ComSpec = process.env.ComSpec;
  return { env, policyName: policy, removedNames: removedNames.sort(), home, repoRoot };
}

async function packageManager(root, pkg) {
  if (typeof pkg.packageManager === 'string' && pkg.packageManager.trim()) return pkg.packageManager.split('@')[0];
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(root, 'bun.lockb')) || await exists(path.join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

async function hasLinkAncestor(repoRoot, repoPath) {
  let current = repoRoot;
  for (const segment of repoPath.split('/')) {
    current = path.join(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) return true;
    } catch (error) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }
  return false;
}

export async function discoverValidationConfigFiles(repoRoot) {
  const result = await runProcess('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repoRoot, allowFailure: true });
  if (result.code !== 0) throw new AtbError('GIT_CONFIG_DISCOVERY_FAILED', 'Failed to enumerate Git-visible validation configuration files', result);
  const candidates = result.stdout.split('\0').filter(Boolean).map((value) => value.replaceAll('\\', '/'));
  const files = [];
  for (const relative of candidates) {
    if (relative === '.git' || relative.startsWith('.git/') || relative === '.agent-task-bridge' || relative.startsWith('.agent-task-bridge/') || relative.split('/').includes('node_modules')) continue;
    if (!VALIDATION_CONFIG_BASENAMES.has(path.posix.basename(relative))) continue;
    if (await hasLinkAncestor(repoRoot, relative)) continue;
    files.push(relative);
  }
  return [...new Set(files)].sort();
}

function invocation(manager, script) {
  const args = manager === 'npm' ? (script === 'test' ? ['test'] : ['run', script]) : [script];
  if (process.platform === 'win32' && ['npm', 'yarn', 'pnpm'].includes(manager)) {
    return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', `${manager}.cmd`, ...args] };
  }
  if (manager === 'npm') return { command: manager, args };
  if (manager === 'yarn') return { command: manager, args };
  if (manager === 'pnpm') return { command: manager, args };
  if (manager === 'bun') return { command: 'bun', args: ['run', script] };
  return { command: manager, args: ['run', script] };
}

export async function discoverValidationCommands(repoRoot) {
  let pkg;
  try { pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8')); }
  catch { return []; }
  const manager = await packageManager(repoRoot, pkg);
  const scripts = pkg.scripts ?? {};
  const definitions = [
    ['format', 'format:check'],
    ['lint', 'lint'],
    ['typecheck', 'typecheck'],
    ['test', 'test'],
    ['build', 'build'],
  ];
  return definitions.filter(([, script]) => typeof scripts[script] === 'string').map(([name, script]) => {
    const run = invocation(manager, script);
    return { name, script, packageManager: manager, ...run, display: [run.command, ...run.args].join(' ') };
  });
}

async function snapshotValidationConfig(repoRoot) {
  const files = {};
  for (const relative of await discoverValidationConfigFiles(repoRoot)) {
    try {
      files[relative] = sha256Buffer(await readFile(path.join(repoRoot, relative)));
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return files;
}

export async function captureValidationSnapshot(repoRoot) {
  return {
    commands: await discoverValidationCommands(repoRoot),
    config: { files: await snapshotValidationConfig(repoRoot) },
  };
}

export async function validationConfigChanged(repoRoot, snapshot) {
  const current = await snapshotValidationConfig(repoRoot);
  const expected = snapshot?.config?.files ?? snapshot?.config ?? {};
  const paths = [...new Set([...Object.keys(expected), ...Object.keys(current)])].sort();
  const changedPaths = paths.filter((relative) => expected[relative] !== current[relative]);
  return { changed: changedPaths.length > 0, paths: changedPaths };
}

export async function runValidation(stagingRoot, commands, {
  signal,
  policy = VALIDATION_POLICIES.safe,
  confirmed = false,
  timeoutMs = 120_000,
  maxOutputBytes = 512_000,
  repoRoot = stagingRoot,
} = {}) {
  if (policy === VALIDATION_POLICIES.skip) return { passed: null, policy, skipped: true, results: [] };
  if (policy === VALIDATION_POLICIES.prompt && !confirmed) throw new AtbError('VALIDATION_CONFIRMATION_REQUIRED', 'Validation requires explicit confirmation under the prompt policy');
  const environment = await buildValidationEnvironment({ repoRoot, policy });
  const results = [];
  for (const spec of commands) {
    throwIfAborted(signal);
    const started = Date.now();
    try {
      const processResult = await runProcess(spec.command, spec.args ?? [], {
        cwd: stagingRoot,
        env: environment.env,
        envMode: 'provided',
        allowFailure: true,
        signal,
        timeoutMs,
        maxOutputBytes,
        killTree: true,
      });
      results.push({
        name: spec.name,
        command: spec.display ?? [spec.command, ...(spec.args ?? [])].join(' '),
        args: spec.args ?? [],
        cwd: stagingRoot,
        status: processResult.timedOut ? 'TIMEOUT' : processResult.code === 0 ? 'PASS' : 'FAIL',
        exitCode: processResult.code,
        signal: processResult.signal,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        stdoutTruncated: processResult.stdoutTruncated,
        stderrTruncated: processResult.stderrTruncated,
        timedOut: processResult.timedOut,
        killMethod: processResult.killMethod,
        durationMs: processResult.durationMs ?? Date.now() - started,
      });
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal, 'Validation interrupted');
      if (error instanceof AtbError && error.code === 'PROCESS_START_FAILED') {
        results.push({ name: spec.name, command: spec.display ?? spec.command, args: spec.args ?? [], cwd: stagingRoot, status: 'SKIPPED', exitCode: null, signal: null, stdout: '', stderr: error.message, stdoutTruncated: false, stderrTruncated: false, timedOut: false, killMethod: null, durationMs: Date.now() - started });
      } else throw error;
    }
  }
  return {
    passed: results.length === 0 ? null : results.every((result) => result.status === 'PASS'),
    policy,
    skipped: false,
    environment: { policy: environment.policyName, removedNames: environment.removedNames },
    results,
  };
}
