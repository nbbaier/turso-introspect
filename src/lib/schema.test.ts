import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Client, createClient } from "@libsql/client";
import { formatSql } from "./formatter.js";
import { introspectSchema } from "./schema.js";

const FIXTURE_DDL = [
	"CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, created_at TEXT DEFAULT current_timestamp)",
	"CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), title TEXT)",
	"CREATE INDEX idx_posts_user ON posts (user_id)",
	"CREATE VIEW post_titles AS SELECT title FROM posts",
	"CREATE TRIGGER posts_touch AFTER UPDATE ON posts BEGIN SELECT 1; END",
];

describe("introspectSchema", () => {
	let client: Client;

	beforeEach(async () => {
		client = createClient({ url: ":memory:" });
		await client.batch(FIXTURE_DDL, "write");
	});

	afterEach(() => {
		client.close();
	});

	test("returns only the user-defined tables, sorted by name", async () => {
		const schema = await introspectSchema(client, "test-db");

		expect(schema.tables.map((t) => t.name)).toEqual(["posts", "users"]);
		expect(schema.tables.some((t) => t.name.startsWith("sqlite_"))).toBe(false);
	});

	test("introspects column metadata", async () => {
		const schema = await introspectSchema(client, "test-db");
		const users = schema.tables.find((t) => t.name === "users");
		expect(users).toBeDefined();

		const email = users?.columns.find((c) => c.name === "email");
		expect(email?.notnull).toBe(1);
		expect(email?.type).toBe("TEXT");

		const id = users?.columns.find((c) => c.name === "id");
		expect(id?.pk).toBe(1);
	});

	test("introspects foreign keys", async () => {
		const schema = await introspectSchema(client, "test-db");
		const posts = schema.tables.find((t) => t.name === "posts");
		expect(posts?.foreignKeys).toHaveLength(1);
		expect(posts?.foreignKeys[0]).toMatchObject({
			table: "users",
			from: "user_id",
			to: "id",
		});
	});

	test("introspects explicitly created indexes", async () => {
		const schema = await introspectSchema(client, "test-db");
		const posts = schema.tables.find((t) => t.name === "posts");
		const idx = posts?.indexes.find((i) => i.name === "idx_posts_user");

		expect(idx).toBeDefined();
		expect(idx?.origin).toBe("c");
		expect(idx?.columns).toEqual(["user_id"]);
		expect(idx?.sql).toBeDefined();
		expect(idx?.sql?.startsWith("CREATE INDEX")).toBe(true);
	});

	test("introspects views and triggers", async () => {
		const schema = await introspectSchema(client, "test-db");

		expect(schema.views.map((v) => v.name)).toContain("post_titles");
		expect(schema.triggers.map((t) => t.name)).toContain("posts_touch");
	});

	test("falls back to sequential introspection when pragma table-valued functions are unavailable", async () => {
		const fallbackClient = new Proxy(client, {
			get(target, property, receiver) {
				if (property === "execute") {
					return (statement: Parameters<Client["execute"]>[0]) => {
						const sql = String(statement);
						if (sql.includes("pragma_table_info")) {
							return Promise.reject(
								new Error("no such table: pragma_table_info"),
							);
						}
						return target.execute(statement);
					};
				}
				return Reflect.get(target, property, receiver);
			},
		});

		const schema = await introspectSchema(fallbackClient, "test-db");

		expect(schema.tables.map((table) => table.name)).toEqual([
			"posts",
			"users",
		]);
		expect(schema.tables.find((table) => table.name === "posts")).toMatchObject(
			{
				foreignKeys: [{ table: "users", from: "user_id", to: "id" }],
				indexes: [{ name: "idx_posts_user", columns: ["user_id"] }],
			},
		);
		expect(schema.views.map((view) => view.name)).toEqual(["post_titles"]);
		expect(schema.triggers.map((trigger) => trigger.name)).toEqual([
			"posts_touch",
		]);
	});

	test("propagates non-compatibility batch errors without sequential fallback", async () => {
		const networkError = new Error("network timeout");
		let sequentialQueries = 0;
		const failingClient = new Proxy(client, {
			get(target, property, receiver) {
				if (property === "execute") {
					return (statement: Parameters<Client["execute"]>[0]) => {
						const sql = String(statement);
						if (sql.includes("pragma_table_info")) {
							return Promise.reject(networkError);
						}
						if (sql.includes("PRAGMA table_info")) {
							sequentialQueries += 1;
						}
						return target.execute(statement);
					};
				}
				return Reflect.get(target, property, receiver);
			},
		});

		await expect(introspectSchema(failingClient, "test-db")).rejects.toBe(
			networkError,
		);
		expect(sequentialQueries).toBe(0);
	});

	test("formatSql emits tables in FK dependency order end-to-end", async () => {
		const schema = await introspectSchema(client, "test-db");
		const output = formatSql(schema);

		const usersIdx = output.indexOf("CREATE TABLE users");
		const postsIdx = output.indexOf("CREATE TABLE posts");
		expect(usersIdx).toBeGreaterThanOrEqual(0);
		expect(postsIdx).toBeGreaterThanOrEqual(0);
		expect(usersIdx).toBeLessThan(postsIdx);
	});
});

