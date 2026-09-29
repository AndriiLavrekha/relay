const VALID_STATUSES = new Set(['verified', 'unverified', 'unmet', 'blocked', 'deferred_to_host']);

const HOST_CATEGORIES = [
  {
    step: /\b(?:database|service|migration|live)\b/i,
    criterion: /\b(?:database|postgres(?:ql)?|mysql|redis|mongodb|docker|service|migration)\b/i,
  },
  {
    step: /\b(?:monorepo|workspace|authoritative|build)\b/i,
    criterion: /\b(?:monorepo|workspace|pnpm|turbo|full\s+(?:build|test)|authoritative)\b/i,
  },
  {
    step: /\b(?:git|branch|commit|push)\b/i,
    criterion: /\b(?:git\s+push|git\s+commit|merge|remote\s+branch|ci\/cd|pipeline)\b/i,
  },
];

function claimDefersToHost(claim) {
  return typeof claim === 'string' && /\b(?:deferred_to_host|host-owned|host owned)\b/i.test(claim);
}

export function isHostOwnedCriterion(criterionText, hostOwnedSteps = [], workerClaim = null) {
  const text = String(criterionText ?? '');
  const steps = Array.isArray(hostOwnedSteps) ? hostOwnedSteps : [];
  if (/^\s*(?:\[host(?:-owned)?\]|\(host\)|host-owned:)/i.test(text)) return true;
  const folded = text.trim().toLowerCase();
  if (folded && steps.some((step) => String(step).trim().toLowerCase() === folded)) return true;
  if (HOST_CATEGORIES.some((category) => steps.some((step) => category.step.test(String(step))) && category.criterion.test(text))) return true;
  if (steps.length > 0 && claimDefersToHost(workerClaim) && HOST_CATEGORIES.some((category) => category.criterion.test(text))) return true;
  return false;
}

function claimText(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return null;
  return typeof value.claim === 'string' ? value.claim : typeof value.text === 'string' ? value.text : null;
}

function isValidationCriterion(text) {
  return /\b(?:test|tests|lint|build|typecheck|type-check|validation)\b/i.test(text);
}

function matchingFile(text, files) {
  return files.find((file) => text.includes(file.path)) ?? null;
}

function criterionEvidence(text, result, localState, hostOwnedSteps, workerClaim) {
  const evidence = [];
  if (isHostOwnedCriterion(text, hostOwnedSteps, workerClaim)) {
    evidence.push('Step is declared as host-owned and will be verified locally by host agent.');
    return { status: 'deferred_to_host', evidence };
  }
  const file = matchingFile(text, localState.files ?? []);
  if (file) {
    if (file.appliedToStaging) {
      evidence.push(`Bridge staged returned file ${file.path}.`);
      return { status: 'verified', evidence };
    }
    evidence.push(`Bridge withheld returned file ${file.path} (${file.status}).`);
    return { status: 'unmet', evidence };
  }

  if (isValidationCriterion(text)) {
    if (localState.validation?.blocked) {
      evidence.push(`Local validation was blocked: ${localState.validation.reason ?? 'unspecified'}.`);
      return { status: 'blocked', evidence };
    }
    const results = localState.validation?.results ?? [];
    if (results.length > 0 && results.every((entry) => entry.status === 'PASS') && !(localState.validation?.partial || localState.conflicts?.length)) {
      evidence.push('Local validation completed successfully.');
      return { status: 'verified', evidence };
    }
    if (results.length > 0) evidence.push('Local validation did not provide an unambiguous pass for the complete returned scope.');
  }

  if (result.manifest.status === 'blocked') {
    evidence.push('The worker reported a blocked result; this does not prove the criterion locally.');
    return { status: 'blocked', evidence };
  }
  evidence.push('No deterministic local rule proves this criterion.');
  return { status: 'unverified', evidence };
}

export function buildAcceptanceEvidence(task, result, localState = {}) {
  const criteria = task?.delegation?.acceptance_criteria ?? [];
  const claims = result?.manifest?.acceptance_criteria ?? [];
  const hostOwnedSteps = Array.isArray(task?.manifest?.host_owned_steps) ? task.manifest.host_owned_steps : [];
  const normalized = criteria.map((text, index) => {
    const claim = claimText(claims[index]);
    const local = criterionEvidence(text, result, localState, hostOwnedSteps, claim);
    const status = VALID_STATUSES.has(local.status) ? local.status : 'unverified';
    return {
      id: `criterion-${index + 1}`,
      text,
      workerClaim: claim,
      localEvidence: local.evidence,
      status,
    };
  });
  const hasBlocked = normalized.some((criterion) => criterion.status === 'blocked');
  const hasUnmet = normalized.some((criterion) => criterion.status === 'unmet');
  const hasUnverified = normalized.some((criterion) => criterion.status === 'unverified');
  const hasDeferred = normalized.some((criterion) => criterion.status === 'deferred_to_host');
  const allDeferred = normalized.length > 0 && normalized.every((criterion) => criterion.status === 'deferred_to_host');
  const overallStatus = hasBlocked
    ? 'blocked'
    : hasUnmet
      ? 'unmet'
      : hasUnverified
        ? 'unverified'
        : allDeferred
          ? 'deferred_to_host'
          : hasDeferred
            ? 'verified_with_deferred'
            : 'verified';
  return { criteria: normalized, overallStatus, hostOwnedSteps };
}
