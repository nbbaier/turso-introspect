import { createClient as createLibsqlClient, type Client } from '@libsql/client';

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

export function getAuthToken(tokenFlag?: string): string | undefined {
  return tokenFlag || process.env.TURSO_AUTH_TOKEN;
}

export function createDbClient(config: ConnectionConfig): Client {
  const url = resolveDatabaseUrl(config.database, config.org);
  const authToken = getAuthToken(config.token);

  return createLibsqlClient({
    url,
    authToken,
  });
}
