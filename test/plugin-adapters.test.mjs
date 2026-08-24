import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';

const root = process.cwd();

async function readJson(relative) {
  return JSON.parse(await readFile(path.join(root, relative), 'utf8'));
}

async function canonicalRuntimeFiles() {
  const src = (await readdir(path.join(root, 'src'))).filter((name) => name.endsWith('.mjs')).sort();
  return ['bin/agent-task-bridge.mjs', ...src.map((name) => `src/${name}`)];
}

for (const provider of ['claude-code', 'codex']) {
  test(`${provider} bundle contains an exact runnable copy of the shared runtime`, async () => {
    const files = await canonicalRuntimeFiles();
    for (const relative of files) {
      const canonical = await readFile(path.join(root, relative));
      const bundled = await readFile(path.join(root, 'plugins', provider, 'runtime', relative));
      assert.deepEqual(bundled, canonical, `${provider} runtime copy is stale: ${relative}`);
    }

    const bundledPackage = await readJson(`plugins/${provider}/runtime/package.json`);
    const rootPackage = await readJson('package.json');
    assert.equal(bundledPackage.version, rootPackage.version);
    assert.equal(bundledPackage.type, 'module');
    assert.deepEqual(bundledPackage.engines, rootPackage.engines);

    const result = await runProcess(process.execPath, [
      path.join(root, 'plugins', provider, 'runtime', 'bin', 'agent-task-bridge.mjs'),
      'version'
    ], { cwd: root });
    assert.equal(result.stdout.trim(), rootPackage.version);
  });
}

test('Claude Code plugin uses the current plugin manifest and namespaced user skills', async () => {
  const manifest = await readJson('plugins/claude-code/.claude-plugin/plugin.json');
  assert.equal(manifest.name, 'task-bridge');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.skills, './skills/');

  for (const name of ['export-chatgpt', 'import-chatgpt']) {
    const skill = await readFile(path.join(root, 'plugins', 'claude-code', 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(`name: ${name}`));
    assert.match(skill, /\$\{CLAUDE_PLUGIN_ROOT\}/);
    assert.match(skill, /runtime\/bin\/agent-task-bridge\.mjs/);
  }
  const exportSkill = await readFile(path.join(root, 'plugins', 'claude-code', 'skills', 'export-chatgpt', 'SKILL.md'), 'utf8');
  assert.match(exportSkill, /editable_scope/);
  assert.match(exportSkill, /acceptance_criteria/);
  assert.match(exportSkill, /agent-task-bridge\.mjs" export/);
  const importSkill = await readFile(path.join(root, 'plugins', 'claude-code', 'skills', 'import-chatgpt', 'SKILL.md'), 'utf8');
  assert.match(importSkill, /agent-task-bridge\.mjs" import/);
  assert.match(importSkill, /never/i);
  assert.match(importSkill, /active working tree/i);
});

test('Codex plugin declares the shared skills and self-contained runtime contract', async () => {
  const manifest = await readJson('plugins/codex/.codex-plugin/plugin.json');
  assert.equal(manifest.name, 'task-bridge');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.skills, './skills/');
  assert.equal(manifest.interface.displayName, 'Agent Task Bridge');
  assert.equal(manifest.interface.category, 'Developer Tools');

  for (const name of ['export-chatgpt', 'import-chatgpt']) {
    const skill = await readFile(path.join(root, 'plugins', 'codex', 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(`name: ${name}`));
    assert.match(skill, /plugin root/i);
    assert.match(skill, /runtime\/bin\/agent-task-bridge\.mjs/);
  }
  const exportSkill = await readFile(path.join(root, 'plugins', 'codex', 'skills', 'export-chatgpt', 'SKILL.md'), 'utf8');
  assert.match(exportSkill, /editable_scope/);
  assert.match(exportSkill, /acceptance_criteria/);
  assert.match(exportSkill, / export --delegation /);
  const importSkill = await readFile(path.join(root, 'plugins', 'codex', 'skills', 'import-chatgpt', 'SKILL.md'), 'utf8');
  assert.match(importSkill, / import /);
  assert.match(importSkill, /active working tree/i);
});

test('Codex documentation provides an explicit local marketplace install flow', async () => {
  const readme = await readFile(path.join(root, 'plugins', 'codex', 'README.md'), 'utf8');
  assert.match(readme, /codex plugin marketplace add/);
  assert.match(readme, /codex plugin add task-bridge@awesome-task-bridge/);
});

test('release package includes verification scripts and architecture documentation', async () => {
  const pkg = await readJson('package.json');
  assert.ok(pkg.files.includes('scripts'));
  assert.ok(pkg.files.includes('docs/architecture.md'));
});

test('repository ships local marketplace catalogs for both providers', async () => {
  const claudeMarket = await readJson('.claude-plugin/marketplace.json');
  assert.equal(claudeMarket.name, 'awesome-task-bridge');
  assert.equal(claudeMarket.plugins[0].name, 'task-bridge');
  assert.equal(claudeMarket.plugins[0].source, './plugins/claude-code');

  const codexMarket = await readJson('.agents/plugins/marketplace.json');
  assert.equal(codexMarket.name, 'awesome-task-bridge');
  assert.equal(codexMarket.plugins[0].name, 'task-bridge');
  assert.equal(codexMarket.plugins[0].source.source, 'local');
  assert.equal(codexMarket.plugins[0].source.path, './plugins/codex');
});

test('protocol, example, license, and user documentation ship with the package', async () => {
  const required = [
    '.claude-plugin/marketplace.json',
    '.agents/plugins/marketplace.json',
    'README.md',
    'LICENSE',
    'protocol/TASK-CAPSULE-v1.md',
    'protocol/RESULT-CAPSULE-v1.md',
    'examples/delegation.example.json',
    'plugins/claude-code/README.md',
    'plugins/codex/README.md'
  ];
  for (const relative of required) {
    const content = await readFile(path.join(root, relative), 'utf8');
    assert.ok(content.trim().length > 80, `${relative} must contain substantive documentation`);
  }

  const example = await readJson('examples/delegation.example.json');
  assert.ok(example.objective);
  assert.ok(example.work_unit);
  assert.ok(example.files && typeof example.files === 'object');
  assert.ok(Array.isArray(example.files.editable) && example.files.editable.length > 0);
  assert.ok(Array.isArray(example.editable_scope) && example.editable_scope.length > 0);
  assert.ok(Array.isArray(example.acceptance_criteria) && example.acceptance_criteria.length > 0);
});

test('protocol documentation describes schema, integrity, statuses, privacy, and evidence contracts', async () => {
  const taskProtocol = await readFile(path.join(root, 'protocol/TASK-CAPSULE-v1.md'), 'utf8');
  const resultProtocol = await readFile(path.join(root, 'protocol/RESULT-CAPSULE-v1.md'), 'utf8');
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');

  assert.match(taskProtocol, /schema_version/);
  assert.match(taskProtocol, /privacy/i);
  assert.match(resultProtocol, /schema_version/);
  assert.match(resultProtocol, /sha256/);
  assert.match(resultProtocol, /size_bytes/);
  assert.match(resultProtocol, /complete.*partial.*blocked.*research-only/s);
  assert.match(resultProtocol, /worker claims/i);
  assert.match(resultProtocol, /local evidence/i);
  assert.match(resultProtocol, /REPORT\.md/);
  assert.match(readme, /--max-tokens/);
  assert.match(readme, /acceptance criteria/i);
});
