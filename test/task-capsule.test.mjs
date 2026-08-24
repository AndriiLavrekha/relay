import test from 'node:test';
import assert from 'node:assert/strict';
import { validateDelegationRequest } from '../src/delegation.mjs';
import { stringifyYaml, parseYaml } from '../src/yaml.mjs';
import { normalizeRepoPath } from '../src/path-safety.mjs';
import { renderTaskCapsule, parseTaskCapsule } from '../src/task-capsule.mjs';

const delegation = {
  objective: 'Add retry behavior',
  work_unit: 'Implement RetryPolicy and focused tests',
  work_type: 'code',
  current_work_state: 'HTTP client exists; retry policy is not implemented.',
  deliverables: ['RetryPolicy implementation', 'Unit tests'],
  editable_scope: ['src/retry/**', 'test/retry/**'],
  acceptance_criteria: ['Retries are bounded', 'Existing behavior remains unchanged'],
  non_goals: ['Wire policy into HTTP client'],
  architecture_context: 'Policies are dependency-free modules.',
  files: {
    editable: ['src/retry/RetryPolicy.ts'],
    reference: ['src/http/Client.ts'],
    contract: [],
    validation: ['test/http/Client.test.ts'],
    configuration: ['package.json']
  }
};

test('delegation validation normalizes a valid request and rejects missing requirements', () => {
  const valid = validateDelegationRequest(delegation);
  assert.equal(valid.work_type, 'code');
  assert.deepEqual(valid.editable_scope, ['src/retry/**', 'test/retry/**']);
  assert.throws(() => validateDelegationRequest({ ...delegation, objective: '' }), /objective/i);
  assert.throws(() => validateDelegationRequest({ ...delegation, work_unit: undefined }), /work_unit/i);
  assert.throws(() => validateDelegationRequest({ ...delegation, files: { editable: ['../secret'] } }), /unsafe|path/i);
});

test('JSON-compatible YAML subset round trips protocol metadata exactly', () => {
  const value = {
    atb_protocol: '1.0',
    capsule_type: 'task',
    project: { dirty: true, branch: 'feature/x' },
    context: { file_count: 2, roles: ['editable', 'reference'] }
  };
  const encoded = stringifyYaml(value);
  assert.match(encoded, /^\{/);
  assert.deepEqual(parseYaml(encoded), value);
});

test('normalizeRepoPath produces POSIX relative paths and rejects traversal/absolute paths', () => {
  assert.equal(normalizeRepoPath('src\\auth\\service.ts'), 'src/auth/service.ts');
  assert.equal(normalizeRepoPath('./src/a.ts'), 'src/a.ts');
  for (const candidate of ['../secret', 'src/../../secret', '/etc/passwd', 'C:\\Windows\\x', '\\\\server\\share\\x', '.GIT/config', 'src/.Agent-Task-Bridge/state', '']) {
    assert.throws(() => normalizeRepoPath(candidate), /path/i);
  }
});

test('Task Capsule render/parse preserves exact embedded content and metadata', () => {
  const model = {
    manifest: {
      atb_protocol: '1.0',
      capsule_type: 'task',
      task_id: 'atb_test_123',
      created_at: '2026-08-23T00:00:00.000Z',
      exporter_version: '0.1.0',
      source_agent: 'claude-code',
      project: { name: 'fixture', vcs: 'git', branch: 'main', base_commit: 'a'.repeat(40), dirty: true },
      work: { type: 'code', title: 'Implement RetryPolicy' },
      context: { encoding: 'utf-8', file_count: 2, estimated_tokens: 123 }
    },
    delegation,
    fingerprint: { runtime: { node: '22.16.0' }, package_manager: 'npm', scripts: { test: 'node --test' } },
    repositoryTree: ['package.json', 'src/retry/RetryPolicy.ts'],
    validation: [{ name: 'test', command: 'npm test' }],
    files: [
      {
        path: 'src/retry/RetryPolicy.ts', role: 'editable', sha256: '1'.repeat(64), size_bytes: 52, language: 'typescript',
        content: 'export function retry() {\n  return "``` not a delimiter";\n}\n'
      },
      {
        path: 'package.json', role: 'configuration', sha256: '2'.repeat(64), size_bytes: 18, language: 'json',
        content: '{"type":"module"}\n'
      }
    ]
  };
  const markdown = renderTaskCapsule(model);
  assert.match(markdown, /^---\n\{/);
  assert.match(markdown, /External Worker Instructions/);
  assert.match(markdown, /Expected Result Capsule Contract/);
  const parsed = parseTaskCapsule(markdown);
  assert.equal(parsed.manifest.task_id, 'atb_test_123');
  assert.equal(parsed.files.length, 2);
  assert.equal(parsed.files[0].content, model.files[0].content);
  assert.equal(parsed.files[0].role, 'editable');
  assert.equal(parsed.delegation.work_unit, delegation.work_unit);
});
