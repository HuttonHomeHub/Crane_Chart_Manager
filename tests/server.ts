// Starts the real app on a fresh data folder, for the API tests, and the helpers they share.
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import request, { type Test } from 'supertest';
import { vi } from 'vitest';
import type { Crane } from '../shared/api.ts';
import type * as CranesModule from '../server/cranes.ts';
import type * as DbModule from '../server/db.ts';
import type * as BackupServiceModule from '../server/services/backups.ts';

export const CSRF_TOKEN = 'test-csrf-token';

// A one-page PDF, the same bytes the 1.x tests used.
export const TINY_PDF = Buffer.from(
  '%PDF-1.4\n' +
    '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n' +
    '2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Resources<<>>/Contents 4 0 R>>endobj\n' +
    '4 0 obj<</Length 23>>stream\nBT /F1 12 Tf 30 100 Td (hi) Tj ET\nendstream endobj\n' +
    'xref\n0 5\n0000000000 65535 f \n0000000010 00000 n \n0000000053 00000 n \n' +
    '0000000098 00000 n \n0000000171 00000 n \n' +
    'trailer<</Size 5/Root 1 0 R>>\nstartxref\n240\n%%EOF\n'
);

export interface CraneDetails {
  make?: string;
  type?: string;
  model?: string;
  capacity?: string;
  label?: string;
}

/** A supertest parser that collects a binary body (e.g. a zip) into a Buffer. */
export const binary: Parameters<Test['parse']>[0] = (res, done) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => done(null, Buffer.concat(chunks)));
};

/** Throws if the value is missing (instead of `!`). */
export function must<T>(value: T | undefined | null, what = 'value'): T {
  if (value === undefined || value === null) throw new Error(`expected ${what}`);
  return value;
}

/**
 * Imports the app with its data in a new temporary folder and generous rate limits
 * (overridable through `env`). Call from beforeAll; `cleanup` from afterAll.
 */
export async function startServer(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'crane-api-'));
  vi.resetModules();
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATA_DIR: dir,
    DB_PATH: join(dir, 'crane.db'),
    UPLOADS_DIR: join(dir, 'uploads'),
    BACKUP_DIR: join(dir, 'backups'),
    APP_VERSION: '2.0.0-test',
    UPLOAD_RATE: '1000 per minute',
    WRITE_RATE: '1000 per minute',
    BACKUP_KEEP: '7',
    BACKUP_INCLUDE_UPLOADS: '1',
    MAX_UPLOAD_MB: '500',
    ...env,
  });
  const { app } = (await import('../server/index.ts')) as { app: Express };
  const db: typeof DbModule = await import('../server/db.ts');
  const cranes: typeof CranesModule = await import('../server/cranes.ts');
  const backupService: typeof BackupServiceModule = await import('../server/services/backups.ts');
  db.openDb();

  const uploads = join(dir, 'uploads');
  const backups = join(dir, 'backups');

  /** A write carrying the CSRF cookie and the same token in the header, as apiFetch sends. */
  const write = (method: 'post' | 'put' | 'patch' | 'delete', url: string) => {
    const agent = request(app);
    return agent[method](url)
      .set('Cookie', `hhh_csrf=${CSRF_TOKEN}`)
      .set('X-CSRF-Token', CSRF_TOKEN);
  };

  /** POST /api/upload with the tiny PDF; details default to a Tadano AC100. */
  const upload = (details: CraneDetails = {}, file = TINY_PDF, filename = 'tiny.pdf') => {
    const fields = {
      make: 'Tadano',
      type: 'Mobile',
      model: 'AC100',
      capacity: '100t',
      ...details,
    };
    let req = write('post', '/api/upload');
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach('file', file, filename);
  };

  /** Uploads and returns the new crane (failing the test if it wasn't created). */
  const create = async (details: CraneDetails = {}): Promise<Crane> => {
    const res = await upload(details);
    if (res.status !== 201) throw new Error(`upload failed: ${JSON.stringify(res.body)}`);
    return res.body as Crane;
  };

  /** POST /api/cranes/:id/files */
  const addFile = (
    craneId: string,
    { filename = 'extra.pdf', label = 'Outrigger', body = TINY_PDF } = {}
  ) =>
    write('post', `/api/cranes/${encodeURIComponent(craneId)}/files`)
      .field('label', label)
      .attach('file', body, filename);

  /** Empties the catalogue, uploads and backups between tests. */
  const reset = () => {
    db.getDb().exec('DELETE FROM files; DELETE FROM cranes; DELETE FROM spec_events;');
    for (const d of [uploads, backups]) {
      mkdirSync(d, { recursive: true });
      for (const name of readdirSync(d, { withFileTypes: true }).map((e) => e.name))
        rmSync(join(d, name), { recursive: true, force: true });
    }
  };

  const cleanup = () => {
    db.closeDb();
    rmSync(dir, { recursive: true, force: true });
  };

  return {
    app,
    dir,
    uploads,
    backups,
    db,
    cranes,
    backupService,
    write,
    upload,
    create,
    addFile,
    reset,
    cleanup,
  };
}
