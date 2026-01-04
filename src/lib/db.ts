import { createClient as createLibsqlClient, type Client } from '@libsql/client';
import { homedir, platform } from 'os';
import { join } from 'path';

export interface ConnectionConfig {
  database: string;
  org?: string;
  token?: string;
}

export function resolveDatabaseUrl(database: string, org?: string): string {
  if (database.startsWith('libsql://') || database.startsWith('http://') || database.startsWith('https://')) {
    return database;
  }

  if (!org) {
    throw new Error('Organization name is required when using a database name (use --org)');
  }

  return `libsql://${database}-${org}.turso.io`;
}

function getTursoSettingsPath(): string {
  if (platform() === 'darwin') {
    return join(homedir(), 'Library/Application Support/turso/settings.json');
  }
  return join(homedir(), '.config/turso/settings.json');
}

async function getTursoCliToken(): Promise<string | undefined> {
  const settingsPath = getTursoSettingsPath();
  const file = Bun.file(settingsPath);
  if (await file.exists()) {
    try {
      const settings = await file.json();
      return settings.token;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export async function getAuthToken(tokenFlag?: string): Promise<string | undefined> {
  return tokenFlag || process.env.TURSO_AUTH_TOKEN || await getTursoCliToken();
}

export async function createDbClient(config: ConnectionConfig): Promise<Client> {
  const url = resolveDatabaseUrl(config.database, config.org);
  const authToken = await getAuthToken(config.token);

  return createLibsqlClient({
    url,
    authToken,
  });
}
