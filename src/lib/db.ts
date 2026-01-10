import fs from "node:fs/promises";
import { homedir, platform } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type Client,
	createClient as createLibsqlClient,
} from "@libsql/client";
import { notFoundError } from "./errors.js";
import { withRetry } from "./retry.js";

export interface ConnectionConfig {
	database: string;
	org?: string;
	token?: string;
	retries?: number;
	retryDelayMs?: number;
}

export function resolveDatabaseUrl(database: string, org?: string): string {
	if (
		database.startsWith("file:") ||
		database.startsWith("libsql://") ||
		database.startsWith("http://") ||
		database.startsWith("https://")
	) {
		return database;
	}

	if (!org) {
		throw new Error(
			"Organization name is required when using a database name (use --org)",
		);
	}

	return `libsql://${database}-${org}.turso.io`;
}

function looksLikeLocalDatabasePath(input: string): boolean {
	if (
		input.startsWith("file:") ||
		/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)
	) {
		return false;
	}

	return (
		input === "~" ||
		input.startsWith("~/") ||
		input.startsWith("./") ||
		input.startsWith("../") ||
		input.startsWith("/") ||
		input.includes("/") ||
		input.includes("\\") ||
		/^[a-zA-Z]:[\\/]/.test(input) ||
		/\.(db|sqlite|sqlite3|db3)$/i.test(input)
	);
}

function expandHome(input: string): string {
	if (input === "~") return homedir();
	if (input.startsWith("~/")) return join(homedir(), input.slice(2));
	return input;
}

async function ensureLocalDbFileExists(path: string): Promise<void> {
	try {
		const stat = await fs.stat(path);
		if (!stat.isFile()) {
			throw notFoundError(`"${path}" is not a file.`);
		}
	} catch (error: unknown) {
		if (
			error &&
			typeof error === "object" &&
			"name" in error &&
			error.name === "CliError"
		) {
			throw error;
		}
		throw notFoundError(`Local database file not found: "${path}"`);
	}
}

function getTursoSettingsPath(): string {
	if (platform() === "darwin") {
		return join(homedir(), "Library/Application Support/turso/settings.json");
	}
	return join(homedir(), ".config/turso/settings.json");
}

async function getTursoPlatformToken(): Promise<string | undefined> {
	const settingsPath = getTursoSettingsPath();
	try {
		const content = await fs.readFile(settingsPath, "utf-8");
		const settings = JSON.parse(content);
		return settings.token;
	} catch {
		return undefined;
	}
}

function isPlatformToken(token: string): boolean {
	try {
		const [header] = token.split(".");
		if (!header) return false;
		const decoded = JSON.parse(Buffer.from(header, "base64url").toString());
		return decoded.alg === "RS256";
	} catch {
		return false;
	}
}

async function createDatabaseToken(
	platformToken: string,
	org: string,
	database: string,
): Promise<string> {
	const url = `https://api.turso.tech/v1/organizations/${org}/databases/${database}/auth/tokens`;
	const response = await fetch(url, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${platformToken}`,
			"Content-Type": "application/json",
		},
	});

	if (!response.ok) {
		const text = await response.text();
		throw new Error(
			`Failed to create database token: ${response.status} ${text}`,
		);
	}

	const data = (await response.json()) as { jwt: string };
	return data.jwt;
}

export async function getAuthToken(
	database: string,
	org: string | undefined,
	tokenFlag?: string,
): Promise<string | undefined> {
	// Priority: explicit flag > env var > platform token (converted to db token)
	if (tokenFlag) {
		if (isPlatformToken(tokenFlag) && org) {
			return createDatabaseToken(tokenFlag, org, database);
		}
		return tokenFlag;
	}

	if (process.env.TURSO_AUTH_TOKEN) {
		const envToken = process.env.TURSO_AUTH_TOKEN;
		if (isPlatformToken(envToken) && org) {
			return createDatabaseToken(envToken, org, database);
		}
		return envToken;
	}

	const platformToken = await getTursoPlatformToken();
	if (platformToken && org) {
		return createDatabaseToken(platformToken, org, database);
	}

	return undefined;
}

export async function createDbClient(
	config: ConnectionConfig,
): Promise<Client> {
	const retryOptions = {
		retries: config.retries ?? 3,
		baseDelayMs: config.retryDelayMs ?? 500,
	};

	let url: string;
	let authToken: string | undefined;

	if (looksLikeLocalDatabasePath(config.database)) {
		const expanded = expandHome(config.database);
		const fullPath = isAbsolute(expanded) ? expanded : resolve(expanded);
		await ensureLocalDbFileExists(fullPath);
		url = pathToFileURL(fullPath).toString();
	} else {
		url = resolveDatabaseUrl(config.database, config.org);
	}

	if (!url.startsWith("file:")) {
		authToken = await getAuthToken(config.database, config.org, config.token);
	}

	const client = createLibsqlClient({
		url,
		authToken,
	});

	// Use Proxy to automatically retry execute and batch methods
	return new Proxy(client, {
		get(target, prop, receiver) {
			if (prop === "execute" || prop === "batch") {
				const originalMethod = Reflect.get(target, prop, receiver) as (
					...args: unknown[]
				) => Promise<unknown>;
				return (...args: unknown[]) =>
					withRetry(() => originalMethod.apply(target, args), retryOptions);
			}
			return Reflect.get(target, prop, receiver);
		},
	});
}
