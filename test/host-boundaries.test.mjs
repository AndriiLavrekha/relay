import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDelegationRequest, DEFAULT_HOST_OWNED_STEPS } from '../src/delegation.mjs';
import { buildAcceptanceEvidence, isHostOwnedCriterion } from '../src/evidence.mjs';
import { buildReviewData } from '../src/review.mjs';
import { renderTaskCapsule, parseTaskCapsule } from '../src/task-capsule.mjs';
import { formatReviewReport } from '../src/reporting.mjs';

const delegation = {
  objective: 'Add retry behavior',
  work_unit: 'Implement RetryPolicy',
  work_type: 'code',
  deliverables: ['RetryPolicy'],
  editable_scope: ['src/retry/**'],
  acceptance_criteria: ['Retries are bounded'],
  files: { editable: ['src/retry/RetryPolicy.ts'] },
};

test('omitted host_owned_steps receive the default execution boundary', () => {
  const validated = validateDelegationRequest(delegation);
  assert.deepEqual(validated.host_owned_steps, [...DEFAULT_HOST_OWNED_STEPS]);
  assert.deepEqual(validateDelegationRequest({ ...delegation, host_owned_steps: [] }).host_owned_steps, []);
  assert.throws(() => validateDelegationRequest({ ...delegation, host_owned_steps: [''] }), /host_owned_steps/i);
});

