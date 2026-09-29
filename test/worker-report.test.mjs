import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { exportTask } from '../src/exporter.mjs';
import { importResult } from '../src/importer.mjs';
import { createZip } from '../src/zip.mjs';
import { inspectResultCapsule, MAX_REPORT_UNCOMPRESSED_BYTES } from '../src/result-capsule.mjs';
import { parseWorkerReport, formatImportReport, formatReviewReport, MAX_REVIEW_REPORT_BYTES } from '../src/reporting.mjs';
import { scanSecretText } from '../src/secrets.mjs';
import { AtbError } from '../src/errors.mjs';

async function makeRepo() {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-report-'));
  await runProcess('git', ['init', '-b', 'main'], { cwd: root });
  await runProcess('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await runProcess('git', ['config', 'user.name', 'ATB Test'], { cwd: root });
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'report-fixture' }));
  await writeFile(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
  await runProcess('git', ['add', '.'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: root });
  const delegationPath = path.join(root, 'delegation.json');
  await writeFile(delegationPath, JSON.stringify({
    objective: 'Change module a',
    work_unit: 'Modify a',
    work_type: 'code',
    editable_scope: ['src/**'],
    acceptance_criteria: ['src/a.js is staged'],
    files: { editable: ['src/a.js'], configuration: ['package.json'] },
  }));
  const task = await exportTask({ repoRoot: root, delegationPath, sourceAgent: 'codex' });
  return { root, task };
}

function resultZip(root, task, report) {
  const entries = [
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({
      atb_protocol: '1.0',
      capsule_type: 'result',
      task_id: task.taskId,
      source_base_commit: task.manifest.project.base_commit,
      result_type: 'code',
      summary: 'candidate',
      files: [{ path: 'src/a.js', operation: 'modify' }],
      validation: { executed: [], not_executed: [] },
      assumptions: [],
      unresolved: [],
    })) },
    { name: 'files/src/a.js', data: Buffer.from('export const a = 2;\n') },
  ];
  if (report !== undefined) entries.push({ name: 'REPORT.md', data: Buffer.from(report) });
  const zipPath = path.join(root, `result-${Math.random().toString(16).slice(2)}.zip`);
  return writeFile(zipPath, createZip(entries)).then(() => zipPath);
}

const structuredReport = `# Summary
Updated the exported value.

## Assumptions
- The sandbox has no database.

**Validation claims**
- node --check src/a.js

### Unresolved work
1. Host runs the authoritative workspace test.

## Findings
- The value change is local to src/a.js.

## Next steps
- Review the staged diff.
`;

test('parseWorkerReport extracts sections across heading styles and redacts secrets', () => {
  const secret = 'AKIAIOSFODNN7EXAMPLE';
  const raw = `${structuredReport}\nToken ${secret}\n`;
  const findings = scanSecretText(raw);
  const parsed = parseWorkerReport(raw, { findings });
  assert.equal(parsed.present, true);
  assert.match(parsed.summary, /Updated the exported value/);
  assert.deepEqual(parsed.assumptions, ['The sandbox has no database.']);
  assert.deepEqual(parsed.validationClaims, ['node --check src/a.js']);
  assert.deepEqual(parsed.unresolved, ['Host runs the authoritative workspace test.']);
  assert.deepEqual(parsed.findings, ['The value change is local to src/a.js.']);
  assert.deepEqual(parsed.recommendations, ['Review the staged diff.']);
  assert.equal(parsed.privacyFindings[0].category, 'aws-access-key');
  assert.match(parsed.rawText, /\[REDACTED_SECRET:aws-access-key\]/);
  assert.doesNotMatch(parsed.rawText, /AKIAIOSFODNN7EXAMPLE/);
  assert.equal(parsed.truncated, false);
});

test('parseWorkerReport uses the first paragraph when headings are absent and caps review text', () => {
  const plain = parseWorkerReport('First paragraph stays.\n\nSecond paragraph stays out of the summary.');
  assert.equal(plain.summary, 'First paragraph stays.');
  assert.deepEqual(plain.assumptions, []);
  const huge = parseWorkerReport(`## Summary\n${'x'.repeat(MAX_REVIEW_REPORT_BYTES + 4096)}`);
  assert.equal(huge.truncated, true);
  assert.ok(Buffer.byteLength(huge.rawText, 'utf8') <= MAX_REVIEW_REPORT_BYTES);
});

