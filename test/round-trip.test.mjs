import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { exportTask } from '../src/exporter.mjs';
import { importResult } from '../src/importer.mjs';
import { createZip } from '../src/zip.mjs';
import { sha256Buffer } from '../src/hash.mjs';
import { loadStoredTask } from '../src/storage.mjs';
import { detectElision, eolStyle } from '../src/elision.mjs';
import { parseResultReply } from '../src/reply.mjs';
import { discoverValidationCommands, linkDependencyDirectories, resolveValidationCommands } from '../src/validation.mjs';
import { cleanupIsolatedStaging, createIsolatedStaging } from '../src/staging.mjs';
import { parseProjectConfig } from '../src/config.mjs';
import { briefReview } from '../src/review.mjs';

const LONG_FILE = Array.from({ length: 60 }, (_, i) => `export const v${i} = ${i};`).join('\n') + '\n';

async function exists(file) { try { await access(file); return true; } catch { return false; } }

async function fixture({ files = {}, scripts = { test: 'node -e "process.exit(0)"' }, ignore = ['node_modules/'] } = {}) {
  const repo = await mkdtemp(path.join(tmpdir(), 'atb-round-trip-'));
  const all = {
    'package.json': JSON.stringify({ name: 'fixture', private: true, scripts }, null, 2) + '\n',
    '.gitignore': ignore.join('\n') + '\n',
    'src/a.js': 'export const a = 1;\n',
    ...files,
  };
  for (const [relative, content] of Object.entries(all)) {
    await mkdir(path.dirname(path.join(repo, relative)), { recursive: true });
    await writeFile(path.join(repo, relative), content);
  }
  await runProcess('git', ['init', '-b', 'main'], { cwd: repo });
  await runProcess('git', ['add', '.'], { cwd: repo });
  await runProcess('git', ['-c', 'user.email=test@example.invalid', '-c', 'user.name=ATB Test', 'commit', '-m', 'initial'], { cwd: repo });
  const editable = Object.keys(all).filter((relative) => relative.startsWith('src/'));
  const exported = await exportTask({
    repoRoot: repo,
    sourceAgent: 'test',
    delegationRequest: {
      objective: 'Change the fixture', work_unit: 'Edit src files', work_type: 'code', title: 'Fixture task',
      deliverables: ['Complete files'], editable_scope: ['src/**'], acceptance_criteria: ['Values change'], non_goals: [],
      files: { editable, reference: [], contract: [], validation: ['package.json'], configuration: [] },
    },
  });
  const task = await loadStoredTask(repo, exported.taskId);
  return { repo, taskId: exported.taskId, task, base: task.manifest.project.base_commit };
}

async function resultZip(value, files, { status = 'complete', report = null } = {}) {
  const entries = [];
  const declared = files.map(({ path: repoPath, content, operation = 'modify' }) => {
    if (operation === 'delete') return { path: repoPath, operation };
    const data = Buffer.from(content);
    entries.push({ name: `files/${repoPath}`, data });
    return { path: repoPath, operation, sha256: sha256Buffer(data), size_bytes: data.length };
  });
  const manifest = { atb_protocol: '1.0', capsule_type: 'result', schema_version: '1.1', hash_algorithm: 'sha256', status, task_id: value.taskId, source_base_commit: value.base, files: declared };
  entries.unshift({ name: 'manifest.json', data: JSON.stringify(manifest) });
  if (report) entries.push({ name: 'REPORT.md', data: report });
  const zipPath = path.join(value.repo, '..', `${path.basename(value.repo)}-result.zip`);
  await writeFile(zipPath, createZip(entries));
  return zipPath;
}

function statuses(report) {
  return Object.fromEntries(report.files.map((file) => [file.path, file.status]));
}

test('staging validation resolves git-ignored node_modules and leaves the real directory intact', async () => {
  const value = await fixture({ scripts: { test: 'node -e "require(\'fake-dep\')"' } });
  await mkdir(path.join(value.repo, 'node_modules', 'fake-dep'), { recursive: true });
  await writeFile(path.join(value.repo, 'node_modules', 'fake-dep', 'index.js'), 'module.exports = 1;\n');
  const zip = await resultZip(value, [{ path: 'src/a.js', content: 'export const a = 2;\n' }]);
  const report = await importResult({ repoRoot: value.repo, resultPath: zip, validationPolicy: 'safe' });
  assert.equal(statuses(report)['src/a.js'], 'CLEAN_UNCHANGED');
  assert.deepEqual(report.validation.dependencyLinks, ['node_modules']);
  assert.equal(report.validation.results.find((result) => result.name === 'test').status, 'PASS');
  assert.equal(await exists(path.join(report.stagingRoot, 'node_modules')), false, 'link is removed after validation');
  assert.equal(await exists(path.join(value.repo, 'node_modules', 'fake-dep', 'index.js')), true, 'real dependency directory survives');
});

