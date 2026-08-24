export class AtbError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'AtbError';
    this.code = code;
    this.details = details;
  }
}