test('inspectResultCapsule rejects REPORT.md above 512 KB', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'atb-report-limit-'));
  const file = path.join(dir, 'result.zip');
  await writeFile(file, createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({
      atb_protocol: '1.0', capsule_type: 'result', task_id: 'atb_test_123',
      source_base_commit: 'a'.repeat(40), files: [],
    })) },
    { name: 'REPORT.md', data: Buffer.alloc(MAX_REPORT_UNCOMPRESSED_BYTES + 1, 65) },
  ]));
  await assert.rejects(() => inspectResultCapsule(file), (error) => error.code === 'REPORT_TOO_LARGE');
});

test('import persists REPORT.md and redacts it in review without failing the import', async () => {
  const { root, task } = await makeRepo();
  const secret = 'AKIAIOSFODNN7EXAMPLE';
  const zip = await resultZip(root, task, `${structuredReport}\nLeaked ${secret}\n`);
  const report = await importResult({ repoRoot: root, resultPath: zip });
  const saved = await readFile(report.workerReportPath, 'utf8');
  assert.match(saved, /AKIAIOSFODNN7EXAMPLE/);
  const review = JSON.parse(await readFile(report.reviewPath, 'utf8'));
  assert.equal(review.workerReport.present, true);
  assert.match(review.workerReport.summary, /Updated the exported value/);
  assert.match(review.workerReport.rawText, /\[REDACTED_SECRET:aws-access-key\]/);
  assert.doesNotMatch(JSON.stringify(review.workerReport), /AKIAIOSFODNN7EXAMPLE/);
  const rendered = formatReviewReport(review);
  assert.match(rendered, /# Worker Report \(REPORT\.md\)/);
  assert.match(rendered, /Assumptions:/);
  assert.doesNotMatch(rendered, /AKIAIOSFODNN7EXAMPLE/);
  assert.match(formatImportReport(report), /Worker Report: present/);
  assert.match(formatImportReport(report), /high-confidence secret/);
});

test('REPORT.md survives failed, rejected, and interrupted imports', async () => {
  const failed = await makeRepo();
  const failedZip = await resultZip(failed.root, failed.task, structuredReport);
  await assert.rejects(
    () => importResult({ repoRoot: failed.root, resultPath: failedZip, stagingDir: path.join(failed.root, 'unsafe-staging') }),
    (error) => error.code === 'UNSAFE_STAGING_LOCATION',
  );
  await assertReportPersisted(failed.root, failed.task.taskId, 'failed');

  const rejected = await makeRepo();
  const rejectedZip = await resultZip(rejected.root, {
    ...rejected.task,
    manifest: { project: { base_commit: 'b'.repeat(40) } },
    taskId: rejected.task.taskId,
  }, structuredReport);
  await assert.rejects(() => importResult({ repoRoot: rejected.root, resultPath: rejectedZip }), /base|baseline|commit/i);
  await assertReportPersisted(rejected.root, rejected.task.taskId, 'rejected');

  const interrupted = await makeRepo();
  const interruptedZip = await resultZip(interrupted.root, interrupted.task, structuredReport);
  let reads = 0;
  const signal = {
    get aborted() {
      reads += 1;
      return reads >= 4;
    },
    reason: new AtbError('ABORT_ERR', 'Import interrupted after the task was loaded'),
  };
  await assert.rejects(
    () => importResult({ repoRoot: interrupted.root, resultPath: interruptedZip, signal }),
    (error) => error.code === 'ABORT_ERR',
  );
  await assertReportPersisted(interrupted.root, interrupted.task.taskId, 'interrupted');
});

async function assertReportPersisted(root, taskId, lifecycle) {
  const importsRoot = path.join(root, '.agent-task-bridge', 'tasks', taskId, 'imports');
  const [importId] = await readdir(importsRoot);
  const report = JSON.parse(await readFile(path.join(importsRoot, importId, 'report.json'), 'utf8'));
  assert.equal(report.lifecycle, lifecycle);
  assert.match(await readFile(path.join(importsRoot, importId, 'REPORT.md'), 'utf8'), /Updated the exported value/);
}
