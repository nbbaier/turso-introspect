import { describe, expect, test } from "bun:test";
import { formatJson, formatSql } from "./formatter.js";
import type { ForeignKey, Index, Schema, Table } from "./schema.js";

function makeFk(table: string): ForeignKey {
	return {
		id: 0,
		seq: 0,
		table,
		from: "parent_id",
		to: "id",
		on_update: "NO ACTION",
		on_delete: "NO ACTION",
		match: "NONE",
	};
}

function makeTable(overrides: Partial<Table> & { name: string }): Table {
	return {
		sql: `CREATE TABLE ${overrides.name} (id INTEGER PRIMARY KEY)`,
		columns: [],
		foreignKeys: [],
		indexes: [],
		...overrides,
	};
}

function makeSchema(tables: Table[], extra: Partial<Schema> = {}): Schema {
	return {
		metadata: {
			database: "test",
			timestamp: "2026-01-01T00:00:00.000Z",
			version: "1.0.0",
		},
		tables,
		views: [],
		triggers: [],
		...extra,
	};
}

describe("formatSql", () => {
	test("orders tables topologically by foreign key dependency", () => {
		const child = makeTable({
			name: "child",
			sql: "CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER)",
			foreignKeys: [makeFk("parent")],
		});
		const parent = makeTable({ name: "parent" });

		const output = formatSql(makeSchema([child, parent]));

		const parentIdx = output.indexOf("CREATE TABLE parent");
		const childIdx = output.indexOf("CREATE TABLE child");
		expect(parentIdx).toBeGreaterThanOrEqual(0);
		expect(childIdx).toBeGreaterThanOrEqual(0);
		expect(parentIdx).toBeLessThan(childIdx);
	});

	test("tolerates circular foreign key dependencies", () => {
		const a = makeTable({
			name: "a",
			sql: "CREATE TABLE a (id INTEGER PRIMARY KEY, b_id INTEGER)",
			foreignKeys: [makeFk("b")],
		});
		const b = makeTable({
			name: "b",
			sql: "CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER)",
			foreignKeys: [makeFk("a")],
		});

		const output = formatSql(makeSchema([a, b]));

		expect(output).toContain("CREATE TABLE a");
		expect(output).toContain("CREATE TABLE b");
	});

	test("emits virtual tables as comments", () => {
		const virtual = makeTable({
			name: "search_idx",
			sql: "CREATE VIRTUAL TABLE search_idx USING fts5(content)",
		});

		const output = formatSql(makeSchema([virtual]));

		expect(output).toContain(
			"-- Virtual table (not emitted as executable SQL):",
		);
		expect(output).toContain(
			"-- CREATE VIRTUAL TABLE search_idx USING fts5(content)",
		);
		expect(output).not.toMatch(/^CREATE VIRTUAL TABLE/m);
	});

	test("only emits explicitly created indexes (origin = c)", () => {
		const indexes: Index[] = [
			{
				name: "i1",
				origin: "c",
				sql: "CREATE INDEX i1 ON t (a)",
				unique: false,
				partial: false,
				columns: ["a"],
			},
			{
				name: "i2",
				origin: "pk",
				unique: true,
				partial: false,
				columns: ["id"],
			},
		];
		const table = makeTable({
			name: "t",
			sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, a TEXT)",
			indexes,
		});

		const output = formatSql(makeSchema([table]));

		expect(output).toContain("CREATE INDEX i1 ON t (a);");
		expect(output).not.toContain("i2");
	});

	test("normalizeDefaults leaves SQL unchanged by default", () => {
		const table = makeTable({
			name: "t",
			sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, created_at TEXT DEFAULT current_timestamp)",
		});

		const output = formatSql(makeSchema([table]));

		expect(output).toContain("DEFAULT current_timestamp");
	});

	test("normalizeDefaults uppercases current_timestamp/current_date/current_time", () => {
		const table = makeTable({
			name: "t",
			sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, created_at TEXT DEFAULT current_timestamp)",
		});

		const output = formatSql(makeSchema([table]), { normalizeDefaults: true });

		expect(output).toContain("DEFAULT CURRENT_TIMESTAMP");
		expect(output).not.toContain("DEFAULT current_timestamp");
	});

	test("normalizeDefaults handles the parenthesized form", () => {
		const table = makeTable({
			name: "t",
			sql: "CREATE TABLE t (id INTEGER PRIMARY KEY, created_at TEXT DEFAULT (current_timestamp))",
		});

		const output = formatSql(makeSchema([table]), { normalizeDefaults: true });

		expect(output).toContain("DEFAULT CURRENT_TIMESTAMP");
	});
});

describe("formatJson", () => {
	test("round-trips the schema object", () => {
		const table = makeTable({ name: "t" });
		const schema = makeSchema([table]);

		const parsed = JSON.parse(formatJson(schema));

		expect(parsed).toEqual(schema);
	});
});
