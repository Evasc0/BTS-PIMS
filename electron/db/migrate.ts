import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';

const MIGRATION_REGEX = /^(\d+)_.*\.sql$/u;

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set<number>(
    db.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version as number)
  );

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .map((file) => ({
      file,
      match: file.match(MIGRATION_REGEX)
    }))
    .filter((entry) => entry.match)
    .map((entry) => ({
      file: entry.file,
      version: Number(entry.match?.[1])
    }))
    .sort((a, b) => a.version - b.version);

  for (const migration of files) {
    if (applied.has(migration.version)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, migration.file), 'utf8');
    db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
      migration.version,
      new Date().toISOString()
    );
  }
}
