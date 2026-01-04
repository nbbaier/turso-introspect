import fs from 'fs/promises';
import { existsSync } from 'fs';
import * as Diff from 'diff';
import chalk from 'chalk';
import { createDbClient } from '../lib/db.js';
import { introspectSchema } from '../lib/schema.js';
import { formatSql } from '../lib/formatter.js';

interface DiffOptions {
  diffFormat?: 'diff' | 'migration';
  org?: string;
  token?: string;
}

async function getSchemaSql(source: string, options: DiffOptions): Promise<string> {
  // Check if it's a file
  if (existsSync(source)) {
    // Basic check, might be a db name that happens to match a file? 
    // Usually db URLs contain protocols or are just names.
    // If it ends in .sql, it's definitely a file.
    // If it's a directory, error.
    try {
        const stats = await fs.stat(source);
        if (stats.isFile()) {
            return await fs.readFile(source, 'utf-8');
        }
    } catch {
        // ignore
    }
  }

  // Assume it's a database
  const client = createDbClient({
    database: source,
    org: options.org,
    token: options.token
  });

  try {
    const schema = await introspectSchema(client, source);
    return formatSql(schema);
  } finally {
    client.close();
  }
}

export async function diff(db1: string, db2: string, options: DiffOptions) {
  console.log(chalk.blue(`Comparing ${db1} and ${db2}...`));

  try {
    const [sql1, sql2] = await Promise.all([
      getSchemaSql(db1, options),
      getSchemaSql(db2, options)
    ]);

    if (options.diffFormat === 'migration') {
      console.warn(chalk.yellow('Warning: "migration" format is not fully implemented yet. Falling back to unified diff.'));
    }

    const patch = Diff.createTwoFilesPatch(db1, db2, sql1, sql2);
    
    // If no differences
    if (patch.includes('@@') === false) { 
       // createTwoFilesPatch usually returns a header. If no chunks, body is empty.
       // Actually let's check structured diff
       const diffs = Diff.diffLines(sql1, sql2);
       if (diffs.length === 1 && !diffs[0].added && !diffs[0].removed) {
         console.log(chalk.green('Schemas are identical.'));
         return;
       }
    }

    console.log(patch);

  } catch (error: any) {
    console.error(chalk.red('Error during diff:'), error.message);
    process.exit(1);
  }
}