export class DraftValidationError extends Error {
  constructor(message: string) {
    super(`Invalid ticket draft: ${message}`);
    this.name = 'DraftValidationError';
  }
}
