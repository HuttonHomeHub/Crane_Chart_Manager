// Every crane query. A crane row owns one or more file rows; cranes.primary_file points at
// the one that opens by default, and when it is NULL (or stale) the earliest file is used.
import { join } from 'node:path';
import type { Crane, CraneFile, Counts } from '../shared/api.ts';
import { getDb } from './db.ts';
import { logger } from './logger.ts';
import { isoNow } from './names.ts';
import { uploadsDir } from './paths.ts';

export interface CraneRow {
  id: string;
  make: string;
  type: string;
  model: string;
  capacity: string;
  uploaded_at: string;
  updated_at: string | null;
  primary_file: number | null;
}

export interface FileRow {
  id: number;
  crane_id: string;
  stored_name: string;
  original_filename: string | null;
  label: string | null;
  uploaded_at: string;
}

/** uploads/<crane id>/ */
export function craneDir(craneId: string): string {
  return join(uploadsDir, craneId);
}

const byDate = (a: CraneFile, b: CraneFile) =>
  a.uploaded_at < b.uploaded_at ? -1 : a.uploaded_at > b.uploaded_at ? 1 : a.id - b.id;

/** The API shape: files with the primary resolved and listed first. */
export function craneFromRows(row: CraneRow, fileRows: FileRow[]): Crane {
  const files: CraneFile[] = fileRows.map((f) => ({
    id: f.id,
    crane_id: row.id,
    stored_name: f.stored_name,
    original_filename: f.original_filename || f.stored_name,
    label: f.label ?? '',
    uploaded_at: f.uploaded_at,
    url: `/uploads/${row.id}/${f.stored_name}`,
    is_primary: false,
  }));
  const primary =
    files.find((f) => f.id === row.primary_file) ?? [...files].sort(byDate)[0] ?? null;
  for (const f of files) f.is_primary = f.id === primary?.id;
  files.sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || byDate(a, b));
  return {
    id: row.id,
    name: row.id,
    make: row.make,
    type: row.type,
    model: row.model,
    capacity: row.capacity,
    uploaded_at: row.uploaded_at,
    updated_at: row.updated_at,
    files,
    primary_file_id: primary?.id ?? null,
    file_count: files.length,
    url: primary?.url ?? null,
    original_filename: primary?.original_filename ?? null,
  };
}

/** Every crane, sorted by id. */
export function listCranes(): Crane[] {
  const db = getDb();
  const cranes = db.prepare<[], CraneRow>('SELECT * FROM cranes ORDER BY id').all();
  const byCrane = new Map<string, FileRow[]>();
  for (const f of db.prepare<[], FileRow>('SELECT * FROM files').all()) {
    byCrane.set(f.crane_id, [...(byCrane.get(f.crane_id) ?? []), f]);
  }
  return cranes.map((c) => craneFromRows(c, byCrane.get(c.id) ?? []));
}

export function getCrane(id: string): Crane | undefined {
  const db = getDb();
  const row = db.prepare<[string], CraneRow>('SELECT * FROM cranes WHERE id = ?').get(id);
  if (!row) return undefined;
  const files = db.prepare<[string], FileRow>('SELECT * FROM files WHERE crane_id = ?').all(id);
  return craneFromRows(row, files);
}

export function facets(): { makes: string[]; types: string[] } {
  const db = getDb();
  const distinct = (column: 'make' | 'type') =>
    db
      .prepare<[], { v: string }>(
        `SELECT DISTINCT ${column} AS v FROM cranes WHERE ${column} <> '' ORDER BY ${column} COLLATE NOCASE`
      )
      .all()
      .map((r) => r.v);
  return { makes: distinct('make'), types: distinct('type') };
}

export function countRows(): Counts {
  const db = getDb();
  const count = (table: 'cranes' | 'files') =>
    db.prepare<[], { n: number }>(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0;
  return { cranes: count('cranes'), files: count('files') };
}

/** The compact snapshot the audit log keeps of a crane. */
export function auditSnapshot(crane: Crane | undefined) {
  if (!crane) return null;
  return {
    id: crane.id,
    make: crane.make,
    type: crane.type,
    model: crane.model,
    capacity: crane.capacity,
    files: crane.files.map((f) => ({
      label: f.label,
      stored_name: f.stored_name,
      is_primary: f.is_primary,
    })),
  };
}

/**
 * Appends to the audit log (spec_events: never updated, only added to). `subject` is the
 * crane id. A failure is logged, never thrown: the change it records has already happened.
 */
export function logEvent(type: string, subject: string, before: unknown, after: unknown): void {
  try {
    getDb()
      .prepare(
        `INSERT INTO spec_events (event_type, filename, occurred_at, snapshot_before, snapshot_after)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        type,
        subject,
        isoNow(),
        before === null ? null : JSON.stringify(before),
        after === null ? null : JSON.stringify(after)
      );
  } catch (err) {
    logger.error({ err, type, subject }, 'Could not write the audit log');
  }
}
