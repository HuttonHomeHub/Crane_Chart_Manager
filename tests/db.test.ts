import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type * as DbModule from '../server/db.ts';

const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** server/db.ts opened against a database file in a fresh folder. */
async function openAt(prepare?: (dbPath: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'crane-db-'));
  dirs.push(dir);
  const dbPath = join(dir, 'crane.db');
  prepare?.(dbPath);
  vi.resetModules();
  process.env.DATA_DIR = dir;
  process.env.DB_PATH = dbPath;
  const mod: typeof DbModule = await import('../server/db.ts');
  return { mod, dir, dbPath, db: mod.openDb() };
}

// The schema exactly as the Python app's init_db() created it.
function pythonSchema(dbPath: string) {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE cranes (id TEXT PRIMARY KEY, make TEXT NOT NULL, type TEXT NOT NULL,
      model TEXT NOT NULL, capacity TEXT NOT NULL, uploaded_at TEXT NOT NULL,
      updated_at TEXT, primary_file INTEGER);
    CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, crane_id TEXT NOT NULL,
      stored_name TEXT NOT NULL, original_filename TEXT, label TEXT,
      uploaded_at TEXT NOT NULL, UNIQUE(crane_id, stored_name));
    CREATE INDEX idx_files_crane ON files(crane_id);
    CREATE TABLE spec_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL,
      filename TEXT NOT NULL, occurred_at TEXT NOT NULL, snapshot_before TEXT,
      snapshot_after TEXT);
    INSERT INTO cranes VALUES ('liebherr_mobile_ltm1100_100t', 'Liebherr', 'Mobile',
      'LTM1100', '100t', '2026-01-01T00:00:00', NULL, 1);
    INSERT INTO files (crane_id, stored_name, original_filename, label, uploaded_at)
      VALUES ('liebherr_mobile_ltm1100_100t', 'chart.pdf', 'Chart.pdf', '', '2026-01-01T00:00:00');
  `);
  db.close();
}

describe('database', () => {
  it('creates the schema in a new database and records the baseline', async () => {
    const { db, mod } = await openAt();
    const tables = db
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['cranes', 'files', 'spec_events']));
    const applied = db
      .prepare<[], { name: string; checksum: string }>(
        'SELECT name, checksum FROM schema_migrations'
      )
      .all();
    expect(applied.map((r) => r.name)).toEqual(['001-baseline.sql']);
    expect(applied[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(() => mod.pingDb()).not.toThrow();
    mod.closeDb();
  });

  it('opens a Python (1.x) database unchanged, after a safety copy', async () => {
    const { db, mod, dir } = await openAt(pythonSchema);
    const crane = db
      .prepare<[], { make: string; primary_file: number }>('SELECT make, primary_file FROM cranes')
      .get();
    expect(crane).toEqual({ make: 'Liebherr', primary_file: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM files').get()).toEqual({ n: 1 });
    const { readdirSync } = await import('node:fs');
    expect(readdirSync(join(dir, 'backups')).some((f) => f.startsWith('premigrate-'))).toBe(true);
    mod.closeDb();

    // The Python app can still open it: its own CREATE IF NOT EXISTS statements work.
    const again = new Database(join(dir, 'crane.db'));
    expect(() =>
      again.exec('CREATE TABLE IF NOT EXISTS cranes (id TEXT PRIMARY KEY)')
    ).not.toThrow();
    again.close();
  });

  it('opens an already migrated database without migrating again', async () => {
    const first = await openAt();
    first.mod.closeDb();
    vi.resetModules();
    const mod: typeof DbModule = await import('../server/db.ts');
    const db = mod.openDb();
    expect(db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()).toEqual({ n: 1 });
    mod.closeDb();
  });
});
