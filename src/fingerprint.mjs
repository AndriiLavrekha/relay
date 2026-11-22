import { readFile, access } from 'node:fs/promises';
import path from 'node:path';

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

const TS_OPTIONS = [
  'strict', 'strictNullChecks', 'noImplicitAny', 'noUncheckedIndexedAccess', 'exactOptionalPropertyTypes',
  'noImplicitOverride', 'noImplicitReturns', 'noUnusedLocals', 'noUnusedParameters', 'verbatimModuleSyntax',
  'target', 'module', 'moduleResolution',
];
const TOOLING = ['typescript', 'vitest', 'jest', 'eslint', 'prettier'];

// tsconfig is JSONC: drop comments (outside strings) and trailing commas before parsing.
function parseJsonc(text) {
  const stripped = text.replace(/"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m) => (m[0] === '"' ? m : ''));
  return JSON.parse(stripped.replace(/,(\s*[}\]])/g, '$1'));
}

// Follows relative `extends` chains so strictness set in a shared base config is reported too.
async function readTsOptions(file, depth = 0) {
  let config;
  try { config = parseJsonc(await readFile(file, 'utf8')); } catch { return {}; }
  const parent = typeof config.extends === 'string' && config.extends.startsWith('.') && depth < 5
    ? await readTsOptions(path.resolve(path.dirname(file), config.extends.endsWith('.json') ? config.extends : `${config.extends}.json`), depth + 1)
    : {};
  return { ...parent, ...(config.compilerOptions ?? {}) };
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
  const tsconfig = await exists(path.join(repoRoot, 'tsconfig.json'));
  const tsOptions = tsconfig ? await readTsOptions(path.join(repoRoot, 'tsconfig.json')) : {};
  return {
    project_name: pkg.name ?? path.basename(repoRoot),
    ecosystem: await exists(packagePath) ? 'node' : 'unknown',
    runtime: { node: process.version },
    node_requirement: pkg.engines?.node ?? null,
    package_manager: packageManager,
    package_manager_declared: pkg.packageManager ?? null,
    typescript: tsconfig || Object.hasOwn(deps, 'typescript'),
    ...(tsconfig ? { typescript_options: Object.fromEntries(TS_OPTIONS.filter((key) => key in tsOptions).map((key) => [key, tsOptions[key]])) } : {}),
    tooling: Object.fromEntries(TOOLING.filter((name) => Object.hasOwn(deps, name)).map((name) => [name, deps[name]])),
    frameworks,
    scripts: pkg.scripts ?? {},
  };
}
