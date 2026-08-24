import { readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from './process.mjs';
import { AtbError } from './errors.mjs';

async function exists(file) { try { await access(file); return true; } catch { return false; } }

async function packageManager(root, pkg) {
  if (typeof pkg.packageManager === 'string' && pkg.packageManager.trim()) return pkg.packageManager.split('@')[0];
  if (await exists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (await exists(path.join(root, 'yarn.lock'))) return 'yarn';
  if (await exists(path.join(root, 'bun.lockb')) || await exists(path.join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

function invocation(manager, script) {
  if (manager === 'npm') return script === 'test' ? { command: 'npm', args: ['test'] } : { command: 'npm', args: ['run', script] };
  if (manager === 'yarn') return { command: 'yarn', args: [script] };
  if (manager === 'pnpm') return { command: 'pnpm', args: [script] };
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
