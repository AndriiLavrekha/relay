#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const runtimePackage = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  type: pkg.type,
  engines: pkg.engines,
  private: true,
};

for (const provider of ['claude-code', 'codex', 'gemini']) {
  const runtime = path.join(root, 'plugins', provider, 'runtime');
  await rm(runtime, { recursive: true, force: true });
  await mkdir(runtime, { recursive: true });
  await cp(path.join(root, 'src'), path.join(runtime, 'src'), { recursive: true });
  await cp(path.join(root, 'bin'), path.join(runtime, 'bin'), { recursive: true });
  await writeFile(path.join(runtime, 'package.json'), `${JSON.stringify(runtimePackage, null, 2)}\n`, 'utf8');
}

const rootSkills = path.join(root, 'skills');
await rm(rootSkills, { recursive: true, force: true });
await cp(path.join(root, 'plugins', 'gemini', 'skills'), rootSkills, { recursive: true });
