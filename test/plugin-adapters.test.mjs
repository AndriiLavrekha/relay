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
  assert.equal(manifest.version, (await readJson('package.json')).version);
  assert.equal(manifest.skills, './skills/');

  for (const name of ['plan-chatgpt', 'export-chatgpt', 'import-chatgpt']) {
    const skill = await readFile(path.join(root, 'plugins', 'claude-code', 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(`name: ${name}`));
    assert.match(skill, /\$\{CLAUDE_PLUGIN_ROOT\}/);
    assert.match(skill, /runtime\/bin\/agent-task-bridge\.mjs/);
  }
  const planSkill = await readFile(path.join(root, 'plugins', 'claude-code', 'skills', 'plan-chatgpt', 'SKILL.md'), 'utf8');
  assert.match(planSkill, /editable_scope/);
  assert.match(planSkill, /acceptance_criteria/);
  assert.match(planSkill, /host_owned_steps/);
  assert.match(planSkill, /seam/i);
  const exportSkill = await readFile(path.join(root, 'plugins', 'claude-code', 'skills', 'export-chatgpt', 'SKILL.md'), 'utf8');
  assert.match(exportSkill, /editable_scope/);
  assert.match(exportSkill, /acceptance_criteria/);
  assert.match(exportSkill, /agent-task-bridge\.mjs" export/);
  assert.match(exportSkill, /kickoff\.md|--max-tokens/);
  assert.match(exportSkill, /host_owned_steps/);
  assert.match(exportSkill, /CONTEXT_COVERAGE_GAP/);
  const importSkill = await readFile(path.join(root, 'plugins', 'claude-code', 'skills', 'import-chatgpt', 'SKILL.md'), 'utf8');
  assert.match(importSkill, /agent-task-bridge\.mjs" import/);
  assert.match(importSkill, /never/i);
  assert.match(importSkill, /active working tree/i);
  assert.match(importSkill, /review/);
  assert.match(importSkill, /follow-up/);
  assert.match(importSkill, /integrate.*confirm/i);
  assert.match(importSkill, /deferred_to_host/);
  assert.match(importSkill, /REPORT\.md/);
});

test('Codex plugin declares the shared skills and self-contained runtime contract', async () => {
  const manifest = await readJson('plugins/codex/.codex-plugin/plugin.json');
  assert.equal(manifest.name, 'task-bridge');
  assert.equal(manifest.version, (await readJson('package.json')).version);
  assert.equal(manifest.skills, './skills/');
  assert.equal(manifest.interface.displayName, 'Agent Task Bridge');
  assert.equal(manifest.interface.category, 'Developer Tools');

  for (const name of ['plan-chatgpt', 'export-chatgpt', 'import-chatgpt']) {
    const skill = await readFile(path.join(root, 'plugins', 'codex', 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(`name: ${name}`));
    assert.match(skill, /plugin root/i);
    assert.match(skill, /runtime\/bin\/agent-task-bridge\.mjs/);
  }
  const planSkill = await readFile(path.join(root, 'plugins', 'codex', 'skills', 'plan-chatgpt', 'SKILL.md'), 'utf8');
  assert.match(planSkill, /editable_scope/);
  assert.match(planSkill, /acceptance_criteria/);
  assert.match(planSkill, /host_owned_steps/);
  assert.match(planSkill, /seam/i);
  const exportSkill = await readFile(path.join(root, 'plugins', 'codex', 'skills', 'export-chatgpt', 'SKILL.md'), 'utf8');
  assert.match(exportSkill, /editable_scope/);
  assert.match(exportSkill, /acceptance_criteria/);
  assert.match(exportSkill, / export --delegation /);
  assert.match(exportSkill, /kickoff\.md|--max-tokens/);
  assert.match(exportSkill, /host_owned_steps/);
  assert.match(exportSkill, /CONTEXT_COVERAGE_GAP/);
  const importSkill = await readFile(path.join(root, 'plugins', 'codex', 'skills', 'import-chatgpt', 'SKILL.md'), 'utf8');
  assert.match(importSkill, / import /);
  assert.match(importSkill, /active working tree/i);
  assert.match(importSkill, /review/);
  assert.match(importSkill, /follow-up/);
  assert.match(importSkill, /integrate.*confirm/i);
  assert.match(importSkill, /deferred_to_host/);
  assert.match(importSkill, /REPORT\.md/);
});

test('Gemini plugin declares Antigravity and Gemini CLI manifests, shared skills, and install docs', async () => {
  const rootPackage = await readJson('package.json');
  const manifest = await readJson('plugins/gemini/.gemini-plugin/plugin.json');
  assert.equal(manifest.name, 'task-bridge');
  assert.equal(manifest.version, rootPackage.version);
  assert.equal(manifest.displayName, 'Agent Task Bridge');
  assert.equal(manifest.category, 'Developer Tools');
  assert.equal(manifest.license, 'MIT');
  assert.ok(manifest.description && manifest.description.length > 10);
  assert.ok(manifest.author?.name);
  assert.ok(manifest.repository);
  assert.ok(manifest.homepage);
  assert.ok(Array.isArray(manifest.keywords) && manifest.keywords.includes('gemini'));
  await assert.rejects(readdir(path.join(root, 'plugins', 'gemini', 'commands')), { code: 'ENOENT' });

  const ext = await readJson('plugins/gemini/gemini-extension.json');
  assert.equal(ext.name, 'task-bridge');
  assert.equal(ext.version, rootPackage.version);
  assert.ok(ext.description && ext.description.length > 10);

  for (const name of ['plan-chatgpt', 'export-chatgpt', 'import-chatgpt']) {
    const skill = await readFile(path.join(root, 'plugins', 'gemini', 'skills', name, 'SKILL.md'), 'utf8');
    assert.match(skill, new RegExp(`name: ${name}`));
    assert.match(skill, /runtime\/bin\/agent-task-bridge\.mjs/);
    assert.match(skill, /bin\/agent-task-bridge\.mjs/);
  }
  const planSkill = await readFile(path.join(root, 'plugins', 'gemini', 'skills', 'plan-chatgpt', 'SKILL.md'), 'utf8');
  assert.match(planSkill, /editable_scope/);
  assert.match(planSkill, /acceptance_criteria/);
  assert.match(planSkill, /host_owned_steps/);
  assert.match(planSkill, /seam/i);
  const exportSkill = await readFile(path.join(root, 'plugins', 'gemini', 'skills', 'export-chatgpt', 'SKILL.md'), 'utf8');
  assert.match(exportSkill, /--source-agent gemini/);
  assert.match(exportSkill, /editable_scope/);
  assert.match(exportSkill, /acceptance_criteria/);
  assert.match(exportSkill, / export --delegation /);
  assert.match(exportSkill, /kickoff\.md|--max-tokens/);
  assert.match(exportSkill, /host_owned_steps/);
  assert.match(exportSkill, /CONTEXT_COVERAGE_GAP/);
  const importSkill = await readFile(path.join(root, 'plugins', 'gemini', 'skills', 'import-chatgpt', 'SKILL.md'), 'utf8');
  assert.match(importSkill, / import /);
  assert.match(importSkill, /active working tree/i);
  assert.match(importSkill, /review/);
  assert.match(importSkill, /follow-up/);
  assert.match(importSkill, /integrate.*confirm/i);
  assert.match(importSkill, /deferred_to_host/);
  assert.match(importSkill, /REPORT\.md/);

  const readme = await readFile(path.join(root, 'plugins', 'gemini', 'README.md'), 'utf8');
  assert.match(readme, /gemini extensions/);
  assert.match(readme, /agy plugin/);
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
  assert.ok(pkg.files.includes('docs/releases/v0.2.0.md'));
  assert.ok(pkg.files.includes('docs/releases/v0.2.1.md'));
  assert.ok(pkg.files.includes('docs/releases/v0.2.2.md'));
  assert.ok(pkg.files.includes('docs/releases/v0.2.3.md'));
  assert.ok(pkg.files.includes('docs/releases/v0.3.0.md'));
  assert.ok(pkg.files.includes('docs/releases/v0.3.1.md'));
  assert.ok(pkg.files.includes('docs/releases/v0.3.2.md'));
  assert.ok(pkg.files.includes('docs/releases/v0.3.3.md'));
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
    'plugins/codex/README.md',
    'docs/releases/v0.2.0.md'
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

test('v0.2 documentation records the shipped safety boundaries and deferred transport', async () => {
  const readme = await readFile(path.join(root, 'README.md'), 'utf8');
  const architecture = await readFile(path.join(root, 'docs', 'architecture.md'), 'utf8');
  const release = await readFile(path.join(root, 'docs', 'releases', 'v0.2.0.md'), 'utf8');
  for (const content of [readme, architecture, release]) {
    assert.match(content, /(external|outside).{0,40}staging/i);
    assert.match(content, /privacy/i);
    assert.match(content, /(block|confirmation)/i);
    assert.match(content, /schema.{0,20}1\.1/i);
    assert.match(content, /receipt/i);
    assert.match(content, /follow-up/i);
    assert.match(content, /integrate.{0,40}confirm/i);
  }
  assert.match(release, /manual file upload/i);
  assert.match(release, /automatic (API|transport).*(deferred|outside)/is);
  assert.match(release, /OS-level sandboxing.*deferred/is);
  assert.match(release, /same-volume fallback/i);
});

test('experimental browser delegation is a Claude Code only, user-invoked, caution-gated skill', async () => {
  const skill = await readFile(path.join(root, 'plugins', 'claude-code', 'skills', 'delegate-chatgpt-browser', 'SKILL.md'), 'utf8');
  assert.match(skill, /name: delegate-chatgpt-browser/);
  assert.match(skill, /disable-model-invocation: true/);
  assert.match(skill, /EXPERIMENTAL/);
  assert.match(skill, /Terms of Use/);
  assert.match(skill, /explicit yes/);
  assert.match(skill, /Never enter credentials/);
  await assert.rejects(readFile(path.join(root, 'plugins', 'codex', 'skills', 'delegate-chatgpt-browser', 'SKILL.md'), 'utf8'), { code: 'ENOENT' });
});
