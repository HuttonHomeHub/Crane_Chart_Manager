import type Database from 'better-sqlite3';
import { openDatabase, runMigrations } from '@hhh/server';
import { logger } from './logger.ts';
import { backupDir, dbPath, migrationsDir } from './paths.ts';

type Db = Database.Database;

// The live handle. It is replaced when a backup is restored (closeDb, then openDb).
let db: Db | undefined;

/** Opens the database (WAL, foreign keys, busy timeout) and brings its schema up to date. */
export function openDb(): Db {
  const opened = openDatabase(dbPath);
  runMigrations(opened, { dir: migrationsDir, backupDir, logger });
  db = opened;
  return opened;
}

/** The live handle (opened on first use). */
export function getDb(): Db {
  return db ?? openDb();
}

export function closeDb(): void {
  db?.close();
  db = undefined;
}

/** For /ready: throws if the database can't answer. */
export function pingDb(): void {
  getDb().prepare('SELECT 1').get();
}
