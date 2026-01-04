import type { Client } from '@libsql/client';
import { quoteIdent } from './utils.js';

export interface Column {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export interface ForeignKey {
  id: number;
  seq: number;
  table: string;
  from: string;
  to: string;
  on_update: string;
  on_delete: string;
  match: string;
}

export interface IndexInfo {
  seqno: number;
  cid: number;
  name: string;
}

export interface Index {
  name: string;
  unique: boolean;
  origin: string;
  partial: boolean;
  columns: string[];
  sql?: string; 
}

export interface Table {
  name: string;
  sql: string;
  columns: Column[];
  foreignKeys: ForeignKey[];
  indexes: Index[];
}

export interface View {
  name: string;
  sql: string;
}

export interface Trigger {
  name: string;
  sql: string;
}

export interface Schema {
  metadata: {
    database: string;
    timestamp: string;
    version: string;
  };
  tables: Table[];
  views: View[];
  triggers: Trigger[];
}

export interface IntrospectOptions {
  tables?: string[];
  excludeTables?: string[];
  includeSystem?: boolean;
}

export async function introspectSchema(client: Client, dbName: string, options: IntrospectOptions = {}): Promise<Schema> {
  const tables: Table[] = [];
  const views: View[] = [];
  const triggers: Trigger[] = [];

  // Get master table entries
  const masterResult = await client.execute("SELECT type, name, sql, tbl_name FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name");
  
  const tablesToProcess: string[] = [];
  const viewsToProcess: {name: string, sql: string}[] = [];
  const triggersToProcess: {name: string, sql: string}[] = [];

  for (const row of masterResult.rows) {
    const type = row.type as string;
    const name = row.name as string;
    const sql = row.sql as string;

    if (shouldSkip(name, options)) continue;

    if (type === 'table') {
      tablesToProcess.push(name);
    } else if (type === 'view') {
      viewsToProcess.push({ name, sql });
    } else if (type === 'trigger') {
      triggersToProcess.push({ name, sql });
    }
  }

  // Process tables
  for (const tableName of tablesToProcess) {
    // Get table SQL
    const sqlRes = await client.execute({
      sql: "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
      args: [tableName]
    });
    const tableSql = sqlRes.rows[0]?.sql as string || '';

    // Get columns
    const columnsRes = await client.execute(`PRAGMA table_info(${quoteIdent(tableName)})`);
    const columns: Column[] = columnsRes.rows.map(r => ({
      cid: Number(r.cid),
      name: String(r.name),
      type: String(r.type),
      notnull: Number(r.notnull),
      dflt_value: r.dflt_value as string | null,
      pk: Number(r.pk)
    }));

    // Get foreign keys
    const fkRes = await client.execute(`PRAGMA foreign_key_list(${quoteIdent(tableName)})`);
    const foreignKeys: ForeignKey[] = fkRes.rows.map(r => ({
      id: Number(r.id),
      seq: Number(r.seq),
      table: String(r.table),
      from: String(r.from),
      to: String(r.to),
      on_update: String(r.on_update),
      on_delete: String(r.on_delete),
      match: String(r.match)
    }));

    // Get indexes
    const idxListRes = await client.execute(`PRAGMA index_list(${quoteIdent(tableName)})`);
    const indexes: Index[] = [];
    
    for (const idxRow of idxListRes.rows) {
      const idxName = String(idxRow.name);
      const origin = String(idxRow.origin);
      
      // Skip internal indexes (pk, unique constraints defined in table) usually handled by CREATE TABLE
      // But we might want them if we are reconstructing.
      // However, usually explicitly created indexes (origin 'c') are what we want to dump separately?
      // Or maybe we want all of them for analysis.
      // For SQL generation, we usually only want those NOT created by constraints.
      
      // sqlite_master also has index definitions.
      // If we use the SQL from sqlite_master for the table, it includes inline constraints.
      // We should check if the index exists in sqlite_master with SQL.
      
      const idxSqlRes = await client.execute({
        sql: "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?",
        args: [idxName]
      });
      
      const idxSql = idxSqlRes.rows[0]?.sql as string | undefined;

      const idxInfoRes = await client.execute(`PRAGMA index_info(${quoteIdent(idxName)})`);
      const idxColumns = idxInfoRes.rows.map(r => String(r.name));

      indexes.push({
        name: idxName,
        unique: Boolean(idxRow.unique),
        origin: origin,
        partial: Boolean(idxRow.partial),
        columns: idxColumns,
        sql: idxSql
      });
    }

    tables.push({
      name: tableName,
      sql: tableSql,
      columns,
      foreignKeys,
      indexes
    });
  }

  // Process views
  for (const v of viewsToProcess) {
    views.push(v);
  }

  // Process triggers
  for (const t of triggersToProcess) {
    triggers.push(t);
  }

  return {
    metadata: {
      database: dbName,
      timestamp: new Date().toISOString(),
      version: '1.0.0' // CLI version, maybe import from package.json
    },
    tables,
    views,
    triggers
  };
}

function shouldSkip(name: string, options: IntrospectOptions): boolean {
  // System tables
  if (!options.includeSystem) {
    if (name.startsWith('sqlite_') || name.startsWith('_litestream_') || name.startsWith('_cf_')) {
      return true;
    }
  }

  // Exclude list
  if (options.excludeTables?.includes(name)) {
    return true;
  }

  // Include list (if specified, must be in it)
  if (options.tables && options.tables.length > 0) {
    if (!options.tables.includes(name)) {
      return true;
    }
  }

  return false;
}