test('staging cleanup never deletes the real dependency directory through a live link', async () => {
  const value = await fixture();
  await mkdir(path.join(value.repo, 'node_modules', 'fake-dep'), { recursive: true });
  await writeFile(path.join(value.repo, 'node_modules', 'fake-dep', 'index.js'), 'module.exports = 1;\n');
  const staging = await createIsolatedStaging(value.repo, value.taskId, { selectedPaths: [] });
  const links = await linkDependencyDirectories(value.repo, staging.stagingRoot);
  assert.equal(links.length, 1);
  const cleanup = await cleanupIsolatedStaging({ repoRoot: value.repo, stagingRoot: staging.stagingRoot });
  assert.equal(cleanup.removed, true);
  assert.equal(await exists(path.join(value.repo, 'node_modules', 'fake-dep', 'index.js')), true);
});

test('abbreviated files are withheld as SUSPECT_ELISION', async () => {
  const value = await fixture({ files: { 'src/long.js': LONG_FILE } });
  const zip = await resultZip(value, [
    { path: 'src/a.js', content: 'export const a = 2;\n// ... rest of the file unchanged\n' },
    { path: 'src/long.js', content: 'export const v0 = 1;\n' },
  ]);
  const report = await importResult({ repoRoot: value.repo, resultPath: zip, validationPolicy: 'skip' });
  assert.deepEqual(statuses(report), { 'src/a.js': 'SUSPECT_ELISION', 'src/long.js': 'SUSPECT_ELISION' });
  assert.equal(report.stagedFiles.length, 0);
  assert.equal(report.files[0].elision.markers[0].line, 2);
  assert.deepEqual(report.files[1].elision.shrink, { baselineLines: 61, resultLines: 2 });

  const allowed = await importResult({ repoRoot: value.repo, resultPath: zip, validationPolicy: 'skip', allowElision: true });
  assert.deepEqual(statuses(allowed), { 'src/a.js': 'CLEAN_UNCHANGED', 'src/long.js': 'CLEAN_UNCHANGED' });
  assert.equal(allowed.files[0].elision.allowed, true);
});

test('elision markers already present in the baseline are not flagged', () => {
  const baseline = 'x();\n// rest of the file unchanged is documented here\n';
  assert.equal(detectElision({ content: `y();\n${baseline}`, baselineContent: baseline }).suspect, false);
  assert.equal(detectElision({ content: 'const ellipsis = "...";\n', baselineContent: null }).suspect, false);
  assert.equal(detectElision({ content: '// keep existing logic for retries\nf();\n', baselineContent: null }).suspect, false);
  assert.equal(detectElision({ content: 'f();\n// ... existing code ...\n', baselineContent: null }).suspect, true);
  assert.equal(detectElision({ content: 'f();\n    # rest of the function unchanged\n', baselineContent: null }).suspect, true);
});

test('locally changed files merge three-way when the edits do not overlap', async () => {
  const value = await fixture({ files: { 'src/long.js': LONG_FILE } });
  await writeFile(path.join(value.repo, 'src', 'long.js'), LONG_FILE.replace('export const v59 = 59;', 'export const v59 = 590;'));
  const zip = await resultZip(value, [{ path: 'src/long.js', content: LONG_FILE.replace('export const v0 = 0;', 'export const v0 = 100;') }]);
  const report = await importResult({ repoRoot: value.repo, resultPath: zip, validationPolicy: 'skip' });
  assert.equal(statuses(report)['src/long.js'], 'MERGED_CLEAN');
  const staged = await readFile(path.join(report.stagingRoot, 'src', 'long.js'), 'utf8');
  assert.match(staged, /v0 = 100;/);
  assert.match(staged, /v59 = 590;/);
  assert.equal(await readFile(path.join(value.repo, 'src', 'long.js'), 'utf8'), LONG_FILE.replace('export const v59 = 59;', 'export const v59 = 590;'), 'active tree is untouched');
});

