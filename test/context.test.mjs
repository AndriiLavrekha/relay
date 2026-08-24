import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { fingerprintProject } from '../src/fingerprint.mjs';
import { collectContext } from '../src/context.mjs';

async function makeNodeRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-node-'));
  await runProcess('git', ['init', '-b', 'main'], { cwd: root });
  await runProcess('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await runProcess('git', ['config', 'user.name', 'ATB Test'], { cwd: root });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'fixture-service',
    packageManager: 'npm@10.9.2',
    engines: { node: '>=22' },
    scripts: { test: 'node --test', lint: 'node --check src/index.js', build: 'node --check src/index.js' },
    dependencies: { fastify: '^5.0.0' },
    devDependencies: { typescript: '^5.9.0' }
  }, null, 2));
  await writeFile(path.join(root, 'package-lock.json'), '{"lockfileVersion":3}\n');
  await writeFile(path.join(root, 'tsconfig.json'), '{"compilerOptions":{}}\n');
  await writeFile(path.join(root, 'src', 'index.ts'), 'export const value: number = 1;\n');
  await runProcess('git', ['add', '.'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: root });
  return root;
}

test('fingerprintProject identifies Node/npm/TypeScript scripts and frameworks', async () => {
  const root = await makeNodeRepo();
  const fp = await fingerprintProject(root);
  assert.equal(fp.project_name, 'fixture-service');
  assert.equal(fp.ecosystem, 'node');
  assert.equal(fp.package_manager, 'npm');
  assert.equal(fp.typescript, true);
  assert.equal(fp.node_requirement, '>=22');
  assert.equal(fp.scripts.test, 'node --test');
  assert.deepEqual(fp.frameworks, ['fastify']);
  const nodeMajor = Number(fp.runtime.node.replace(/^v/, '').split('.')[0]);
  assert.ok(nodeMajor >= 22, `expected Node.js >=22, got ${fp.runtime.node}`);
});

test('collectContext reads exact working-tree content and de-duplicates files by strongest role', async () => {
  const root = await makeNodeRepo();
  await writeFile(path.join(root, 'src', 'index.ts'), 'export const value: number = 2; // dirty\n');
  const result = await collectContext(root, {
    files: {
      editable: ['src/index.ts'],
      reference: ['src/index.ts'],
      contract: [],
      validation: [],
      configuration: ['package.json']
    }
  });
  assert.equal(result.files.length, 2);
  const source = result.files.find((file) => file.path === 'src/index.ts');
  assert.equal(source.role, 'editable');
  assert.equal(source.content, 'export const value: number = 2; // dirty\n');
  assert.match(source.sha256, /^[0-9a-f]{64}$/);
  assert.equal(source.language, 'typescript');
  assert.ok(result.estimated_tokens > 0);
  assert.deepEqual(result.repositoryTree, ['package.json', 'src/index.ts']);
});

test('collectContext rejects binary source files', async () => {
  const root = await makeNodeRepo();
  await writeFile(path.join(root, 'src', 'binary.dat'), Buffer.from([0, 1, 2, 3]));
  await assert.rejects(() => collectContext(root, {
    files: { editable: ['src/binary.dat'], reference: [], contract: [], validation: [], configuration: [] }
  }), /binary/i);
});


test('collectContext rejects Git-ignored selected files by default', async () => {
  const root = await makeNodeRepo();
  await writeFile(path.join(root, '.gitignore'), 'local-only.txt\n');
  await writeFile(path.join(root, 'local-only.txt'), 'ordinary but intentionally local\n');
  await assert.rejects(() => collectContext(root, {
    files: { editable: [], reference: ['local-only.txt'], contract: [], validation: [], configuration: [] }
  }), (error) => error?.code === 'IGNORED_CONTEXT');
});

test('collectContext rejects selections that exceed the aggregate context byte budget', async () => {
  const root = await makeNodeRepo();
  await writeFile(path.join(root, 'src', 'a.ts'), 'export const a = 12345;\n');
  await writeFile(path.join(root, 'src', 'b.ts'), 'export const b = 67890;\n');
  await assert.rejects(() => collectContext(root, {
    files: { editable: ['src/a.ts', 'src/b.ts'], reference: [], contract: [], validation: [], configuration: [] }
  }, { maxEmbeddedBytes: 20 }), (error) => error?.code === 'CONTEXT_BUDGET_EXCEEDED');
});
