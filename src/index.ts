import chalk from "chalk";
import { Command } from "commander";
import pkg from "../package.json";
import { diff } from "./commands/diff.js";
import { introspect } from "./commands/introspect.js";
import { CliError } from "./lib/errors.js";

const program = new Command();

program
	.name("turso-introspect")
	.description("Introspect the database schema of a Turso/libsql database")
	.version(pkg.version)
	.argument(
		"[database]",
		"Database URL (libsql://...), name, or local SQLite file path",
	)
	.option("--org <name>", "Organization name (required when using db name)")
	.option(
		"--token <token>",
		"Authentication token (overrides TURSO_AUTH_TOKEN)",
	)
	.option(
		"-o, --output <path>",
		"Output file path (default: {db}-schema.{sql|json})",
	)
	.option("--stdout", "Write to stdout instead of file")
	.option("--format <type>", "Output format: sql (default) or json", "sql")
	.option("--tables <list>", "Comma-separated list of tables to include")
	.option(
		"--exclude-tables <list>",
		"Comma-separated list of tables to exclude",
	)
	.option("--include-system", "Include SQLite/libsql system tables")
	.option("--normalize-defaults", "Normalize common DEFAULT expressions")
	.option("--check", "Validate connection without producing output")
	.option(
		"--retries <number>",
		"Retry failed connections N times",
		(value) => Number.parseInt(value, 10),
		3,
	)
	.option(
		"--retry-delay <ms>",
		"Base retry delay in milliseconds",
		(value) => Number.parseInt(value, 10),
		500,
	)
	.option("-q, --quiet", "Suppress warnings and informational output")
	.option("-v, --verbose", "Show detailed progress information")
	.action(async (database, options) => {
		try {
			await introspect(database, options);
		} catch (error: unknown) {
			if (error instanceof CliError) {
				console.error(chalk.red("Error:"), error.message);
				process.exit(error.code);
			}
			const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
		console.error(chalk.red("Error:"), message);
			process.exit(1);
		}
	});

program
	.command("diff")
	.description("Compare schemas between two sources")
	.argument("<db1>", "First database source")
	.argument("<db2>", "Second database source")
	.option(
		"--diff-format <type>",
		"Output format: diff (default) or migration",
		"diff",
	)
	.option("--org <name>", "Organization (when using db names)")
	.option("--token <token>", "Authentication token")
	.option(
		"--retries <number>",
		"Retry failed connections N times",
		(value) => Number.parseInt(value, 10),
		3,
	)
	.option(
		"--retry-delay <ms>",
		"Base retry delay in milliseconds",
		(value) => Number.parseInt(value, 10),
		500,
	)
	.option("-q, --quiet", "Suppress warnings and informational output")
	.option("-v, --verbose", "Show detailed progress information")
	.action(async (db1, db2, options) => {
		try {
			await diff(db1, db2, options);
		} catch (error: unknown) {
			if (error instanceof CliError) {
				console.error(chalk.red("Error:"), error.message);
				process.exit(error.code);
			}
			const message = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
		console.error(chalk.red("Error:"), message);
			process.exit(1);
		}
	});

program.parse();
