import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runProcess } from '../src/process.mjs';
import { buildReviewData } from '../src/review.mjs';

test('buildReviewData combines diff, drift, validation, privacy, and acceptance evidence', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-review-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'a.js'), 'export const a = 1;\n');
  await runProcess('git', ['init', '-b', 'main'], { cwd: root });
  await runProcess('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root });
  await runProcess('git', ['config', 'user.name', 'ATB Test'], { cwd: root });
  await runProcess('git', ['add', '.'], { cwd: root });
  await runProcess('git', ['commit', '-m', 'initial'], { cwd: root });
  const head = (await runProcess('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
  await writeFile(path.join(root, 'src', 'a.js'), 'export const a = 2;\n');
  const review = await buildReviewData({
    repoRoot: root,
    importReport: {
      taskId: 'atb_review', importId: 'import_review', currentHead: head, sourceBaseCommit: head,
      stagingRoot: root, resultStatus: 'partial', repositoryBaseChanged: false,
      files: [{ path: 'src/a.js', status: 'CLEAN_UNCHANGED', appliedToStaging: true }],
      conflicts: [{ path: 'src/b.js', status: 'LOCAL_CHANGED' }],
      validation: { passed: true, blocked: false, partial: true, results: [{ name: 'test', status: 'PASS' }] },
      acceptance: { criteria: [{ id: 'criterion-1', status: 'unverified' }] },
      activeWorktreeModifiedByImport: false,
    },
    lifecycle: { state: 'reviewed' },
    receipt: { taskId: 'atb_review', importId: 'import_review' },
  });
  assert.match(review.diffStat, /1 file changed|1 insertion|changed/i);
  assert.equal(review.changedFiles[0].path, 'src/a.js');
  assert.deepEqual(review.withheldFiles, ['src/b.js']);
  assert.equal(review.partial, true);
  assert.equal(review.acceptance.criteria[0].status, 'unverified');
});
