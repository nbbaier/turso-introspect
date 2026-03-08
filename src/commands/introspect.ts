import fs from "node:fs/promises";
import { createDbClient } from "../lib/db.js";
import { CliError, connectionError, invalidArgsError } from "../lib/errors.js";
import { formatJson, formatSql } from "../lib/formatter.js";
import { Logger } from "../lib/logger.js";
import { type IntrospectOptions, introspectSchema } from "../lib/schema.js";

interface CommandOptions {
	org?: string;
	token?: string;
	output?: string;
	stdout?: boolean;
	format?: string;
	tables?: string;
	excludeTables?: string;
	includeSystem?: boolean;
	normalizeDefaults?: boolean;
	check?: boolean;
	retries?: number;
	retryDelay?: number;
	quiet?: boolean;
	verbose?: boolean;
}

function parseTableList(raw: string | undefined): string[] | undefined {
	if (!raw) return undefined;

	const values = raw
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);

	if (values.length === 0) {
		return undefined;
	}

	return [...new Set(values)];
}

export async function introspect(
	database: string | undefined,
	options: CommandOptions,
) {
	const logger = new Logger({ quiet: options.quiet, verbose: options.verbose });

	if (!database) {
		throw invalidArgsError("Database argument is required.");
	}

	const format = options.format ?? "sql";
	if (format !== "sql" && format !== "json") {
		throw invalidArgsError(
			`Invalid --format: "${format}". Use "sql" or "json".`,
		);
	}

	if (
		options.retries !== undefined &&
		(!Number.isFinite(options.retries) || options.retries < 0)
	) {
		throw invalidArgsError(
			`Invalid --retries: "${options.retries}". Use a non-negative integer.`,
		);
	}
	if (
		options.retryDelay !== undefined &&
		(!Number.isFinite(options.retryDelay) || options.retryDelay < 0)
	) {
		throw invalidArgsError(
			`Invalid --retry-delay: "${options.retryDelay}". Use a non-negative integer (milliseconds).`,
		);
	}

	const tables = parseTableList(options.tables);
	const excludeTables = parseTableList(options.excludeTables);

	if (options.tables && (!tables || tables.length === 0)) {
		throw invalidArgsError(
			"Invalid --tables: expected a comma-separated list of table names.",
		);
	}

	if (options.excludeTables && (!excludeTables || excludeTables.length === 0)) {
		throw invalidArgsError(
			"Invalid --exclude-tables: expected a comma-separated list of table names.",
		);
	}

	if (tables && excludeTables) {
		const overlap = tables.filter((table) => excludeTables.includes(table));
		if (overlap.length > 0) {
			throw invalidArgsError(
				`Conflicting table filters: ${overlap.join(", ")} present in both --tables and --exclude-tables.`,
			);
		}
	}

	const client = await createDbClient({
		database,
		org: options.org,
		token: options.token,
		retries: options.retries,
		retryDelayMs: options.retryDelay,
	});

	try {
		if (options.check) {
			try {
				await client.execute("SELECT 1");
				logger.success("Connection successful!");
				return;
			} catch (e: unknown) {
				if (e instanceof CliError) throw e;
				const message = e instanceof Error ? e.message : String(e);
				throw connectionError(`Connection failed: ${message}`);
			}
		}

		if (!options.stdout) {
			logger.info(`Introspecting ${database}...`);
		}

		const introspectOptions: IntrospectOptions = {
			tables,
			excludeTables,
			includeSystem: options.includeSystem,
		};

		const schema = await introspectSchema(client, database, introspectOptions);

		if (
			schema.tables.length === 0 &&
			schema.views.length === 0 &&
			schema.triggers.length === 0
		) {
			logger.warn("No user tables found in database.");
		}

		logger.verbose(
			`Found ${schema.tables.length} tables, ${schema.views.length} views, ${schema.triggers.length} triggers`,
		);

		let output = "";
		if (format === "json") {
			output = formatJson(schema);
		} else {
			output = formatSql(schema, {
				normalizeDefaults: options.normalizeDefaults,
			});
		}

		if (options.stdout) {
			console.log(output);
		} else {
			const defaultFilename = `${database.replace(/[^a-zA-Z0-9]/g, "_")}-schema.${format}`;
			const outputPath = options.output || defaultFilename;
			await fs.writeFile(outputPath, output);
			logger.success(`Schema saved to ${outputPath}`);
		}
	} finally {
		client.close();
	}
}
