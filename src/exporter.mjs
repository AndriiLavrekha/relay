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
import { scanText } from './privacy.mjs';

function makeTaskId() {
  return `atb_${Date.now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function displayValidationCommand(display) {
  if (process.platform !== 'win32') return display;
  return display.replace(/^[A-Za-z]:\\[^ ]*\\cmd\.exe/i, 'cmd.exe');
}

export function scanRenderedTaskCapsule(capsuleText, options = {}) {
  return scanText(capsuleText, {
    source: 'task-capsule',
    path: 'serialized-capsule',
    ...options,
  });
}

export function estimateTaskCapsule(capsuleText, fileBreakdown = []) {
  const byteLength = Buffer.byteLength(capsuleText, 'utf8');
  const rawEstimatedTokens = Math.ceil(byteLength / 4);
  const safetyMarginTokens = Math.max(1, Math.ceil(rawEstimatedTokens * 0.1));
  const perFile = fileBreakdown.map((file) => ({
    path: file.path,
    role: file.role,
    size_bytes: file.size_bytes,
    estimated_tokens: file.estimated_tokens ?? Math.ceil(file.size_bytes / 4),
  }));
  return {
    byteLength,
    rawEstimatedTokens,
    safetyMarginTokens,
    estimatedTokens: rawEstimatedTokens + safetyMarginTokens,
    perFile,
  };
}

function privacyError(scan) {
  const code = scan.blocked ? 'PRIVACY_SCAN_BLOCKED' : 'PRIVACY_CONFIRMATION_REQUIRED';
  const categories = [...new Set(scan.findings.map((finding) => finding.category))].join(', ');
  const message = scan.blocked
    ? `Task Capsule contains high-confidence sensitive data and was blocked (${categories})`
    : `Task Capsule contains privacy warnings that require explicit confirmation (${categories})`;
  return new AtbError(code, message, {
    findings: scan.findings.map(({ category, confidence, severity, source, path: findingPath, detail }) => ({
      category, confidence, severity, source, path: findingPath, detail,
    })),
  });
}

export async function exportTask({
  repoRoot,
  delegationPath,
  outPath,
  sourceAgent = 'unknown',
  maxTokens,
  privacyPolicy = 'default',
  privacyConfirmed = false,
}) {
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
  const validation = discoveredValidation.map(({ name, display }) => ({ name, command: displayValidationCommand(display), authoritative: 'local' }));
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
      safety_margin_tokens: 0,
      per_file: context.file_breakdown,
      accounting: 'estimate-not-billing',
    },
    validation,
  };
  let capsuleText = renderTaskCapsule({ manifest, delegation, fingerprint, repositoryTree: context.repositoryTree, validation, files: context.files });
  let estimate = estimateTaskCapsule(capsuleText, context.file_breakdown);
  manifest.context = {
    ...manifest.context,
    capsule_bytes: estimate.byteLength,
    estimated_tokens: estimate.estimatedTokens,
    safety_margin_tokens: estimate.safetyMarginTokens,
    per_file: estimate.perFile,
  };
  capsuleText = renderTaskCapsule({ manifest, delegation, fingerprint, repositoryTree: context.repositoryTree, validation, files: context.files });
  estimate = estimateTaskCapsule(capsuleText, context.file_breakdown);
  if (Number.isFinite(Number(maxTokens)) && estimate.estimatedTokens > Number(maxTokens)) {
    throw new AtbError('CONTEXT_TOKEN_BUDGET_EXCEEDED', `Rendered Task Capsule exceeds the ${Number(maxTokens)} token budget`, {
      maxTokens: Number(maxTokens),
      estimatedTokens: estimate.estimatedTokens,
      byteLength: estimate.byteLength,
    });
  }
  const privacy = scanRenderedTaskCapsule(capsuleText, { policy: privacyPolicy, confirmed: privacyConfirmed });
  if (privacy.blocked || (privacy.requiresConfirmation && !privacyConfirmed)) throw privacyError(privacy);
  const stored = await storeTask(root, taskId, capsuleText);
  let outputPath = stored.outputPath;
  if (outPath) {
    outputPath = path.isAbsolute(outPath) ? outPath : path.resolve(root, outPath);
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, capsuleText, 'utf8');
  }
  return {
    taskId,
    outputPath,
    storedTaskPath: stored.taskPath,
    manifest,
    contextSummary: {
      ...manifest.context,
      capsule_bytes: estimate.byteLength,
      estimated_tokens: estimate.estimatedTokens,
      safety_margin_tokens: estimate.safetyMarginTokens,
      per_file: estimate.perFile,
    },
  };
}
