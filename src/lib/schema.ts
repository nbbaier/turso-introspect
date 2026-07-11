import type { Client } from "@libsql/client";
import { quoteIdent } from "./utils.js";

interface Column {
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

interface View {
	name: string;
	sql: string;
}

interface Trigger {
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

type SqliteRow = Record<string, unknown>;

function mapColumn(row: SqliteRow): Column {
	return {
		cid: Number(row.cid),
		name: String(row.name),
		type: String(row.type),
		notnull: Number(row.notnull),
		dflt_value: row.dflt_value as string | null,
		pk: Number(row.pk),
	};
}

function mapForeignKey(row: SqliteRow): ForeignKey {
	return {
		id: Number(row.id),
		seq: Number(row.seq),
		table: String(row.table),
		from: String(row.from),
		to: String(row.to),
		on_update: String(row.on_update),
		on_delete: String(row.on_delete),
		match: String(row.match),
	};
}

async function getIndexes(
	client: Client,
	tableName: string,
	indexSqlMap: Map<string, string>,
): Promise<Index[]> {
	const idxListRes = await client.execute(
		`PRAGMA index_list(${quoteIdent(tableName)})`,
	);

	const promises = idxListRes.rows.map(async (idxRow) => {
		const idxName = String(idxRow.name);
		const idxInfoRes = await client.execute(
			`PRAGMA index_info(${quoteIdent(idxName)})`,
		);

		const idxSql = indexSqlMap.get(idxName);
		const idxColumns = idxInfoRes.rows.map((r) => String(r.name));

		return {
			name: idxName,
			unique: Boolean(idxRow.unique),
			origin: String(idxRow.origin),
			partial: Boolean(idxRow.partial),
			columns: idxColumns,
			sql: idxSql,
		};
	});

	const indexes = await Promise.all(promises);
	indexes.sort((a, b) => a.name.localeCompare(b.name));
	return indexes;
}

function groupRowsBy(
	rows: SqliteRow[],
	key: "table_name" | "index_name",
): Map<string, SqliteRow[]> {
	const grouped = new Map<string, SqliteRow[]>();

	for (const row of rows) {
		const value = String(row[key]);
		const group = grouped.get(value);
		if (group) {
			group.push(row);
		} else {
			grouped.set(value, [row]);
		}
	}

	return grouped;
}

function isPragmaTableValuedFunctionUnavailable(error: unknown): boolean {
	const message =
		error && typeof error === "object" && "message" in error
			? String(error.message)
			: String(error);

	return (
		/pragma_(?:table_info|foreign_key_list|index_list|index_info)/i.test(
			message,
		) &&
		/(?:no such|not found|unavailable|unsupported|not supported)/i.test(message)
	);
}

async function introspectTablesBatch(
	client: Client,
	tableNames: string[],
	tableSqlMap: Map<string, string>,
	indexSqlMap: Map<string, string>,
): Promise<Table[]> {
	if (tableNames.length === 0) {
		return [];
	}

	const tableValues = tableNames.map(() => "(?)").join(", ");
	const filteredTables = `WITH filtered_tables(name) AS (VALUES ${tableValues})`;
	const [columnsRes, foreignKeysRes, indexesRes, indexColumnsRes] =
		await Promise.all([
			client.execute(
				`${filteredTables}
				SELECT m.name AS table_name, p.cid, p.name, p.type, p."notnull", p.dflt_value, p.pk
				FROM filtered_tables m JOIN pragma_table_info(m.name) p
				ORDER BY m.name, p.cid
			`,
				tableNames,
			),
			client.execute(
				`${filteredTables}
				SELECT m.name AS table_name, f.id, f.seq, f."table", f."from", f."to", f.on_update, f.on_delete, f."match"
				FROM filtered_tables m JOIN pragma_foreign_key_list(m.name) f
				ORDER BY m.name, f.id, f.seq
			`,
				tableNames,
			),
			client.execute(
				`${filteredTables}
				SELECT m.name AS table_name, il.name, il."unique", il.origin, il.partial
				FROM filtered_tables m JOIN pragma_index_list(m.name) il
				ORDER BY m.name, il.name
			`,
				tableNames,
			),
			client.execute(
				`${filteredTables}
				SELECT m.name AS table_name, il.name AS index_name, ii.seqno, ii.cid, ii.name
				FROM filtered_tables m JOIN pragma_index_list(m.name) il JOIN pragma_index_info(il.name) ii
				ORDER BY m.name, il.name, ii.seqno
			`,
				tableNames,
			),
		]);

	const columnsByTable = groupRowsBy(columnsRes.rows, "table_name");
	const foreignKeysByTable = groupRowsBy(foreignKeysRes.rows, "table_name");
	const indexesByTable = groupRowsBy(indexesRes.rows, "table_name");
	const columnsByIndex = groupRowsBy(indexColumnsRes.rows, "index_name");

	return tableNames.map((name) => {
		const indexes = (indexesByTable.get(name) ?? []).map((row) => {
			const indexName = String(row.name);
			return {
				name: indexName,
				unique: Boolean(row.unique),
				origin: String(row.origin),
				partial: Boolean(row.partial),
				columns: (columnsByIndex.get(indexName) ?? []).map((column) =>
					String(column.name),
				),
				sql: indexSqlMap.get(indexName),
			};
		});
		indexes.sort((a, b) => a.name.localeCompare(b.name));

		return {
			name,
			sql: tableSqlMap.get(name) ?? "",
			columns: (columnsByTable.get(name) ?? []).map(mapColumn),
			foreignKeys: (foreignKeysByTable.get(name) ?? []).map(mapForeignKey),
			indexes,
		};
	});
}

async function introspectTablesSequential(
	client: Client,
	tableNames: string[],
	tableSqlMap: Map<string, string>,
	indexSqlMap: Map<string, string>,
): Promise<Table[]> {
	const tables: Table[] = [];

	for (const name of tableNames) {
		const [columnsRes, fkRes] = await Promise.all([
			client.execute(`PRAGMA table_info(${quoteIdent(name)})`),
			client.execute(`PRAGMA foreign_key_list(${quoteIdent(name)})`),
		]);

		tables.push({
			name,
			sql: tableSqlMap.get(name) ?? "",
			columns: columnsRes.rows.map(mapColumn),
			foreignKeys: fkRes.rows.map(mapForeignKey),
			indexes: await getIndexes(client, name, indexSqlMap),
		});
	}

	return tables;
}

export async function introspectSchema(
	client: Client,
	dbName: string,
	options: IntrospectOptions = {},
): Promise<Schema> {
	const views: View[] = [];
	const triggers: Trigger[] = [];
	const indexSqlMap = new Map<string, string>();
	const tableNames: string[] = [];
	const tableSqlMap = new Map<string, string>();
	const viewNames = new Set<string>();

	const masterResult = await client.execute(
		"SELECT type, name, sql, tbl_name FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name",
	);

	// First pass: collect all index SQL definitions and view names.
	// View names are needed before filtering because an INSTEAD OF trigger's
	// tbl_name refers to its view, and the trigger must follow the view's
	// filter verdict.
	for (const row of masterResult.rows) {
		if (row.type === "index") {
			indexSqlMap.set(String(row.name), String(row.sql));
		}
		if (row.type === "view") {
			viewNames.add(String(row.name));
		}
	}

	for (const row of masterResult.rows) {
		const name = String(row.name);
		const type = String(row.type);
		const sql = String(row.sql);
		const tblName = String(row.tbl_name);

		if (type === "index") {
			continue;
		}

		if (type !== "table" && type !== "view" && type !== "trigger") {
			continue;
		}

		if (shouldSkip(name, type, tblName, viewNames, options)) {
			continue;
		}

		if (type === "view") {
			views.push({ name, sql });
			continue;
		}

		if (type === "trigger") {
			triggers.push({ name, sql });
			continue;
		}

		if (type === "table") {
			tableNames.push(name);
			tableSqlMap.set(name, sql);
		}
	}

	let tables: Table[];
	try {
		tables = await introspectTablesBatch(
			client,
			tableNames,
			tableSqlMap,
			indexSqlMap,
		);
	} catch (error: unknown) {
		if (!isPragmaTableValuedFunctionUnavailable(error)) {
			throw error;
		}

		// Pragma table-valued functions may be unavailable on some servers.
		tables = await introspectTablesSequential(
			client,
			tableNames,
			tableSqlMap,
			indexSqlMap,
		);
	}

	tables.sort((a, b) => a.name.localeCompare(b.name));

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

function shouldSkip(
	name: string,
	type: "table" | "view" | "trigger",
	tblName: string,
	viewNames: Set<string>,
	options: IntrospectOptions,
): boolean {
	// For triggers, filter decisions are based on the object they belong to
	// (a table, or a view for INSTEAD OF triggers).
	const filterName = type === "trigger" ? tblName : name;

	if (!options.includeSystem && isSystemName(filterName)) {
		return true;
	}

	if (options.excludeTables?.includes(filterName)) {
		return true;
	}

	// Views are exempt from the --tables allow-list, and so are triggers
	// defined on a view (INSTEAD OF triggers) — they follow the view's verdict.
	const exemptFromAllowList =
		type === "view" || (type === "trigger" && viewNames.has(filterName));

	if (
		!exemptFromAllowList &&
		options.tables &&
		options.tables.length > 0 &&
		!options.tables.includes(filterName)
	) {
		return true;
	}

	return false;
}

function isSystemName(name: string): boolean {
	return (
		name.startsWith("sqlite_") ||
		name.startsWith("_litestream_") ||
		name.startsWith("_cf_")
	);
}
