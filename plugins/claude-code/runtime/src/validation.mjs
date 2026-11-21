import { readFile, readdir, access, mkdtemp, lstat, stat, mkdir, symlink, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { abortReason, runProcess } from './process.mjs';
import { AtbError } from './errors.mjs';
import { sha256Buffer } from './hash.mjs';

const VALIDATION_CONFIG_BASENAMES = new Set([
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb',
  'pnpm-workspace.yaml', 'lerna.json', 'nx.json', 'turbo.json', 'rush.json', '.npmrc', '.yarnrc', '.yarnrc.yml', '.pnpmfile.cjs',
  // Files that select which validation command or toolchain runs in other ecosystems.
  'composer.json', 'pyproject.toml', 'pytest.ini', 'setup.cfg', 'tox.ini', 'global.json', 'rust-toolchain', 'rust-toolchain.toml',
]);
export const VALIDATION_POLICIES = Object.freeze({ safe: 'safe', prompt: 'prompt', skip: 'skip' });
const SAFE_ENV_NAMES = new Set([
  'PATH', 'PATHEXT', 'SystemRoot', 'SystemDrive', 'ComSpec', 'WINDIR',
  'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'TERM',
  'ProgramFiles', 'ProgramFiles(x86)', 'CommonProgramFiles', 'CommonProgramFiles(x86)',
  'ProgramW6432', 'ProgramData', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE', 'OS',
  // Toolchain locations, not credentials: without them cargo, rustup, dotnet, and go lose their caches under the scrubbed HOME.
  'CARGO_HOME', 'RUSTUP_HOME', 'GOPATH', 'GOMODCACHE', 'GOROOT', 'NUGET_PACKAGES', 'DOTNET_ROOT', 'JAVA_HOME',
]);
// Default toolchain cache locations under the real home, passed through only when they exist.
const TOOLCHAIN_HOME_DEFAULTS = [['CARGO_HOME', '.cargo'], ['RUSTUP_HOME', '.rustup'], ['GOPATH', 'go'], ['NUGET_PACKAGES', path.join('.nuget', 'packages')]];
// Git-ignored dependency directories that staging links back to the active repository so validation can resolve them.
const DEPENDENCY_DIR_NAMES = new Set(['node_modules', 'vendor', '.venv', 'venv']);
const CMAKE_BUILD_DIR = '.atb-build';

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
  for (const [name, relative] of TOOLCHAIN_HOME_DEFAULTS) {
    if (env[name]) continue;
    const candidate = path.join(homedir(), relative);
    if (await exists(candidate)) env[name] = candidate;
  }
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
  for (const segment of repoPath.split('/').filter(Boolean)) {
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

async function findOnPath(command) {
  const extensions = process.platform === 'win32' && !path.extname(command)
    ? (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    : [''];
  for (const directory of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, command + extension);
      try { if ((await stat(candidate)).isFile()) return candidate; } catch { /* not here */ }
    }
  }
  return null;
}

// Returns null when the tool is not installed, so auto-detection never adds a command that cannot start.
async function resolveInvocation(command, args) {
  const resolved = await findOnPath(command);
  if (!resolved) return null;
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(resolved)) {
    return { command: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', path.basename(resolved), ...args] };
  }
  return { command, args };
}

function commandSpec(name, run, extra = {}) {
  return { name, ...extra, ...run, display: [run.command, ...run.args].join(' ') };
}

async function discoverNodeCommands(repoRoot) {
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
  return definitions.filter(([, script]) => typeof scripts[script] === 'string')
    .map(([name, script]) => commandSpec(name, invocation(manager, script), { script, packageManager: manager }));
}

async function fileIncludes(file, marker) {
  try { return (await readFile(file, 'utf8')).includes(marker); } catch { return false; }
}

async function usesPytest(root) {
  if (await exists(path.join(root, 'pytest.ini')) || await exists(path.join(root, 'conftest.py'))) return true;
  return await fileIncludes(path.join(root, 'pyproject.toml'), '[tool.pytest')
    || await fileIncludes(path.join(root, 'setup.cfg'), '[tool:pytest]')
    || await fileIncludes(path.join(root, 'tox.ini'), '[pytest]');
}

async function pythonInvocation(root, args) {
  for (const venv of ['.venv', 'venv']) {
    const relative = process.platform === 'win32' ? path.join(venv, 'Scripts', 'python.exe') : path.join(venv, 'bin', 'python');
    // Relative command: it runs with the staging root as cwd, where the venv is linked.
    if (await exists(path.join(root, relative))) return { command: relative, args };
  }
  return await resolveInvocation('python3', args) ?? await resolveInvocation('python', args);
}

async function discoverEcosystemCommands(root) {
  const specs = [];
  const add = async (name, command, args) => {
    const run = await resolveInvocation(command, args);
    if (run) specs.push(commandSpec(name, run));
  };
  let entries = [];
  try { entries = (await readdir(root)).sort(); } catch { return specs; }
  if (entries.includes('Cargo.toml')) await add('cargo-test', 'cargo', ['test']);
  if (entries.includes('go.mod')) await add('go-test', 'go', ['test', './...']);
  const dotnetTarget = entries.find((name) => /\.slnx?$/i.test(name)) ?? entries.find((name) => /\.(cs|fs|vb)proj$/i.test(name));
  if (dotnetTarget) await add('dotnet-test', 'dotnet', ['test', dotnetTarget]);
  if (entries.includes('CMakeLists.txt') && await findOnPath('cmake')) {
    await add('cmake-configure', 'cmake', ['-S', '.', '-B', CMAKE_BUILD_DIR]);
    await add('cmake-build', 'cmake', ['--build', CMAKE_BUILD_DIR, '--config', 'Debug']);
    await add('ctest', 'ctest', ['--test-dir', CMAKE_BUILD_DIR, '-C', 'Debug', '--output-on-failure']);
  }
  if (await usesPytest(root)) {
    const run = await pythonInvocation(root, ['-m', 'pytest', '-q']);
    if (run) specs.push(commandSpec('pytest', run));
  }
  if (entries.includes('composer.json')) {
    let composer = {};
    try { composer = JSON.parse(await readFile(path.join(root, 'composer.json'), 'utf8')); } catch { /* invalid composer.json: no command */ }
    if (composer.scripts?.test) await add('composer-test', 'composer', ['test']);
    else if (await exists(path.join(root, 'vendor', 'bin', 'phpunit'))) await add('phpunit', 'php', ['vendor/bin/phpunit']);
  }
  return specs;
}

export async function discoverValidationCommands(repoRoot) {
  return [...await discoverNodeCommands(repoRoot), ...await discoverEcosystemCommands(repoRoot)];
}

// Explicit config commands replace discovery. A missing tool stays visible as SKIPPED instead of silently disappearing.
export async function resolveValidationCommands(repoRoot, projectConfig = null) {
  const configured = projectConfig?.validationCommands ?? [];
  if (configured.length === 0) return discoverValidationCommands(repoRoot);
  const specs = [];
  for (const entry of configured) {
    const args = entry.args ?? [];
    specs.push(commandSpec(entry.name, await resolveInvocation(entry.command, args) ?? { command: entry.command, args }, { source: 'config' }));
  }
  return specs;
}

// shortcut: workspace symlinks inside a linked node_modules (pnpm/yarn workspaces) and Python editable
// installs still resolve to the active repo's packages, so cross-package monorepo tests can pass against
// unchanged code; use validationCommands with a per-package test when that matters.
export async function linkDependencyDirectories(repoRoot, stagingRoot) {
  const listed = await runProcess('git', ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], { cwd: repoRoot, allowFailure: true });
  if (listed.code !== 0) return [];
  const links = [];
  for (const entry of listed.stdout.split('\0')) {
    const relative = entry.replaceAll('\\', '/').replace(/\/+$/, '');
    const segments = relative.split('/');
    if (!relative || !DEPENDENCY_DIR_NAMES.has(segments.at(-1))) continue;
    if (segments.slice(0, -1).some((segment) => DEPENDENCY_DIR_NAMES.has(segment) || segment === '.git' || segment === '.agent-task-bridge')) continue;
    // Per-entry guard: an error must never lose track of links already created (cleanup still detaches them).
    try {
      const source = path.join(repoRoot, ...segments);
      const target = path.join(stagingRoot, ...segments);
      const sourceInfo = await lstat(source).catch(() => null);
      if (!sourceInfo?.isDirectory() || await hasLinkAncestor(repoRoot, relative)) continue;
      if (await lstat(target).catch(() => null)) continue;
      if (await hasLinkAncestor(stagingRoot, segments.slice(0, -1).join('/'))) continue;
      await mkdir(path.dirname(target), { recursive: true });
      await symlink(source, target, 'junction');
      links.push({ path: relative, target });
    } catch { /* validation reports the missing dependency instead */ }
  }
  return links;
}

// Removes only the link itself; never recurses, so the active repository's dependency directory is untouched.
export async function unlinkDependencyDirectories(links = []) {
  for (const link of links) {
    try { await unlink(link.target); }
    catch { await rmdir(link.target).catch(() => {}); }
  }
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

export async function captureValidationSnapshot(repoRoot, { projectConfig = null } = {}) {
  return {
    commands: await resolveValidationCommands(repoRoot, projectConfig),
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
