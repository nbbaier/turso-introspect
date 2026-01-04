import fs from 'fs/promises';
import chalk from 'chalk';
import { createDbClient } from '../lib/db.js';
import { introspectSchema, type IntrospectOptions } from '../lib/schema.js';
import { formatSql, formatJson } from '../lib/formatter.js';

interface CommandOptions {
  org?: string;
  token?: string;
  output?: string;
  stdout?: boolean;
  format?: string;
  tables?: string;
  excludeTables?: string;
  includeSystem?: boolean;
  normalizeDefaults?: boolean;
  check?: boolean;
  quiet?: boolean;
  verbose?: boolean;
}

export async function introspect(database: string | undefined, options: CommandOptions) {
  if (!database) {
     console.error(chalk.red('Error: Database argument is required.'));
     process.exit(1);
  }

  const client = await createDbClient({
    database,
    org: options.org,
    token: options.token,
  });

  if (options.check) {
    try {
      await client.execute('SELECT 1');
      if (!options.quiet) console.log(chalk.green('Connection successful!'));
      return;
    } catch (e: any) {
      console.error(chalk.red('Connection failed:'), e.message);
      process.exit(1);
    }
  }

  if (!options.quiet && !options.stdout) {
    console.log(chalk.blue(`Introspecting ${database}...`));
  }

  const introspectOptions: IntrospectOptions = {
    tables: options.tables ? options.tables.split(',') : undefined,
    excludeTables: options.excludeTables ? options.excludeTables.split(',') : undefined,
    includeSystem: options.includeSystem,
  };

  try {
    const schema = await introspectSchema(client, database, introspectOptions);

    let output = '';
    if (options.format === 'json') {
      output = formatJson(schema);
    } else {
      output = formatSql(schema);
    }

    if (options.stdout) {
      console.log(output);
    } else {
      const defaultFilename = `${database.replace(/[^a-zA-Z0-9]/g, '_')}-schema.${options.format || 'sql'}`;
      const outputPath = options.output || defaultFilename;
      await fs.writeFile(outputPath, output);
      if (!options.quiet) {
        console.log(chalk.green(`Schema saved to ${outputPath}`));
      }
    }

  } catch (error: any) {
    console.error(chalk.red('Error during introspection:'), error.message);
    process.exit(1);
  } finally {
    client.close();
  }
}