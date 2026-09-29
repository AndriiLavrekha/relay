import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { evaluateContextCoverage } from '../src/context.mjs';
import { exportTask } from '../src/exporter.mjs';
import { renderTaskCapsule } from '../src/task-capsule.mjs';

async function git(root, args) {
  const result = await runProcess('git', args, { cwd: root });
  assert.equal(result.code, 0, result.stderr);
  return result;
}

async function makeRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-coverage-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'test@example.invalid']);
  await git(root, ['config', 'user.name', 'ATB Test']);
  await mkdir(path.join(root, 'src', 'skip'), { recursive: true });
  await mkdir(path.join(root, 'assets'), { recursive: true });
  await mkdir(path.join(root, 'build'), { recursive: true });
  await writeFile(path.join(root, '.gitignore'), 'build/\n');
  await writeFile(path.join(root, 'src', 'kept.js'), 'export const kept = 1;\n');
  await writeFile(path.join(root, 'src', 'omitted.js'), 'export const omitted = 1;\n');
  await writeFile(path.join(root, 'src', 'skip', 'hidden.js'), 'export const hidden = 1;\n');
  await writeFile(path.join(root, 'assets', 'logo.png'), 'not-really-binary');
  await writeFile(path.join(root, 'build', 'cache.js'), 'export const cache = 1;\n');
  await writeFile(path.join(root, 'notes.txt'), 'untracked note\n');
  await git(root, ['add', '.gitignore', 'src/kept.js', 'src/omitted.js', 'src/skip/hidden.js', 'assets/logo.png']);
  await git(root, ['commit', '-m', 'initial']);
  return root;
}

const delegation = {
  objective: 'Ship the slice',
  deliverables: ['Create docs/planned.md'],
  editable_scope: ['src/**', '!src/skip/**', 'notes.txt', 'assets/**', 'build/**', 'docs/planned.md', 'docs/typo-file.md'],
  files: { editable: ['src/kept.js', 'pkg/other.js'] },
};

test('evaluateContextCoverage reports omissions, ignored and binary exclusions, scope inversion, and literal paths', async () => {
  const root = await makeRepo();
  const coverage = await evaluateContextCoverage(root, delegation, [{ path: 'src/kept.js' }]);
  assert.equal(coverage.hasGaps, true);
  assert.deepEqual(coverage.omittedFiles.map((file) => file.path), ['notes.txt', 'src/omitted.js']);
  assert.equal(coverage.totalOmittedCount, 2);
  assert.ok(coverage.omittedFiles.every((file) => file.reason === 'OMITTED_MATCHING_FILE'));
  assert.equal(coverage.scopeViolations.length, 1);
  assert.equal(coverage.scopeViolations[0].path, 'pkg/other.js');
  assert.equal(coverage.scopeViolations[0].reason, 'EDITABLE_OUTSIDE_SCOPE');
  assert.deepEqual(
    coverage.missingRepoPaths.map((file) => [file.path, file.reason]),
    [['docs/planned.md', 'INTENDED_NEW_FILE'], ['docs/typo-file.md', 'NOT_FOUND_IN_REPO']],
  );
  assert.equal(coverage.candidateScanCapped, false);
});

test('rendered task capsules surface coverage warnings and scope cautions', async () => {
  const root = await makeRepo();
  const coverage = await evaluateContextCoverage(root, delegation, [{ path: 'src/kept.js' }]);
  const markdown = renderTaskCapsule({
    manifest: {
      atb_protocol: '1.0', capsule_type: 'task', schema_version: '1.1', task_id: 'atb_coverage',
      file_boundary: 'ATB_coverage_boundary', host_owned_steps: ['Git commit, branch creation, and repository push'],
    },
    delegation: { ...delegation, host_owned_steps: ['Git commit, branch creation, and repository push'], objective: 'Ship the slice', work_unit: 'Coverage' },
    fingerprint: {},
    repositoryTree: ['src/kept.js'],
    validation: [],
    files: [{ path: 'src/kept.js', role: 'editable', sha256: 'a'.repeat(64), size_bytes: 1, language: 'javascript', content: 'x' }],
    coverage,
  });
  assert.match(markdown, /> \[!WARNING\]/);
  assert.match(markdown, /src\/omitted\.js/);
  assert.match(markdown, /notes\.txt/);
  assert.match(markdown, /> \[!CAUTION\]/);
  assert.match(markdown, /pkg\/other\.js/);
  assert.doesNotMatch(markdown, /build\/cache\.js/);
  assert.doesNotMatch(markdown, /assets\/logo\.png/);
  assert.doesNotMatch(markdown, /src\/skip\/hidden\.js/);
});

test('exportTask returns a non-blocking context coverage warning and checklist note', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-coverage-export-'));
  await git(root, ['init', '-b', 'main']);
  await git(root, ['config', 'user.email', 'test@example.invalid']);
  await git(root, ['config', 'user.name', 'ATB Test']);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'coverage-demo' }));
  await writeFile(path.join(root, 'src', 'index.js'), 'export const value = 1;\n');
  await writeFile(path.join(root, 'src', 'extra.js'), 'export const extra = 1;\n');
  await git(root, ['add', '.']);
  await git(root, ['commit', '-m', 'initial']);
  const delegationPath = path.join(root, 'delegation.json');
  await writeFile(delegationPath, JSON.stringify({
    objective: 'Update the value',
    work_unit: 'Change src/index.js only',
    work_type: 'code',
    deliverables: ['Updated value'],
    editable_scope: ['src/**'],
    acceptance_criteria: ['Keep ESM syntax'],
    files: { editable: ['src/index.js'], reference: [], contract: [], validation: [], configuration: ['package.json'] },
  }));
  const result = await exportTask({ repoRoot: root, delegationPath, sourceAgent: 'claude-code' });
  assert.equal(result.warnings[0].code, 'CONTEXT_COVERAGE_GAP');
  assert.equal(result.coverage.totalOmittedCount, 1);
  assert.equal(result.coverage.omittedFiles[0].path, 'src/extra.js');
  const capsule = await readFile(result.outputPath, 'utf8');
  assert.match(capsule, /> \[!WARNING\]/);
  assert.match(capsule, /src\/extra\.js/);
  const checklist = await readFile(result.handoff.files.uploadChecklist, 'utf8');
  assert.match(checklist, /Context coverage gap detected: 1 matching files omitted; 0 scope violations/);
});
