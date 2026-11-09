import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { config, root } from './config.js';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS employees (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name  TEXT NOT NULL,
    birth_date TEXT NOT NULL,
    gender     TEXT NOT NULL CHECK (gender IN ('male', 'female', 'other')),
    street     TEXT,
    city       TEXT NOT NULL,
    zip        TEXT,
    department TEXT NOT NULL CHECK (department IN ('HR', 'R&D', 'Maintenance', 'Sales', 'Finance')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE UNIQUE INDEX IF NOT EXISTS employees_same_person
    ON employees (first_name COLLATE NOCASE, last_name COLLATE NOCASE, birth_date);
`;

function resolveTarget(path) {
  const configured = path ?? config.dbPath;
  return configured === ':memory:' ? configured : resolve(root, configured);
}

// Opens the database, creating and seeding it only when the employees table does not exist yet.
// The API uses this. The report uses openReportDb, which never writes.
export function openDb(path) {
  const target = resolveTarget(path);
  if (target !== ':memory:') mkdirSync(dirname(target), { recursive: true });

  const db = new DatabaseSync(target);
  db.exec('PRAGMA busy_timeout = 5000');
  // The write lock makes "seed on first creation" safe when two processes start together.
  db.exec('BEGIN IMMEDIATE');
  try {
    const existed = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'employees'").get() !== undefined;
    db.exec(SCHEMA);
    if (!existed) db.exec(readFileSync(resolve(root, 'docs/db/seed.sql'), 'utf8'));
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return db;
}

// Opens the database read-only for reporting. A missing file is an error when the path was chosen
// explicitly, and is provisioned only for the default path (a fresh clone).
export function openReportDb() {
  const target = resolveTarget();
  if (!existsSync(target)) {
    if (config.dbPathIsExplicit) throw new Error(`Database not found: ${target}`);
    openDb(target).close();
  }
  const db = new DatabaseSync(target, { readOnly: true });
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}
