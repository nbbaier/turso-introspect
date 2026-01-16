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

function mapColumn(row: any): Column {
	return {
		cid: Number(row.cid),
		name: String(row.name),
		type: String(row.type),
		notnull: Number(row.notnull),
		dflt_value: row.dflt_value as string | null,
		pk: Number(row.pk),
	};
}

function mapForeignKey(row: any): ForeignKey {
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

	return Promise.all(promises);
}

export async function introspectSchema(
	client: Client,
	dbName: string,
	options: IntrospectOptions = {},
): Promise<Schema> {
	const views: View[] = [];
	const triggers: Trigger[] = [];
	const indexSqlMap = new Map<string, string>();

	const masterResult = await client.execute(
		"SELECT type, name, sql, tbl_name FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name",
	);

	// First pass: collect all index SQL definitions
	for (const row of masterResult.rows) {
		if (row.type === "index") {
			indexSqlMap.set(String(row.name), String(row.sql));
		}
	}

	for (const row of masterResult.rows) {
		const name = String(row.name);
		const type = String(row.type);
		const sql = String(row.sql);

		if (type === "index") {
			continue;
		}
	}

		if (shouldSkip(name, options)) continue;

		if (type === "view") {
			views.push({ name, sql });
		} else if (type === "trigger") {
			triggers.push({ name, sql });
		} else if (type === "table") {
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

	await Promise.all(promises);

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

function shouldSkip(name: string, options: IntrospectOptions): boolean {
	if (
		!options.includeSystem &&
		(name.startsWith("sqlite_") ||
			name.startsWith("_litestream_") ||
			name.startsWith("_cf_"))
	) {
		return true;
	}

	if (options.excludeTables?.includes(name)) {
		return true;
	}

	if (
		options.tables &&
		options.tables.length > 0 &&
		!options.tables.includes(name)
	) {
		return true;
	}

	return false;
}
