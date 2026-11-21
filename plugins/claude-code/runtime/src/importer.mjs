import crypto from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { findGitRoot, getGitState } from './repository.mjs';
import { loadStoredTask, atbRoot, persistImportReport } from './storage.mjs';
import { inspectResultCapsule } from './result-capsule.mjs';
import { sha256Buffer } from './hash.mjs';
import { classifyDrift } from './drift.mjs';
import { createIsolatedStaging, cleanupIsolatedStaging, applyStagedFile, fingerprintActiveTree, isSafeStagingPath } from './staging.mjs';
import { AtbError } from './errors.mjs';
import { captureValidationSnapshot, linkDependencyDirectories, runValidation, unlinkDependencyDirectories, validationConfigChanged } from './validation.mjs';
import { detectElision, eolStyle, normalizeEol } from './elision.mjs';
import { mergeThreeWay } from './merge.mjs';
import { materializeResult } from './reply.mjs';

// MERGED_CLEAN files are staged with the three-way merge result; everything else is withheld as a candidate.
const STAGEABLE_STATUSES = new Set(['CLEAN_UNCHANGED', 'NEW_EXPECTED', 'MERGED_CLEAN']);
import { abortReason } from './process.mjs';
import { buildAcceptanceEvidence } from './evidence.mjs';
import { loadLifecycle, transitionLifecycle, writeLifecycle } from './lifecycle.mjs';
import { createReceipt, writeImmutableReceipt } from './receipts.mjs';
import { buildReviewData } from './review.mjs';
import { parseWorkerReport } from './reporting.mjs';
import { loadProjectConfig, resolveValidationPolicy } from './config.mjs';

async function currentState(repoRoot, repoPath) {
  const full = path.join(repoRoot, ...repoPath.split('/'));
  try {
    const info = await stat(full);
    if (!info.isFile()) return { exists: true, sha256: null };
    const buffer = await readFile(full);
    return { exists: true, sha256: sha256Buffer(buffer) };
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false, sha256: null };
    throw error;
  }
}

async function saveCandidate(candidateRoot, file) {
  if (file.operation === 'delete' || file.content === null) return null;
  const target = path.join(candidateRoot, ...file.path.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, file.content, 'utf8');
  return target;
}

function activeTreeIdentity({ pathSetHash, files }) {
  return { pathSetHash, files };
}

function activeTreeChanged(before, after) {
  return !isDeepStrictEqual(activeTreeIdentity(before), activeTreeIdentity(after));
}

function failureMetadata(error, signal) {
  return { code: interrupted(error, signal) ? 'ABORT_ERR' : error?.code ?? 'IMPORT_FAILED' };
}

function interrupted(error, signal) {
  return signal?.aborted || error?.code === 'ABORT_ERR' || error?.name === 'AbortError';
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortReason(signal, 'Import interrupted');
}

function setLifecycle(report, lifecycle) {
  report.lifecycle = lifecycle;
  if (!report.lifecycleHistory.includes(lifecycle)) report.lifecycleHistory.push(lifecycle);
}

async function persistWorkerReport(root, taskId, importId, result, report) {
  if (!taskId || result?.report == null) return null;
  const workerReportPath = path.join(atbRoot(root), 'tasks', taskId, 'imports', importId, 'REPORT.md');
  await mkdir(path.dirname(workerReportPath), { recursive: true });
  await writeFile(workerReportPath, result.report, 'utf8');
  const workerReport = parseWorkerReport(result.report, { findings: result.reportFindings ?? [], path: workerReportPath });
  report.workerReportPath = workerReportPath;
  report.workerReportRedactions = workerReport.privacyFindings.length;
  return workerReport;
}

function rejectedReport(importId) {
  return {
    protocol: '1.0',
    importId,
    lifecycle: 'rejected',
    lifecycleHistory: ['rejected'],
    resultStatus: null,
    stagingRoot: null,
    stagingRetained: false,
    cleanup: null,
    error: null,
    activeTreeBefore: null,
    activeTreeAfter: null,
    activeWorktreeModifiedByImport: null,
  };
}