test('overlapping local and worker edits stay withheld with a conflict-marker candidate', async () => {
  const value = await fixture();
  await writeFile(path.join(value.repo, 'src', 'a.js'), 'export const a = 3;\n');
  const zip = await resultZip(value, [{ path: 'src/a.js', content: 'export const a = 2;\n' }]);
  const report = await importResult({ repoRoot: value.repo, resultPath: zip, validationPolicy: 'skip' });
  const file = report.files[0];
  assert.equal(file.status, 'LOCAL_CHANGED');
  assert.equal(file.merge.conflicts, 1);
  assert.match(await readFile(file.merge.conflictMarkersPath, 'utf8'), /<<<<<<< local/);
});

test('LF results are normalized to a CRLF baseline before drift and staging', async () => {
  const value = await fixture({ files: { 'src/crlf.js': 'a();\r\nb();\r\n' } });
  assert.equal(eolStyle('a\r\nb\r\n'), 'crlf');
  const zip = await resultZip(value, [{ path: 'src/crlf.js', content: 'a();\nc();\n' }]);
  const report = await importResult({ repoRoot: value.repo, resultPath: zip, validationPolicy: 'skip' });
  assert.equal(report.files[0].eolNormalized, true);
  assert.equal(await readFile(path.join(report.stagingRoot, 'src', 'crlf.js'), 'utf8'), 'a();\r\nc();\r\n');
});

test('a saved text reply imports with host-computed hashes and derived operations', async () => {
  const value = await fixture();
  const boundary = value.task.manifest.file_boundary;
  const reply = [
    'Here is the result.',
    `<<<ATB_RESULT:${boundary}>>>`,
    'status: partial',
    'summary: Changed a, added b',
    `<<<ATB_FILE:${boundary}>>> src/a.js`,
    '````js',
    'export const a = 2;',
    '````',
    `<<<ATB_END:${boundary}>>>`,
    `<<<ATB_FILE:${boundary}>>> \`src/b.js\``,
    '````js',
    'export const b = 1;',
    '',
    '// trailing comment',
    '````',
    `<<<ATB_END:${boundary}>>>`,
    `<<<ATB_REPORT:${boundary}>>>`,
    '## Summary',
    'Done partly.',
    '## Unresolved work / follow-up',
    '- more',
    `<<<ATB_END:${boundary}>>>`,
  ].join('\r\n');
  const replyPath = path.join(value.repo, '..', `${path.basename(value.repo)}-reply.md`);
  await writeFile(replyPath, reply);
  const report = await importResult({ repoRoot: value.repo, resultPath: replyPath, validationPolicy: 'skip' });
  assert.equal(report.transport, 'text-reply');
  assert.equal(report.resultStatus, 'partial');
  assert.deepEqual(statuses(report), { 'src/a.js': 'CLEAN_UNCHANGED', 'src/b.js': 'NEW_EXPECTED' });
  assert.equal(await readFile(path.join(report.stagingRoot, 'src', 'a.js'), 'utf8'), 'export const a = 2;\n');
  assert.equal(await readFile(path.join(report.stagingRoot, 'src', 'b.js'), 'utf8'), 'export const b = 1;\n\n// trailing comment\n');
});

test('a truncated text reply is rejected instead of staging a partial file', () => {
  const boundary = 'ATB_atb_x_0123456789abcdef';
  assert.throws(() => parseResultReply(`<<<ATB_RESULT:${boundary}>>>\n<<<ATB_FILE:${boundary}>>> src/a.js\nexport const a`), (error) => error.code === 'INVALID_RESULT_REPLY');
});

