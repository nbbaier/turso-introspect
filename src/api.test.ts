import { expect, test } from "bun:test";
import { createClient } from "@libsql/client";
import { createDbClient, formatSql, introspectSchema } from "./api.js";

test("public API introspects and formats a schema", async () => {
	const client = createClient({ url: ":memory:" });

	try {
		await client.execute("CREATE TABLE users (id INTEGER PRIMARY KEY)");
		const schema = await introspectSchema(client, "test-db");

		expect(formatSql(schema)).toContain("CREATE TABLE users");
		expect(createDbClient).toBeFunction();
	} finally {
		client.close();
	}
});
