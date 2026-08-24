const VALID_STATUSES = new Set(['verified', 'unverified', 'unmet', 'blocked']);

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

function criterionEvidence(text, result, localState) {
  const evidence = [];
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
  const normalized = criteria.map((text, index) => {
    const claim = claimText(claims[index]);
    const local = criterionEvidence(text, result, localState);
    const status = VALID_STATUSES.has(local.status) ? local.status : 'unverified';
    return {
      id: `criterion-${index + 1}`,
      text,
      workerClaim: claim,
      localEvidence: local.evidence,
      status,
    };
  });
  const overallStatus = normalized.some((criterion) => criterion.status === 'blocked')
    ? 'blocked'
    : normalized.some((criterion) => criterion.status === 'unmet')
      ? 'unmet'
      : normalized.some((criterion) => criterion.status === 'unverified')
        ? 'unverified'
        : 'verified';
  return { criteria: normalized, overallStatus };
}
