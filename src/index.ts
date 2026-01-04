import { Command } from 'commander';
import chalk from 'chalk';
import { introspect } from './commands/introspect.js';
import { diff } from './commands/diff.js';
import { CliError } from './lib/errors.js';
import pkg from '../package.json';

const program = new Command();

program
  .name('turso-introspect')
  .description('Introspect the database schema of a Turso/libsql database')
  .version(pkg.version)
  .argument('[database]', 'Database URL (libsql://...) or name')
  .option('--org <name>', 'Organization name (required when using db name)')
  .option('--token <token>', 'Authentication token (overrides TURSO_AUTH_TOKEN)')
  .option('-o, --output <path>', 'Output file path (default: {db}-schema.{sql|json})')
  .option('--stdout', 'Write to stdout instead of file')
  .option('--format <type>', 'Output format: sql (default) or json', 'sql')
  .option('--tables <list>', 'Comma-separated list of tables to include')
  .option('--exclude-tables <list>', 'Comma-separated list of tables to exclude')
  .option('--include-system', 'Include SQLite/libsql system tables')
  .option('--normalize-defaults', 'Normalize common DEFAULT expressions')
  .option('--check', 'Validate connection without producing output')
  .option('-q, --quiet', 'Suppress warnings and informational output')
  .option('-v, --verbose', 'Show detailed progress information')
  .action(async (database, options) => {
    try {
      await introspect(database, options);
    } catch (error: any) {
      if (error instanceof CliError) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(error.code);
      }
      console.error(chalk.red('Error:'), error?.message ?? error);
      process.exit(1);
    }
  });

program
  .command('diff')
  .description('Compare schemas between two sources')
  .argument('<db1>', 'First database source')
  .argument('<db2>', 'Second database source')
  .option('--diff-format <type>', 'Output format: diff (default) or migration', 'diff')
  .option('--org <name>', 'Organization (when using db names)')
  .option('--token <token>', 'Authentication token')
  .option('-q, --quiet', 'Suppress warnings and informational output')
  .option('-v, --verbose', 'Show detailed progress information')
  .action(async (db1, db2, options) => {
    try {
      await diff(db1, db2, options);
    } catch (error: any) {
      if (error instanceof CliError) {
        console.error(chalk.red('Error:'), error.message);
        process.exit(error.code);
      }
      console.error(chalk.red('Error:'), error?.message ?? error);
      process.exit(1);
    }
  });

program.parse();
