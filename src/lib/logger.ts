import chalk from "chalk";

export interface LoggerOptions {
	quiet?: boolean;
	verbose?: boolean;
}

export class Logger {
	constructor(private options: LoggerOptions = {}) {}

	info(message: string): void {
		if (!this.options.quiet) {
			console.log(chalk.blue(message));
		}
	}

	success(message: string): void {
		if (!this.options.quiet) {
			console.log(chalk.green(message));
		}
	}

	warn(message: string): void {
		if (!this.options.quiet) {
			console.error(chalk.yellow("Warning:"), message);
		}
	}

	verbose(message: string): void {
		if (this.options.verbose && !this.options.quiet) {
			console.log(chalk.gray(message));
		}
	}

	error(message: string): void {
		console.error(chalk.red("Error:"), message);
	}
}