describe("introspectSchema filtering (tables only)", () => {
	let client: Client;

	beforeEach(async () => {
		client = createClient({ url: ":memory:" });
		await client.batch(
			[
				"CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)",
				"CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id INTEGER)",
			],
			"write",
		);
	});

	afterEach(() => {
		client.close();
	});

	test("options.tables limits results to the listed tables", async () => {
		const schema = await introspectSchema(client, "test-db", {
			tables: ["users"],
		});

		expect(schema.tables.map((t) => t.name)).toEqual(["users"]);
	});

	test("options.excludeTables removes the listed tables", async () => {
		const schema = await introspectSchema(client, "test-db", {
			excludeTables: ["posts"],
		});

		expect(schema.tables.map((t) => t.name)).toEqual(["users"]);
	});
});

describe("introspectSchema filtering (views and triggers)", () => {
	let client: Client;

	beforeEach(async () => {
		client = createClient({ url: ":memory:" });
		await client.batch(
			[
				"CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT)",
				"CREATE TABLE logs (id INTEGER PRIMARY KEY, message TEXT)",
				"CREATE TRIGGER users_touch AFTER UPDATE ON users BEGIN SELECT 1; END",
				"CREATE TRIGGER logs_touch AFTER UPDATE ON logs BEGIN SELECT 1; END",
				"CREATE VIEW user_names AS SELECT email FROM users",
				"CREATE TRIGGER user_names_write INSTEAD OF INSERT ON user_names BEGIN SELECT 1; END",
			],
			"write",
		);
	});

	afterEach(() => {
		client.close();
	});

	test("options.tables allow-list keeps triggers on the allowed table and drops the rest, but keeps all views", async () => {
		const schema = await introspectSchema(client, "test-db", {
			tables: ["users"],
		});

		expect(schema.tables.map((t) => t.name)).toEqual(["users"]);
		expect(schema.triggers.map((t) => t.name).sort()).toEqual([
			"user_names_write",
			"users_touch",
		]);
		expect(schema.views.map((v) => v.name)).toEqual(["user_names"]);
	});

	test("options.excludeTables drops triggers on the excluded table but keeps views", async () => {
		const schema = await introspectSchema(client, "test-db", {
			excludeTables: ["logs"],
		});

		expect(schema.tables.map((t) => t.name)).toEqual(["users"]);
		expect(schema.triggers.map((t) => t.name).sort()).toEqual([
			"user_names_write",
			"users_touch",
		]);
		expect(schema.views.map((v) => v.name)).toEqual(["user_names"]);
	});

	test("options.excludeTables on a view drops the view and its INSTEAD OF triggers", async () => {
		const schema = await introspectSchema(client, "test-db", {
			excludeTables: ["user_names"],
		});

		expect(schema.tables.map((t) => t.name).sort()).toEqual(["logs", "users"]);
		expect(schema.triggers.map((t) => t.name).sort()).toEqual([
			"logs_touch",
			"users_touch",
		]);
		expect(schema.views.map((v) => v.name)).toEqual([]);
	});

	test("default options include all tables, triggers, and views", async () => {
		const schema = await introspectSchema(client, "test-db");

		expect(schema.tables.map((t) => t.name).sort()).toEqual(["logs", "users"]);
		expect(schema.triggers.map((t) => t.name).sort()).toEqual([
			"logs_touch",
			"user_names_write",
			"users_touch",
		]);
		expect(schema.views.map((v) => v.name)).toEqual(["user_names"]);
	});

	test("a view referencing an excluded table is still emitted", async () => {
		const schema = await introspectSchema(client, "test-db", {
			excludeTables: ["users"],
		});

		expect(schema.tables.map((t) => t.name)).toEqual(["logs"]);
		expect(schema.views.map((v) => v.name)).toEqual(["user_names"]);
		expect(schema.triggers.map((t) => t.name).sort()).toEqual([
			"logs_touch",
			"user_names_write",
		]);
	});
});

describe("introspectSchema system table filtering", () => {
	let client: Client;

	beforeEach(async () => {
		client = createClient({ url: ":memory:" });
		await client.batch(
			[
				"CREATE TABLE users (id INTEGER PRIMARY KEY)",
				"CREATE TABLE _cf_internal (id INTEGER PRIMARY KEY)",
				"CREATE TRIGGER cf_touch AFTER UPDATE ON _cf_internal BEGIN SELECT 1; END",
			],
			"write",
		);
	});

	afterEach(() => {
		client.close();
	});

	test("excludes _cf_ prefixed tables by default", async () => {
		const schema = await introspectSchema(client, "test-db");
		expect(schema.tables.map((t) => t.name)).not.toContain("_cf_internal");
	});

	test("includes _cf_ prefixed tables when includeSystem is set", async () => {
		const schema = await introspectSchema(client, "test-db", {
			includeSystem: true,
		});
		expect(schema.tables.map((t) => t.name)).toContain("_cf_internal");
	});

	test("excludes triggers on system-prefixed tables by default, even when the trigger name has no system prefix", async () => {
		const schema = await introspectSchema(client, "test-db");

		expect(schema.tables.map((t) => t.name)).not.toContain("_cf_internal");
		expect(schema.triggers.map((t) => t.name)).not.toContain("cf_touch");
	});

	test("includes triggers on system-prefixed tables when includeSystem is set", async () => {
		const schema = await introspectSchema(client, "test-db", {
			includeSystem: true,
		});

		expect(schema.tables.map((t) => t.name)).toContain("_cf_internal");
		expect(schema.triggers.map((t) => t.name)).toContain("cf_touch");
	});
});