export async function importResult({
  repoRoot,
  resultPath,
  stagingDir,
  signal,
  validationPolicy,
  validationConfirmed = false,
  validationTimeoutMs,
  validationMaxOutputBytes = 512_000,
  allowElision = false,
} = {}) {
  const root = repoRoot ? await findGitRoot(repoRoot) : await findGitRoot(process.cwd());
  const projectConfig = await loadProjectConfig(root);
  const resolvedValidationPolicy = resolveValidationPolicy(validationPolicy, projectConfig);
  const resolvedValidationTimeoutMs = validationTimeoutMs ?? projectConfig.validationTimeoutMs ?? 120_000;
  const importId = `import_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  let report = rejectedReport(importId);
  let taskId = null;
  let task = null;
  let result = null;
  let lifecycleRecord = null;
  let originalError = null;
  let stagingAttempted = false;
  try {
    throwIfAborted(signal);
    const materialized = await materializeResult({ repoRoot: root, resultPath: path.resolve(resultPath) });
    result = await inspectResultCapsule(materialized.resultPath);
    result.transport = materialized;
    throwIfAborted(signal);
    task = await loadStoredTask(root, result.manifest.task_id);
    throwIfAborted(signal);
    taskId = task.manifest.task_id;
    lifecycleRecord = {
      taskId,
      importId,
      state: 'exported',
      events: [{ state: 'exported', at: new Date().toISOString(), source: 'import' }],
    };
    lifecycleRecord = transitionLifecycle(lifecycleRecord, 'result-received', { resultStatus: result.manifest.status });
    lifecycleRecord = transitionLifecycle(lifecycleRecord, 'inspected', { resultStatus: result.manifest.status });
    await writeLifecycle(root, lifecycleRecord);
    const taskBase = task.manifest.project?.base_commit;
    if (result.manifest.source_base_commit !== taskBase) {
      throw new AtbError('RESULT_BASE_MISMATCH', `Result source base commit does not match stored task baseline (${result.manifest.source_base_commit} != ${taskBase})`);
    }
    const baseline = new Map(task.files.map((file) => [file.path, file]));
    const [currentGit, validationSnapshot] = await Promise.all([
      getGitState(root),
      captureValidationSnapshot(root, { projectConfig }),
    ]);
    throwIfAborted(signal);
    const fileReports = [];
    // Copies: EOL normalization and merges change content without touching the inspected archive data.
    const incoming = result.files.map((file) => ({ ...file }));
    for (const file of incoming) {
      const current = await currentState(root, file.path);
      let status = classifyDrift({ path: file.path, operation: file.operation, baseline, current, editableScope: task.delegation.editable_scope ?? [] });
      const fileReport = { path: file.path, operation: file.operation, status, current };
      fileReports.push(fileReport);
      if (file.operation === 'delete' || status === 'OUT_OF_SCOPE' || status === 'INVALID_OPERATION_PRECONDITION') continue;
      const baselineContent = baseline.get(file.path)?.content ?? null;
      if (baselineContent !== null) {
        const normalized = normalizeEol(file.content, eolStyle(baselineContent));
        if (normalized !== file.content) { file.content = normalized; fileReport.eolNormalized = true; }
      }
      const elision = detectElision({ content: file.content, baselineContent });
      if (elision.suspect) {
        // allowElision: the host reviewed the markers and found genuine comments or an intentional shrink.
        fileReport.elision = { markers: elision.markers, shrink: elision.shrink, allowed: allowElision };
        if (!allowElision) {
          fileReport.status = 'SUSPECT_ELISION';
          continue;
        }
      }
      if (status === 'LOCAL_CHANGED' && file.operation === 'modify') {
        const local = await readFile(path.join(root, ...file.path.split('/')), 'utf8');
        const merge = await mergeThreeWay({ base: baselineContent, current: local, worker: file.content });
        if (merge.ok && merge.conflicts === 0) {
          file.content = merge.content;
          fileReport.status = 'MERGED_CLEAN';
        } else {
          fileReport.merge = merge.ok ? { conflicts: merge.conflicts, content: merge.content } : { error: merge.error };
        }
      }
    }

    const candidateRoot = path.join(atbRoot(root), 'tasks', taskId, 'imports', importId, 'candidates');
    const activeTreeBefore = await fingerprintActiveTree(root);
    throwIfAborted(signal);
    report = {
      protocol: '1.0',
      taskId,
      importId,
      lifecycle: 'inspected',
      lifecycleHistory: ['inspected'],
      resultStatus: result.manifest.status ?? 'legacy',
      sourceAgent: task.manifest.source_agent,
      sourceBaseCommit: taskBase,
      currentHead: currentGit.head,
      repositoryBaseChanged: currentGit.head !== taskBase,
      stagingRoot: null,
      stagingRetained: false,
      cleanup: null,
      excludedPaths: [],
      candidateRoot,
      resultSummary: result.manifest.summary ?? '',
      transport: result.transport.transport,
      ...(result.transport.replyPath ? { replyPath: result.transport.replyPath, replyCapsulePath: result.transport.resultPath } : {}),
      files: fileReports,
      stagedFiles: [],
      conflicts: [],
      validation: null,
      error: null,
      activeTreeBefore,
      activeTreeAfter: null,
      activeWorktreeModifiedByImport: null,
      acceptance: null,
    };

    try {
      throwIfAborted(signal);
      stagingAttempted = true;
      const staging = await createIsolatedStaging(root, taskId, {
        selectedPaths: task.files.map((file) => file.path),
        stagingDir,
      });
      report.stagingRoot = staging.stagingRoot;
      report.excludedPaths = staging.excludedWorkingTreePaths;
      throwIfAborted(signal);
      await mkdir(candidateRoot, { recursive: true });
      for (let i = 0; i < incoming.length; i++) {
        throwIfAborted(signal);
        const file = incoming[i];
        let status = fileReports[i].status;
        if (STAGEABLE_STATUSES.has(status) && !(await isSafeStagingPath(report.stagingRoot, file.path))) {
          status = 'UNSAFE_SYMLINK_PATH';
          fileReports[i].status = status;
        }
        if (STAGEABLE_STATUSES.has(status)) {
          await applyStagedFile(report.stagingRoot, file);
          report.stagedFiles.push(file.path);
          fileReports[i].appliedToStaging = true;
        } else {
          fileReports[i].candidatePath = await saveCandidate(candidateRoot, file);
          fileReports[i].appliedToStaging = false;
          if (fileReports[i].merge?.content !== undefined) {
            const { content, ...merge } = fileReports[i].merge;
            merge.conflictMarkersPath = await saveCandidate(`${candidateRoot}-merge`, { ...file, content });
            fileReports[i].merge = merge;
          }
        }
      }
      report.conflicts = fileReports.filter((file) => !file.appliedToStaging).map((file) => ({ path: file.path, status: file.status }));
      setLifecycle(report, 'staged');
      throwIfAborted(signal);
      const configChange = await validationConfigChanged(report.stagingRoot, validationSnapshot);
      if (configChange.changed) {
        report.validation = {
          passed: null,
          blocked: true,
          reason: 'VALIDATION_CONFIG_CHANGED',
          paths: configChange.paths,
          results: [],
        };
      } else if (resolvedValidationPolicy === 'prompt' && !validationConfirmed) {
        report.validation = {
          passed: null,
          blocked: true,
          reason: 'VALIDATION_CONFIRMATION_REQUIRED',
          results: [],
        };
      } else {
        const dependencyLinks = resolvedValidationPolicy === 'skip' ? [] : await linkDependencyDirectories(root, report.stagingRoot);
        report.validation = await runValidation(report.stagingRoot, validationSnapshot.commands, {
          signal,
          policy: resolvedValidationPolicy,
          confirmed: validationConfirmed,
          timeoutMs: resolvedValidationTimeoutMs,
          maxOutputBytes: validationMaxOutputBytes,
          repoRoot: report.stagingRoot,
        }).finally(() => unlinkDependencyDirectories(dependencyLinks));
        report.validation.blocked = false;
        report.validation.dependencyLinks = dependencyLinks.map((link) => link.path);
        const skipped = report.validation.results.find((entry) => entry.status === 'SKIPPED');
        if (skipped) throw new AtbError('VALIDATION_PROCESS_FAILED', `Validation command could not start: ${skipped.name}`);
      }
      throwIfAborted(signal);
      report.validation.partial = report.conflicts.length > 0;
      setLifecycle(report, 'reviewed');
      report.stagingRetained = true;
    } catch (error) {
      originalError = error;
      setLifecycle(report, interrupted(error, signal) ? 'interrupted' : 'failed');
      report.error = failureMetadata(error, signal);
    } finally {
      if (!report.stagingRetained && report.stagingRoot) {
        report.cleanup = await cleanupIsolatedStaging({ repoRoot: root, stagingRoot: report.stagingRoot });
      }
    }
  } catch (error) {
    originalError = error;
    setLifecycle(report, interrupted(error, signal) ? 'interrupted' : stagingAttempted || report.stagingRoot ? 'failed' : 'rejected');
    report.error = failureMetadata(error, signal);
  } finally {
    try {
      if (report.activeTreeBefore) {
        const activeTreeAfter = await fingerprintActiveTree(root);
        report.activeTreeAfter = activeTreeAfter;
        report.activeWorktreeModifiedByImport = activeTreeChanged(report.activeTreeBefore, activeTreeAfter);
      }
      if (task && result && report) report.acceptance = buildAcceptanceEvidence(task, result, report);
      const workerReport = await persistWorkerReport(root, taskId, importId, result, report);
      report.reportPath = await persistImportReport(root, { taskId, importId, report });
      if (lifecycleRecord) {
        const recorded = new Set(lifecycleRecord.events.map((event) => event.state));
        for (const state of report.lifecycleHistory ?? [report.lifecycle]) {
          if (state === lifecycleRecord.state || recorded.has(state)) continue;
          const details = report.error ? { error: report.error } : { resultStatus: report.resultStatus };
          lifecycleRecord = transitionLifecycle(lifecycleRecord, state, details);
          recorded.add(state);
        }
        await writeLifecycle(root, lifecycleRecord);
      }
      if (task && result && taskId) {
        const receipt = createReceipt({ task, result, importReport: report, lifecycle: lifecycleRecord, observedZipHash: result.archive_sha256 });
        report.receiptPath = await writeImmutableReceipt(root, taskId, importId, receipt);
        const review = await buildReviewData({ repoRoot: root, importReport: report, lifecycle: lifecycleRecord, receipt, workerReport });
        const reviewPath = path.join(atbRoot(root), 'tasks', taskId, 'imports', importId, 'review.json');
        await writeFile(reviewPath, JSON.stringify(review, null, 2), 'utf8');
        report.reviewPath = reviewPath;
        await writeFile(report.reportPath, JSON.stringify(report, null, 2), 'utf8');
      }
    } catch (error) {
      if (!originalError) throw error;
      originalError.reportPersistenceError = failureMetadata(error, signal);
    }
  }
  if (originalError) throw originalError;
  return report;
}
