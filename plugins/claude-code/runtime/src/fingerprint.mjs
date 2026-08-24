import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

export async function fingerprintProject(repoRoot) {
  const packagePath = path.join(repoRoot, 'package.json');
  let pkg = {};
  try { pkg = JSON.parse(await readFile(packagePath, 'utf8')); } catch {}
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const knownFrameworks = ['fastify', 'express', 'koa', 'hapi', 'nestjs', '@nestjs/core', 'next', 'react', 'vue', 'svelte', 'vitest', 'jest'];
  const frameworks = knownFrameworks.filter((name) => Object.hasOwn(deps, name));
  let packageManager = null;
  if (typeof pkg.packageManager === 'string') packageManager = pkg.packageManager.split('@')[0];
  if (!packageManager && await exists(path.join(repoRoot, 'pnpm-lock.yaml'))) packageManager = 'pnpm';
  if (!packageManager && await exists(path.join(repoRoot, 'yarn.lock'))) packageManager = 'yarn';
  if (!packageManager && await exists(path.join(repoRoot, 'package-lock.json'))) packageManager = 'npm';
  if (!packageManager && await exists(packagePath)) packageManager = 'npm';
  return {
    project_name: pkg.name ?? path.basename(repoRoot),
    ecosystem: await exists(packagePath) ? 'node' : 'unknown',
    runtime: { node: process.version },
    node_requirement: pkg.engines?.node ?? null,
    package_manager: packageManager,
    package_manager_declared: pkg.packageManager ?? null,
    typescript: await exists(path.join(repoRoot, 'tsconfig.json')) || Object.hasOwn(deps, 'typescript'),
    frameworks,
    scripts: pkg.scripts ?? {},
  };
}
