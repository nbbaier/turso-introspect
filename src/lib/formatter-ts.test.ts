import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	formatTypescript,
	sqliteTypeToTs,
	toInterfaceName,
} from "./formatter-ts.js";
import type { Schema } from "./schema.js";

function expectTypescriptCompiles(output: string): void {
	const directory = mkdtempSync(join(tmpdir(), "turso-introspect-types-"));
	const outputPath = join(directory, "schema.ts");
	try {
		writeFileSync(outputPath, output);
		const result = Bun.spawnSync(
			["bunx", "tsc", "--noEmit", "--strict", "--ignoreConfig", outputPath],
			{ timeout: 15_000 },
		);
		expect(result.exitCode).toBe(0);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}

describe("sqliteTypeToTs", () => {
	test.each([
		["INTEGER", "number"],
		["varchar(80)", "string"],
		["BLOB", "Uint8Array"],
		["", "Uint8Array"],
		["REAL", "number"],
		["BOOLEAN", "number | string"],
		["FLOATING POINT", "number"],
	])("maps SQLite declared type %s using affinity rules", (type, expected) => {
		expect(sqliteTypeToTs(type)).toBe(expected);
	});
});

describe("toInterfaceName", () => {
	test.each([
		["users", "Users"],
		["user_posts", "UserPosts"],
		["USER_POSTS", "UserPosts"],
		["2fa_codes", "T2faCodes"],
		["-", "Table"],
	])("converts table name %s to %s", (tableName, expected) => {
		expect(toInterfaceName(tableName)).toBe(expected);
	});
});

describe("formatTypescript", () => {
	test("formats tables, nullability, quoted names, and compiling output", () => {
		const schema: Schema = {
			metadata: {
				database: "test.db",
				timestamp: "2026-01-01T00:00:00.000Z",
				version: "1.0.0",
			},
			tables: [
				{
					name: "users",
					sql: "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)",
					columns: [
						{
							cid: 0,
							name: "id",
							type: "INTEGER",
							notnull: 0,
							dflt_value: null,
							pk: 1,
						},
						{
							cid: 1,
							name: "email address",
							type: "TEXT",
							notnull: 0,
							dflt_value: null,
							pk: 0,
						},
					],
					foreignKeys: [],
					indexes: [],
				},
				{
					name: "audit-log",
					sql: "CREATE TABLE audit_log (event BLOB NOT NULL)",
					columns: [
						{
							cid: 0,
							name: "event",
							type: "BLOB",
							notnull: 1,
							dflt_value: null,
							pk: 0,
						},
					],
					foreignKeys: [],
					indexes: [],
				},
				{
					name: "a-b",
					sql: 'CREATE TABLE "a-b" (id INTEGER PRIMARY KEY)',
					columns: [],
					foreignKeys: [],
					indexes: [],
				},
				{
					name: "a_b",
					sql: "CREATE TABLE a_b (id INTEGER PRIMARY KEY)",
					columns: [],
					foreignKeys: [],
					indexes: [],
				},
				{
					name: "-",
					sql: 'CREATE TABLE "-" (id INTEGER PRIMARY KEY)',
					columns: [],
					foreignKeys: [],
					indexes: [],
				},
				{
					name: "tables",
					sql: "CREATE TABLE tables (id INTEGER PRIMARY KEY)",
					columns: [],
					foreignKeys: [],
					indexes: [],
				},
				{
					name: "uint8_array",
					sql: "CREATE TABLE uint8_array (payload BLOB NOT NULL)",
					columns: [
						{
							cid: 0,
							name: "payload",
							type: "BLOB",
							notnull: 1,
							dflt_value: null,
							pk: 0,
						},
					],
					foreignKeys: [],
					indexes: [],
				},
			],
			views: [],
			triggers: [],
		};

		const output = formatTypescript(schema);

		expect(output).toContain("id: number;");
		expect(output).toContain('"email address": string | null;');
		expect(output).toContain('"audit-log": AuditLog;');
		expect(output).toContain("export interface AB {");
		expect(output).toContain("export interface ABRow {");
		expect(output).toContain('"-": Table;');
		expect(output).not.toContain("export interface  {");
		expect(output).toContain("export interface TablesRow {");
		expect(output).toContain("\ttables: TablesRow;");
		expect(output).toContain("export interface Uint8ArrayRow {");
		expect(output).toContain("\tpayload: Uint8Array;");

		expectTypescriptCompiles(output);
	}, 15_000);

	test("marks virtual table interfaces", () => {
		const schema: Schema = {
			metadata: { database: "test", timestamp: "now", version: "1" },
			tables: [
				{
					name: "search",
					sql: "CREATE VIRTUAL TABLE search USING fts5(content)",
					columns: [],
					foreignKeys: [],
					indexes: [],
				},
			],
			views: [],
			triggers: [],
		};

		expect(formatTypescript(schema)).toContain(
			"export interface Search { // virtual table (FTS5/R-tree)",
		);
	});
});
