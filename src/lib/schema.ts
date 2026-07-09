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

export async function introspectSchema(
	client: Client,
	dbName: string,
	options: IntrospectOptions = {},
): Promise<Schema> {
	const tables: Table[] = [];
	const views: View[] = [];
	const triggers: Trigger[] = [];
	const indexSqlMap = new Map<string, string>();
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
			// Tables need further introspection
			const [columnsRes, fkRes] = await Promise.all([
				client.execute(`PRAGMA table_info(${quoteIdent(name)})`),
				client.execute(`PRAGMA foreign_key_list(${quoteIdent(name)})`),
			]);

			const columns = columnsRes.rows.map(mapColumn);
			const foreignKeys = fkRes.rows.map(mapForeignKey);
			const indexes = await getIndexes(client, name, indexSqlMap);

			tables.push({
				name,
				sql,
				columns,
				foreignKeys,
				indexes,
			});
		}
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
