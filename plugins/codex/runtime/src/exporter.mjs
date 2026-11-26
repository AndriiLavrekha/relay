import crypto from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateDelegationRequest } from './delegation.mjs';
import { applyExtraHostOwnedSteps, loadProjectConfig, resolveMaxTokens } from './config.mjs';
import { collectContext, evaluateContextCoverage } from './context.mjs';
import { fingerprintProject } from './fingerprint.mjs';
import { findGitRoot, getGitState } from './repository.mjs';
import { renderTaskCapsule } from './task-capsule.mjs';
import { storeTask } from './storage.mjs';
import { AtbError } from './errors.mjs';
import { resolveValidationCommands } from './validation.mjs';
import { scanText } from './privacy.mjs';
import { writeLifecycle } from './lifecycle.mjs';
import { createHandoffBundle } from './handoff.mjs';

const PACKAGE_VERSION = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')).version;

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
  delegationRequest,
  continuationOf,
}) {
  const root = repoRoot ? await findGitRoot(repoRoot) : await findGitRoot(process.cwd());
  let raw = delegationRequest;
  if (raw === undefined) {
    try { raw = JSON.parse(await readFile(path.resolve(delegationPath), 'utf8')); }
    catch (error) { throw new AtbError('INVALID_DELEGATION_FILE', `Cannot read delegation JSON: ${error.message}`); }
  }
  const projectConfig = await loadProjectConfig(root);
  const delegation = applyExtraHostOwnedSteps(raw, validateDelegationRequest(raw), projectConfig);
  const tokenBudget = resolveMaxTokens(maxTokens, projectConfig);
  const [git, fingerprint, context, discoveredValidation] = await Promise.all([
    getGitState(root),
    fingerprintProject(root),
    collectContext(root, delegation),
    resolveValidationCommands(root, projectConfig),
  ]);
  const coverage = await evaluateContextCoverage(root, delegation, context.files);
  const warnings = [];
  if (coverage.hasGaps) {
    warnings.push({
      code: 'CONTEXT_COVERAGE_GAP',
      message: `Detected ${coverage.totalOmittedCount} omitted scope file(s) and ${coverage.scopeViolations.length} scope violation(s)`,
      details: coverage,
    });
  }
  const taskId = makeTaskId();
  const validation = discoveredValidation.map(({ name, display }) => ({ name, command: displayValidationCommand(display), authoritative: 'local' }));
  const manifest = {
    atb_protocol: '1.0',
    capsule_type: 'task',
    schema_version: '1.1',
    bridge_version: PACKAGE_VERSION,
    hash_algorithm: 'sha256',
    task_id: taskId,
    created_at: new Date().toISOString(),
    exporter_version: PACKAGE_VERSION,
    host_owned_steps: delegation.host_owned_steps,
    source_agent: sourceAgent,
    ...(continuationOf ? { continuation_of: continuationOf } : {}),
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
  const capsuleModel = { manifest, delegation, fingerprint, repositoryTree: context.repositoryTree, validation, files: context.files, coverage };
  let capsuleText = renderTaskCapsule(capsuleModel);
  let estimate = estimateTaskCapsule(capsuleText, context.file_breakdown);
  manifest.context = {
    ...manifest.context,
    capsule_bytes: estimate.byteLength,
    estimated_tokens: estimate.estimatedTokens,
    safety_margin_tokens: estimate.safetyMarginTokens,
    per_file: estimate.perFile,
  };
  capsuleText = renderTaskCapsule({ ...capsuleModel, manifest });
  estimate = estimateTaskCapsule(capsuleText, context.file_breakdown);
  if (Number.isFinite(tokenBudget) && estimate.estimatedTokens > tokenBudget) {
    throw new AtbError('CONTEXT_TOKEN_BUDGET_EXCEEDED', `Rendered Task Capsule exceeds the ${tokenBudget} token budget`, {
      maxTokens: tokenBudget,
      estimatedTokens: estimate.estimatedTokens,
      byteLength: estimate.byteLength,
    });
  }
  const privacy = scanRenderedTaskCapsule(capsuleText, { policy: privacyPolicy, confirmed: privacyConfirmed });
  if (privacy.blocked || (privacy.requiresConfirmation && !privacyConfirmed)) throw privacyError(privacy);
  const stored = await storeTask(root, taskId, capsuleText);
  const lifecycle = {
    taskId,
    state: 'exported',
    events: [{ state: 'exported', at: new Date().toISOString(), source: continuationOf ? 'follow-up' : 'export', ...(continuationOf ? { continuationOf } : {}) }],
  };
  const lifecyclePath = await writeLifecycle(root, lifecycle);
  const handoff = await createHandoffBundle({
    repoRoot: root,
    taskId,
    capsuleText,
    manifest,
    delegation,
    contextSummary: manifest.context,
    coverage,
  });
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
    lifecyclePath,
    handoff,
    manifest,
    contextSummary: {
      ...manifest.context,
      capsule_bytes: estimate.byteLength,
      estimated_tokens: estimate.estimatedTokens,
      safety_margin_tokens: estimate.safetyMarginTokens,
      per_file: estimate.perFile,
    },
    warnings,
    coverage,
    projectConfig: {
      present: projectConfig.present,
      maxTokens: Number.isFinite(tokenBudget) ? tokenBudget : null,
      extraHostOwnedStepsApplied: raw.host_owned_steps === undefined ? projectConfig.extraHostOwnedSteps : [],
    },
  };
}
