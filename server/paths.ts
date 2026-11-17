import { dirname, join, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveDataPaths } from '@hhh/server';
import { config } from './config.ts';

// Data locations, to the shared container standard. DATA_DIR holds all state; the image
// sets it to /config. DB_PATH and UPLOADS_DIR default to crane.db and uploads/ inside it,
// and BACKUP_DIR to backups/ beside the database. Outside a container (no DATA_DIR) they
// live in the working directory, as the Python app did.
const paths = resolveDataPaths(
  { DATA_DIR: config.dataDir, DB_PATH: config.dbPath, UPLOADS_DIR: config.uploadsDir },
  { dbFile: 'crane.db', fallbackDir: '.', join }
);

export const dataDir = resolve(paths.dataDir);
export const dbPath = resolve(paths.dbPath);
export const uploadsDir = resolve(paths.uploadsDir);
export const backupDir = resolve(config.backup.dir ?? join(dirname(dbPath), 'backups'));
// The built front end (npm run build).
export const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
// Numbered SQL migrations (NNN-name.sql), run by the shared kit.
export const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

mkdirSync(uploadsDir, { recursive: true });
