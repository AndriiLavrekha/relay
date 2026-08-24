export class AtbError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'AtbError';
    this.code = code;
    this.details = details;
  }
}

export function unsafeStagingLocation(message, details = undefined) {
  return new AtbError('UNSAFE_STAGING_LOCATION', message, details);
}

export function stagingLocationUnavailable(repoRoot, details = undefined) {
  return new AtbError(
    'STAGING_LOCATION_UNAVAILABLE',
    `Unable to create a safe staging directory outside the repository: ${repoRoot}. Provide an explicit writable directory on the same filesystem.`,
    details
  );
}

export function invalidOperationPrecondition(path, operation) {
  return new AtbError(
    'INVALID_OPERATION_PRECONDITION',
    `Unsupported operation for ${path}: ${operation}`,
    { path, operation }
  );
}