test('the packer script embedded in the capsule produces an importable Result Capsule', async (t) => {
  const python = (await runProcess('python3', ['--version'], { allowFailure: true }).catch(() => null))?.code === 0 ? 'python3'
    : (await runProcess('python', ['--version'], { allowFailure: true }).catch(() => null))?.code === 0 ? 'python' : null;
  if (!python) return t.skip('Python is not available');
  const value = await fixture();
  const capsule = await readFile(path.join(value.repo, '.agent-task-bridge', 'tasks', value.taskId, 'task.md'), 'utf8');
  const start = capsule.indexOf('```python\n') + '```python\n'.length;
  const script = capsule.slice(start, capsule.indexOf('```', start));
  const sandbox = await mkdtemp(path.join(tmpdir(), 'atb-packer-'));
  await writeFile(path.join(sandbox, 'pack_result.py'), script);
  await mkdir(path.join(sandbox, 'atb_out', 'files', 'src'), { recursive: true });
  await writeFile(path.join(sandbox, 'atb_out', 'files', 'src', 'a.js'), 'export const a = 2;\n');
  await writeFile(path.join(sandbox, 'atb_out', 'files', 'src', 'new.js'), 'export const n = 1;\n');
  const out = path.join(sandbox, 'result.zip');
  const run = await runProcess(python, ['pack_result.py', '--status', 'complete', '--summary', 'packed', '--out', out], { cwd: sandbox, allowFailure: true });
  assert.equal(run.code, 0, run.stdout + run.stderr);
  const report = await importResult({ repoRoot: value.repo, resultPath: out, validationPolicy: 'skip' });
  assert.deepEqual(statuses(report), { 'src/a.js': 'CLEAN_UNCHANGED', 'src/new.js': 'NEW_EXPECTED' });
  assert.equal(report.resultSummary, 'packed');

  await writeFile(path.join(sandbox, 'atb_out', 'files', 'src', 'a.js'), 'export const a = 3;\n// ... existing code\n');
  const warned = await runProcess(python, ['pack_result.py', '--status', 'complete', '--out', out], { cwd: sandbox, allowFailure: true });
  assert.match(warned.stdout, /ELISION/);
  await rm(sandbox, { recursive: true, force: true });
});

test('result manifests cannot name a stored task outside the task directory', async () => {
  const value = await fixture();
  const zip = await resultZip({ ...value, taskId: '../../escape' }, [{ path: 'src/a.js', content: 'x\n' }]);
  await assert.rejects(() => importResult({ repoRoot: value.repo, resultPath: zip, validationPolicy: 'skip' }), (error) => error.code === 'UNSAFE_TASK_ID');
});

test('validation discovery finds installed ecosystem tools and config commands replace discovery', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-ecosystem-'));
  const bin = await mkdtemp(path.join(tmpdir(), 'atb-fake-bin-'));
  await writeFile(path.join(root, 'Cargo.toml'), '[package]\nname = "x"\n');
  await writeFile(path.join(root, 'go.mod'), 'module x\n');
  const fake = process.platform === 'win32' ? 'cargo.cmd' : 'cargo';
  await writeFile(path.join(bin, fake), process.platform === 'win32' ? '@exit /b 0\r\n' : '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  const previous = process.env.PATH;
  process.env.PATH = bin;
  try {
    const commands = await discoverValidationCommands(root);
    assert.deepEqual(commands.map((command) => command.name), ['cargo-test'], 'go is not installed on this PATH, so it is not proposed');
    if (process.platform === 'win32') assert.deepEqual(commands[0].args.slice(-2).map((arg) => arg.toLowerCase()), ['cargo.cmd', 'test']);
    const config = parseProjectConfig(JSON.stringify({ validationCommands: [{ name: 'unit', command: 'cargo', args: ['test', '--lib'] }], validationTimeoutMs: 600000 }));
    assert.equal(config.validationTimeoutMs, 600000);
    const configured = await resolveValidationCommands(root, config);
    assert.deepEqual(configured.map((command) => [command.name, command.source]), [['unit', 'config']]);
  } finally {
    process.env.PATH = previous;
  }
  assert.throws(() => parseProjectConfig(JSON.stringify({ validationCommands: [{ name: 'x' }] })), (error) => error.code === 'INVALID_PROJECT_CONFIG');
});

test('briefReview keeps decisions and failing output tails only', () => {
  const brief = briefReview({
    task: { taskId: 't' }, result: { status: 'complete' }, partial: false,
    validation: { passed: false, results: [{ name: 'test', status: 'FAIL', exitCode: 1, stdout: 'x'.repeat(10) + '\n'.repeat(50) + 'last line', stderr: '' }, { name: 'lint', status: 'PASS', exitCode: 0, stdout: 'big', stderr: '' }] },
    acceptance: { overallStatus: 'unverified', criteria: [{ id: 'c1', status: 'unverified', text: 'Works', evidence: [] }] },
  }, { importId: 'i', files: [{ path: 'a', status: 'CLEAN_UNCHANGED', appliedToStaging: true }, { path: 'b', status: 'SUSPECT_ELISION', appliedToStaging: false }] });
  assert.equal(brief.validation.results[0].outputTail.split('\n').length <= 30, true);
  assert.equal('outputTail' in brief.validation.results[1], false);
  assert.deepEqual(brief.withheld.map((file) => file.status), ['SUSPECT_ELISION']);
  assert.match(brief.next, /Validation failed/);
});