test('task capsules publish the responsibility matrix and host-owned steps', () => {
  const validated = validateDelegationRequest(delegation);
  const markdown = renderTaskCapsule({
    manifest: {
      atb_protocol: '1.0', capsule_type: 'task', schema_version: '1.1', task_id: 'atb_host',
      file_boundary: 'ATB_host_boundary', host_owned_steps: validated.host_owned_steps,
      context: { file_count: 1 },
    },
    delegation: validated,
    fingerprint: {},
    repositoryTree: [],
    validation: [],
    files: [{ path: 'src/retry/RetryPolicy.ts', role: 'editable', sha256: 'a'.repeat(64), size_bytes: 1, language: 'typescript', content: 'x' }],
  });
  assert.match(markdown, /## Execution Boundaries & Responsibility Matrix/);
  assert.match(markdown, /External Worker \(ChatGPT\)/);
  assert.match(markdown, /Authoritative monorepo\/workspace test & build gates/);
  assert.match(markdown, /Do not mark a task failed/);
  assert.match(markdown, /\*\*Review statically before returning\.\*\*.*noUncheckedIndexedAccess/);
  const parsed = parseTaskCapsule(markdown);
  assert.deepEqual(parsed.manifest.host_owned_steps, [...DEFAULT_HOST_OWNED_STEPS]);
  assert.deepEqual(parsed.delegation.host_owned_steps, [...DEFAULT_HOST_OWNED_STEPS]);
});

test('host-owned criteria match explicit tags, dictionaries, and worker claims', () => {
  assert.equal(isHostOwnedCriterion('[host] refresh demo data', []), true);
  assert.equal(isHostOwnedCriterion('(host) refresh demo data', []), true);
  assert.equal(isHostOwnedCriterion('host-owned: refresh demo data', []), true);
  assert.equal(isHostOwnedCriterion(DEFAULT_HOST_OWNED_STEPS[2], DEFAULT_HOST_OWNED_STEPS), true);
  assert.equal(isHostOwnedCriterion('pnpm test the monorepo', []), false);
  assert.equal(isHostOwnedCriterion('pnpm test the monorepo', DEFAULT_HOST_OWNED_STEPS), true);
  assert.equal(isHostOwnedCriterion('Apply the postgres migration', DEFAULT_HOST_OWNED_STEPS), true);
  assert.equal(isHostOwnedCriterion('git commit the branch', DEFAULT_HOST_OWNED_STEPS), true);
  assert.equal(isHostOwnedCriterion('pnpm test the workspace', ['Release checklist sign-off'], 'deferred_to_host'), true);
  assert.equal(isHostOwnedCriterion('pnpm test the workspace', ['Release checklist sign-off'], 'worker finished the code'), false);
  assert.equal(isHostOwnedCriterion('Keep the public API stable', DEFAULT_HOST_OWNED_STEPS), false);
});

test('acceptance evidence defers host gates and preserves legacy capsules', () => {
  const legacy = buildAcceptanceEvidence(
    { delegation: { acceptance_criteria: ['pnpm test the monorepo', 'src/a.js is staged'] }, manifest: {} },
    { manifest: { status: 'complete', acceptance_criteria: ['worker ran pnpm', 'worker edited src/a.js'] } },
    { files: [{ path: 'src/a.js', status: 'CLEAN_UNCHANGED', appliedToStaging: true }], validation: { blocked: false, results: [] } },
  );
  assert.equal(legacy.criteria[0].status, 'unverified');
  assert.equal(legacy.criteria[1].status, 'verified');
  assert.equal(legacy.overallStatus, 'unverified');

  const current = buildAcceptanceEvidence(
    {
      delegation: { acceptance_criteria: ['src/a.js is staged', 'pnpm test the monorepo', 'git commit the branch'] },
      manifest: { host_owned_steps: [...DEFAULT_HOST_OWNED_STEPS] },
    },
    { manifest: { status: 'complete', acceptance_criteria: ['staged', 'deferred_to_host', 'deferred_to_host'] } },
    { files: [{ path: 'src/a.js', status: 'CLEAN_UNCHANGED', appliedToStaging: true }], validation: { blocked: false, results: [{ name: 'test', status: 'PASS' }] } },
  );
  assert.equal(current.criteria[0].status, 'verified');
  assert.equal(current.criteria[1].status, 'deferred_to_host');
  assert.equal(current.criteria[2].status, 'deferred_to_host');
  assert.match(current.criteria[1].localEvidence.join(' '), /host-owned/i);
  assert.equal(current.overallStatus, 'verified_with_deferred');

  const onlyDeferred = buildAcceptanceEvidence(
    { delegation: { acceptance_criteria: ['Apply the postgres migration'] }, manifest: { host_owned_steps: [...DEFAULT_HOST_OWNED_STEPS] } },
    { manifest: { status: 'complete', acceptance_criteria: ['deferred_to_host'] } },
    { files: [], validation: { blocked: true, reason: 'VALIDATION_CONFIG_CHANGED', results: [] } },
  );
  assert.equal(onlyDeferred.overallStatus, 'deferred_to_host');
});

test('deferred host criteria do not mark an otherwise complete review partial', async () => {
  const review = await buildReviewData({
    repoRoot: process.cwd(),
    importReport: {
      resultStatus: 'complete',
      conflicts: [],
      validation: { blocked: false, skipped: false, results: [{ name: 'test', status: 'PASS' }] },
      acceptance: {
        overallStatus: 'verified_with_deferred',
        criteria: [
          { text: 'src/a.js is staged', status: 'verified' },
          { text: 'pnpm test the monorepo', status: 'deferred_to_host' },
        ],
      },
    },
    lifecycle: { state: 'reviewed' },
    receipt: { taskId: 'atb_host' },
    workerReport: { present: false },
  });
  assert.equal(review.partial, false);
  assert.equal(review.deferredToHost, true);
  assert.equal(review.hasDeferredSteps, true);
  assert.deepEqual(review.deferredHostSteps, ['pnpm test the monorepo']);
  assert.match(formatReviewReport(review), /# Deferred Host Steps/);

  const blocked = await buildReviewData({
    repoRoot: process.cwd(),
    importReport: {
      resultStatus: 'blocked',
      conflicts: [],
      validation: null,
      acceptance: { criteria: [{ text: 'pnpm test the monorepo', status: 'deferred_to_host' }] },
    },
    lifecycle: { state: 'reviewed' },
    receipt: {},
  });
  assert.equal(blocked.partial, true);
});
