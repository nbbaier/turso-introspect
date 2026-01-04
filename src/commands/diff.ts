import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import * as Diff from "diff";
import { createDbClient } from "../lib/db.js";
import { invalidArgsError } from "../lib/errors.js";
import { formatSql } from "../lib/formatter.js";
import { Logger } from "../lib/logger.js";
import { introspectSchema } from "../lib/schema.js";

interface DiffOptions {
	diffFormat?: string;
	org?: string;
	token?: string;
	quiet?: boolean;
	verbose?: boolean;
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
				logger.verbose(`Reading schema from file: ${source}`);
				return await fs.readFile(source, "utf-8");
			}
		} catch (e: any) {
			if (e.name === "CliError") throw e;
		}
	}

	logger.verbose(`Fetching schema from database: ${source}`);
	const client = await createDbClient({
		database: source,
		org: options.org,
		token: options.token,
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
	if (diffs.length === 1 && !diffs[0].added && !diffs[0].removed) {
		logger.success("Schemas are identical.");
		return;
	}

	console.log(patch);
}
