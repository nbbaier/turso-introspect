import chalk from "chalk";

export type CliExitCode = 1 | 2 | 3;

export class CliError extends Error {
	constructor(
		message: string,
		public code: CliExitCode,
	) {
		super(message);
		this.name = "CliError";
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

export function handleError(error: unknown): never {
	if (error instanceof CliError) {
		console.error(chalk.red("Error:"), error.message);
		process.exit(error.code);
	}
	const message =
		error && typeof error === "object" && "message" in error
			? String(error.message)
			: String(error);
	console.error(chalk.red("Error:"), message);
	process.exit(1);
}
