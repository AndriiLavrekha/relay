import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './process.mjs';
import { AtbError } from './errors.mjs';
import { sha256Buffer } from './hash.mjs';

const VALIDATION_CONFIG_FILES = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb'];

async function exists(file) { try { await access(file); return true; } catch { return false; } }

async function packageManager(root, pkg) {
  if (typeof pkg.packageManager === 'string' && pkg.packageManager.trim()) return pkg.packageManager.split('@')[0];
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(root, 'bun.lockb')) || await exists(path.join(root, 'bun.lock'))) return 'bun';
  return 'npm';
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
  for (const relative of VALIDATION_CONFIG_FILES) {
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
    config: await snapshotValidationConfig(repoRoot),
  };
}

export async function validationConfigChanged(repoRoot, snapshot) {
  const current = await snapshotValidationConfig(repoRoot);
  const paths = new Set([...Object.keys(snapshot.config), ...Object.keys(current)]);
  return [...paths].some((relative) => snapshot.config[relative] !== current[relative]);
}

export async function runValidation(stagingRoot, commands) {
  const results = [];
  for (const spec of commands) {
    const started = Date.now();
    try {
      const processResult = await runProcess(spec.command, spec.args ?? [], { cwd: stagingRoot, allowFailure: true });
      results.push({
        name: spec.name,
        command: spec.display ?? [spec.command, ...(spec.args ?? [])].join(' '),
        status: processResult.code === 0 ? 'PASS' : 'FAIL',
        exitCode: processResult.code,
        stdout: processResult.stdout,
        stderr: processResult.stderr,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      if (error instanceof AtbError && error.code === 'PROCESS_START_FAILED') {
        results.push({ name: spec.name, command: spec.display ?? spec.command, status: 'SKIPPED', exitCode: null, stdout: '', stderr: error.message, durationMs: Date.now() - started });
      } else throw error;
    }
  }
  return {
    passed: results.length === 0 ? null : results.every((result) => result.status === 'PASS'),
    results,
  };
}
