import { describe, expect, test } from "bun:test";
import { resolveDatabaseUrl } from "./db.js";

describe("resolveDatabaseUrl", () => {
	test.each([
		"libsql://x.turso.io",
		"file:./local.db",
		"http://localhost:8080",
		"https://x.turso.io",
	])("passes %s through unchanged", (url) => {
		expect(resolveDatabaseUrl(url)).toBe(url);
	});

	test("builds a libsql url from a database name and org", () => {
		expect(resolveDatabaseUrl("mydb", "myorg")).toBe(
			"libsql://mydb-myorg.turso.io",
		);
	});

	test("throws when no org is provided for a bare database name", () => {
		expect(() => resolveDatabaseUrl("mydb")).toThrow("--org");
	});
});
