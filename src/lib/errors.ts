export type CliExitCode = 1 | 2 | 3;

export class CliError extends Error {
  constructor(message: string, public code: CliExitCode) {
    super(message);
    this.name = 'CliError';
  }
}

export function connectionError(message: string): CliError {
  return new CliError(message, 1);
}

export function invalidArgsError(message: string): CliError {
  return new CliError(message, 2);
}

export function notFoundError(message: string): CliError {
  return new CliError(message, 3);
}
