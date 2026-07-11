import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";

let dir: string;
let dbPath: string;

async function runCli(...args: string[]) {
	const proc = Bun.spawn(["bun", "run", "src/index.ts", ...args], {
		cwd: process.cwd(),
		stdout: "pipe",
		stderr: "pipe",
	});

	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);

	return { stdout, stderr, exitCode };
}

beforeAll(async () => {
	dir = await fs.mkdtemp(path.join(os.tmpdir(), "turso-introspect-cli-"));
	dbPath = path.join(dir, "fixture.db");
	const client = createClient({ url: `file:${dbPath}` });
	await client.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)");
	client.close();
});

afterAll(async () => {
	await fs.rm(dir, { recursive: true, force: true });
});

describe("CLI stdout/stderr stream separation", () => {
	test("--stdout -v keeps status logging off stdout", async () => {
		const { stdout, stderr, exitCode } = await runCli(dbPath, "--stdout", "-v");

		expect(exitCode).toBe(0);
		expect(stdout).toContain("CREATE TABLE t");
		expect(stdout).not.toContain("Found ");
		expect(stdout).not.toContain("Introspecting");
		expect(stderr).toContain("Found 1 tables");
	});

	test("--stdout -q suppresses stderr status output", async () => {
		const { stdout, stderr, exitCode } = await runCli(dbPath, "--stdout", "-q");

		expect(exitCode).toBe(0);
		expect(stderr.trim()).toBe("");
		expect(stdout).toContain("CREATE TABLE t");
	});
});
