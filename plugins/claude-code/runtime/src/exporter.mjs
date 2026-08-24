import crypto from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateDelegationRequest } from './delegation.mjs';
import { collectContext } from './context.mjs';
import { fingerprintProject } from './fingerprint.mjs';
import { findGitRoot, getGitState } from './repository.mjs';
import { renderTaskCapsule } from './task-capsule.mjs';
import { storeTask } from './storage.mjs';
import { AtbError } from './errors.mjs';
import { discoverValidationCommands } from './validation.mjs';

function makeTaskId() {
  return `atb_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}


export async function exportTask({ repoRoot, delegationPath, outPath, sourceAgent = 'unknown' }) {
  const root = repoRoot ? await findGitRoot(repoRoot) : await findGitRoot(process.cwd());
  let raw;
  try { raw = JSON.parse(await readFile(path.resolve(delegationPath), 'utf8')); }
  catch (error) { throw new AtbError('INVALID_DELEGATION_FILE', `Cannot read delegation JSON: ${error.message}`); }
  const delegation = validateDelegationRequest(raw);
  const [git, fingerprint, context, discoveredValidation] = await Promise.all([
    getGitState(root),
    fingerprintProject(root),
    collectContext(root, delegation),
    discoverValidationCommands(root),
  ]);
  const taskId = makeTaskId();
  const validation = discoveredValidation.map(({ name, display }) => ({ name, command: display, authoritative: 'local' }));
  const manifest = {
    atb_protocol: '1.0',
    capsule_type: 'task',
    task_id: taskId,
    created_at: new Date().toISOString(),
    exporter_version: '0.1.0',
    source_agent: sourceAgent,
    project: {
      name: fingerprint.project_name,
      vcs: 'git',
      branch: git.branch,
      base_commit: git.head,
      dirty: git.dirty,
    },
    work: { type: delegation.work_type, title: delegation.title },
    context: {
      encoding: 'utf-8',
      file_count: context.files.length,
      embedded_bytes: context.embedded_bytes,
      estimated_tokens: context.estimated_tokens,
    },
    validation,
  };
  const capsuleText = renderTaskCapsule({ manifest, delegation, fingerprint, repositoryTree: context.repositoryTree, validation, files: context.files });
  const stored = await storeTask(root, taskId, capsuleText);
  let outputPath = stored.outputPath;
  if (outPath) {
    outputPath = path.isAbsolute(outPath) ? outPath : path.resolve(root, outPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, capsuleText, 'utf8');
  }
  return { taskId, outputPath, storedTaskPath: stored.taskPath, manifest, contextSummary: manifest.context };
}
