import fs from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import {
	type Client,
	createClient as createLibsqlClient,
} from "@libsql/client";

export interface ConnectionConfig {
	database: string;
	org?: string;
	token?: string;
}

export function resolveDatabaseUrl(database: string, org?: string): string {
	if (
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
		throw new Error(`Failed to create database token: ${response.status} ${text}`);
	}

	const data = await response.json() as { jwt: string };
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
	const url = resolveDatabaseUrl(config.database, config.org);
	const authToken = await getAuthToken(config.database, config.org, config.token);

	return createLibsqlClient({
		url,
		authToken,
	});
}
