import type { Client } from "@libsql/client";
import { quoteIdent } from "./utils.js";

export interface Column {
	cid: number;
	name: string;
	type: string;
	notnull: number;
	dflt_value: string | null;
	pk: number;
}

export interface ForeignKey {
	id: number;
	seq: number;
	table: string;
	from: string;
	to: string;
	on_update: string;
	on_delete: string;
	match: string;
}

export interface IndexInfo {
	seqno: number;
	cid: number;
	name: string;
}

export interface Index {
	name: string;
	unique: boolean;
	origin: string;
	partial: boolean;
	columns: string[];
	sql?: string;
}

export interface Table {
	name: string;
	sql: string;
	columns: Column[];
	foreignKeys: ForeignKey[];
	indexes: Index[];
}

export interface View {
	name: string;
	sql: string;
}

export interface Trigger {
	name: string;
	sql: string;
}

export interface Schema {
	metadata: {
		database: string;
		timestamp: string;
		version: string;
	};
	tables: Table[];
	views: View[];
	triggers: Trigger[];
}

export interface IntrospectOptions {
	tables?: string[];
	excludeTables?: string[];
	includeSystem?: boolean;
}

export async function introspectSchema(
	client: Client,
	dbName: string,
	options: IntrospectOptions = {},
): Promise<Schema> {
	const tables: Table[] = [];
	const views: View[] = [];
	const triggers: Trigger[] = [];

	// Get master table entries
	const masterResult = await client.execute(
		"SELECT type, name, sql, tbl_name FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name",
	);

	const tablesToProcess: string[] = [];
	const viewsToProcess: { name: string; sql: string }[] = [];
	const triggersToProcess: { name: string; sql: string }[] = [];
	const tableSqlMap = new Map<string, string>();
	const indexSqlMap = new Map<string, string>();

	for (const row of masterResult.rows) {
		const type = row.type as string;
		const name = row.name as string;
		const sql = row.sql as string;

		if (type === "index") {
			indexSqlMap.set(name, sql);
			continue;
		}

		if (shouldSkip(name, options)) continue;

		if (type === "table") {
			tablesToProcess.push(name);
			tableSqlMap.set(name, sql);
		} else if (type === "view") {
			viewsToProcess.push({ name, sql });
		} else if (type === "trigger") {
			triggersToProcess.push({ name, sql });
		}
	}

	// Process tables
	for (const tableName of tablesToProcess) {
		// Get table SQL from cache
		const tableSql = tableSqlMap.get(tableName) || "";

		// Parallelize PRAGMA calls
		const [columnsRes, fkRes, idxListRes] = await Promise.all([
			client.execute(`PRAGMA table_info(${quoteIdent(tableName)})`),
			client.execute(`PRAGMA foreign_key_list(${quoteIdent(tableName)})`),
			client.execute(`PRAGMA index_list(${quoteIdent(tableName)})`),
		]);

		const columns: Column[] = columnsRes.rows.map((r) => ({
			cid: Number(r.cid),
			name: String(r.name),
			type: String(r.type),
			notnull: Number(r.notnull),
			dflt_value: r.dflt_value as string | null,
			pk: Number(r.pk),
		}));

		const foreignKeys: ForeignKey[] = fkRes.rows.map((r) => ({
			id: Number(r.id),
			seq: Number(r.seq),
			table: String(r.table),
			from: String(r.from),
			to: String(r.to),
			on_update: String(r.on_update),
			on_delete: String(r.on_delete),
			match: String(r.match),
		}));

		// Process indexes in parallel
		const indexes: Index[] = await Promise.all(
			idxListRes.rows.map(async (idxRow) => {
				const idxName = String(idxRow.name);
				const origin = String(idxRow.origin);

				// Use cached SQL
				const idxSql = indexSqlMap.get(idxName);

				const idxInfoRes = await client.execute(
					`PRAGMA index_info(${quoteIdent(idxName)})`,
				);
				const idxColumns = idxInfoRes.rows.map((r) => String(r.name));

				return {
					name: idxName,
					unique: Boolean(idxRow.unique),
					origin: origin,
					partial: Boolean(idxRow.partial),
					columns: idxColumns,
					sql: idxSql,
				};
			}),
		);

		tables.push({
			name: tableName,
			sql: tableSql,
			columns,
			foreignKeys,
			indexes,
		});
	}

	// Process views
	for (const v of viewsToProcess) {
		views.push(v);
	}

	// Process triggers
	for (const t of triggersToProcess) {
		triggers.push(t);
	}

	return {
		metadata: {
			database: dbName,
			timestamp: new Date().toISOString(),
			version: "1.0.0",
		},
		tables,
		views,
		triggers,
	};
}

function shouldSkip(name: string, options: IntrospectOptions): boolean {
	// System tables
	if (!options.includeSystem) {
		if (
			name.startsWith("sqlite_") ||
			name.startsWith("_litestream_") ||
			name.startsWith("_cf_")
		) {
			return true;
		}
	}

	// Exclude list
	if (options.excludeTables?.includes(name)) {
		return true;
	}

	// Include list (if specified, must be in it)
	if (options.tables && options.tables.length > 0) {
		if (!options.tables.includes(name)) {
			return true;
		}
	}

	return false;
}
