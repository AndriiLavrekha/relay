import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFollowUpCapsule, createHandoffBundle, formatKickoffPrompt } from '../src/handoff.mjs';
import { renderTaskCapsule, parseTaskCapsule } from '../src/task-capsule.mjs';
import { runProcess } from '../src/process.mjs';
import { storeTask } from '../src/storage.mjs';

async function exists(file) { try { await access(file); return true; } catch { return false; } }

test('createHandoffBundle writes deterministic kickoff artifacts and summary', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-handoff-'));
  const manifest = {
    task_id: 'atb_handoff', schema_version: '1.1', source_agent: 'codex',
    project: { base_commit: 'a'.repeat(40) },
    context: { estimated_tokens: 1200, capsule_bytes: 4800, per_file: [{ path: 'src/a.js', estimated_tokens: 20 }] },
  };
  const delegation = {
    objective: 'Change a bounded module', work_unit: 'Update src/a.js',
    acceptance_criteria: ['Tests pass'], deliverables: ['Complete files'],
  };
  const result = await createHandoffBundle({
    repoRoot: root,
    taskId: 'atb_handoff',
    capsuleText: '# Task Capsule\n',
    manifest,
    delegation,
    contextSummary: manifest.context,
  });

  for (const name of ['task.md', 'kickoff.md', 'upload-checklist.md', 'result-contract.md', 'summary.json']) {
    assert.equal(await exists(path.join(result.directory, name)), true, name);
  }
  const kickoff = await readFile(path.join(result.directory, 'kickoff.md'), 'utf8');
  assert.match(kickoff, /complete resulting files/i);
  assert.match(kickoff, /REPORT\.md/);
  assert.match(kickoff, /Validation claims/);
  assert.match(kickoff, /acceptance evidence/i);
  const summary = JSON.parse(await readFile(path.join(result.directory, 'summary.json'), 'utf8'));
  assert.equal(summary.taskId, 'atb_handoff');
  assert.equal(summary.context.estimated_tokens, 1200);
});

test('formatKickoffPrompt states the untrusted worker contract', () => {
  const prompt = formatKickoffPrompt({
    taskId: 'atb_prompt',
    capsulePath: '.agent-task-bridge/tasks/atb_prompt/task.md',
    manifest: { schema_version: '1.1', project: { base_commit: 'b'.repeat(40) } },
    delegation: { objective: 'Do the work', acceptance_criteria: ['Tests pass'] },
  });
  assert.match(prompt, /untrusted/i);
  assert.match(prompt, /complete resulting files/i);
  assert.match(prompt, /partial|blocked/i);
});

test('createFollowUpCapsule preserves scope and records unresolved review work', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atb-follow-up-'));
  await runProcess('git', ['init', '-b', 'main'], { cwd: root });
  const originalManifest = {
    atb_protocol: '1.0', capsule_type: 'task', schema_version: '1.1', task_id: 'atb_original',
    file_boundary: 'ATB_original_boundary', created_at: new Date().toISOString(),
    source_agent: 'codex', project: { base_commit: 'a'.repeat(40) }, work: { title: 'Original task' },
    context: { file_count: 1 },
  };
  const delegation = {
    objective: 'Do original work', work_unit: 'Update source', title: 'Original task', work_type: 'code',
    editable_scope: ['src/**'], acceptance_criteria: ['Resolve the failing behavior'], non_goals: [],
    deliverables: ['Complete file'], current_work_state: '', architecture_context: '',
    files: { editable: ['src/a.js'], reference: [], contract: [], validation: [], configuration: [] },
  };
  const capsule = renderTaskCapsule({
    manifest: originalManifest, delegation, fingerprint: {}, repositoryTree: ['src/a.js'], validation: [],
    files: [{ path: 'src/a.js', role: 'editable', sha256: '1'.repeat(64), size_bytes: 20, language: 'javascript', content: 'export const a = 1;\n' }],
  });
  await storeTask(root, 'atb_original', capsule);
  const result = await createFollowUpCapsule({
    repoRoot: root,
    importId: 'import_original',
    review: {
      task: { taskId: 'atb_original' },
      withheldFiles: ['src/b.js'],
      acceptance: { criteria: [{ text: 'Resolve the failing behavior', status: 'unverified' }] },
    },
  });
  const parsed = parseTaskCapsule(await readFile(result.capsulePath, 'utf8'));
  assert.equal(parsed.manifest.continuation_of, 'import_original');
  assert.deepEqual(parsed.delegation.editable_scope, ['src/**']);
  assert.match(parsed.delegation.objective, /unresolved/i);
  assert.ok(parsed.delegation.files.reference.includes('src/b.js'));
});
