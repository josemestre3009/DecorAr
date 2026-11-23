export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
    readonly metadata: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, options);
    this.name = "DomainError";
  }
}
