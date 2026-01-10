import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import * as Diff from "diff";
import { createDbClient } from "../lib/db.js";
import { CliError, invalidArgsError } from "../lib/errors.js";
import { formatSql } from "../lib/formatter.js";
import { Logger } from "../lib/logger.js";
import { introspectSchema } from "../lib/schema.js";

interface DiffOptions {
	diffFormat?: string;
	org?: string;
	token?: string;
	retries?: number;
	retryDelay?: number;
	quiet?: boolean;
	verbose?: boolean;
}

async function isSqliteDatabaseFile(path: string): Promise<boolean> {
	try {
		const file = await fs.open(path, "r");
		try {
			const header = Buffer.alloc(16);
			const { bytesRead } = await file.read(header, 0, header.length, 0);
			if (bytesRead < 16) return false;
			return header.toString("utf-8") === "SQLite format 3\u0000";
		} finally {
			await file.close();
		}
	} catch {
		return false;
	}
}

async function getSchemaSql(
	source: string,
	options: DiffOptions,
	logger: Logger,
): Promise<string> {
	if (existsSync(source)) {
		try {
			const stats = await fs.stat(source);
			if (stats.isDirectory()) {
				throw invalidArgsError(
					`"${source}" is a directory, expected a file or database`,
				);
			}
			if (stats.isFile()) {
				if (await isSqliteDatabaseFile(source)) {
					logger.verbose(`Introspecting local SQLite database: ${source}`);
				} else {
					logger.verbose(`Reading schema from file: ${source}`);
					return await fs.readFile(source, "utf-8");
				}
			}
		} catch (e: unknown) {
			if (e instanceof CliError) throw e;
		}
	}

	logger.verbose(`Fetching schema from database: ${source}`);
	const client = await createDbClient({
		database: source,
		org: options.org,
		token: options.token,
		retries: options.retries,
		retryDelayMs: options.retryDelay,
	});

	try {
		const schema = await introspectSchema(client, source);
		return formatSql(schema);
	} finally {
		client.close();
	}
}

export async function diff(db1: string, db2: string, options: DiffOptions) {
	const logger = new Logger({ quiet: options.quiet, verbose: options.verbose });

	const diffFormat = options.diffFormat ?? "diff";
	if (diffFormat !== "diff" && diffFormat !== "migration") {
		throw invalidArgsError(
			`Invalid --diff-format: "${diffFormat}". Use "diff" or "migration".`,
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

	logger.info(`Comparing ${db1} and ${db2}...`);

	const [sql1, sql2] = await Promise.all([
		getSchemaSql(db1, options, logger),
		getSchemaSql(db2, options, logger),
	]);

	if (diffFormat === "migration") {
		logger.warn(
			'"migration" format is not fully implemented yet. Falling back to unified diff.',
		);
	}

	const patch = Diff.createTwoFilesPatch(db1, db2, sql1, sql2);

	const diffs = Diff.diffLines(sql1, sql2);
	const firstDiff = diffs[0];
	if (
		diffs.length === 1 &&
		firstDiff &&
		!firstDiff.added &&
		!firstDiff.removed
	) {
		logger.success("Schemas are identical.");
		return;
	}

	console.log(patch);
}
