// Backups and restore, ported from 1.x's TestBackup and TestRestore, plus the upgrade
// path: backups 1.x wrote still restore, and are renamed so Settings lists them.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BackupsReply, CranePage, RestoreReply } from '../shared/api.ts';
import { binary, must, startServer } from './server.ts';
import { makeZip, readZip } from './zip.ts';

let s: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  s = await startServer({ BACKUP_KEEP: '2' });
});
afterAll(() => s.cleanup());
beforeEach(() => s.reset());

const status = async () => (await request(s.app).get('/api/backup')).body as BackupsReply;
const makes = async () =>
  new Set(((await request(s.app).get('/api/pdfs')).body as CranePage).items.map((c) => c.make));
const backupNow = async () => (await s.write('post', '/api/backup')).body as { name: string };
const zipOf = (name: string) => readZip(readFileSync(join(s.backups, name)));

/** A database file made the way 1.x made it, with one crane. */
function pythonDb(path: string) {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE cranes (id TEXT PRIMARY KEY, make TEXT NOT NULL, type TEXT NOT NULL,
      model TEXT NOT NULL, capacity TEXT NOT NULL, uploaded_at TEXT NOT NULL,
      updated_at TEXT, primary_file INTEGER);
    CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, crane_id TEXT NOT NULL,
      stored_name TEXT NOT NULL, original_filename TEXT, label TEXT,
      uploaded_at TEXT NOT NULL, UNIQUE(crane_id, stored_name));
    CREATE TABLE spec_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL,
      filename TEXT NOT NULL, occurred_at TEXT NOT NULL, snapshot_before TEXT,
      snapshot_after TEXT);
    INSERT INTO cranes VALUES ('oldco_mobile_o1_10t', 'Oldco', 'Mobile', 'O1', '10t',
      '2025-06-01T09:00:00.000000', NULL, 1);
    INSERT INTO files (crane_id, stored_name, original_filename, label, uploaded_at)
      VALUES ('oldco_mobile_o1_10t', 'o1.pdf', 'o1.pdf', '', '2025-06-01T09:00:00.000000');
  `);
  db.close();
  return readFileSync(path);
}

describe('backups', () => {
  it('holds a readable crane.db snapshot and every uploaded file', async () => {
    const crane = await s.create({ make: 'Snap', model: 'SX1', capacity: '9t' });
    const { name } = await backupNow();
    expect(name).toMatch(/^crane-backup-\d{8}-\d{6}\.zip$/);
    const files = zipOf(name);
    expect(files.has(`uploads/${crane.id}/tiny.pdf`)).toBe(true);
    const copy = join(s.dir, 'snapshot.db');
    writeFileSync(copy, must(files.get('crane.db')));
    const db = new Database(copy, { readonly: true });
    expect(db.prepare('SELECT COUNT(*) AS n FROM cranes').get()).toEqual({ n: 1 });
    db.close();
  });

  it('reports its settings, the backups and the schedule', async () => {
    await backupNow();
    const body = await status();
    expect(body).toMatchObject({
      enabled: true,
      dir: s.backups,
      intervalHours: 24,
      keep: 2,
      includeUploads: true,
      scheduler: { enabled: true, intervalHours: 24 },
    });
    expect(body.backups).toHaveLength(1);
  });

  it('keeps only BACKUP_KEEP of them', async () => {
    for (let i = 0; i < 4; i += 1) {
      writeFileSync(join(s.backups, `crane-backup-2026010${i}-000000.zip`), 'x');
    }
    await backupNow();
    expect((await status()).backups).toHaveLength(2);
  });

  it('needs the CSRF token to back up', async () => {
    expect((await request(s.app).post('/api/backup')).status).toBe(403);
  });

  it('streams a fresh backup as a download', async () => {
    await s.create();
    const res = await request(s.app).get('/api/backup/download').buffer(true).parse(binary);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/zip');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="?crane-backup-/);
    expect(readZip(res.body as Buffer).has('crane.db')).toBe(true);
    expect(readdirSync(s.backups)).toEqual([]);
  });

  it('downloads a listed backup by name, and nothing else', async () => {
    const { name } = await backupNow();
    const res = await request(s.app).get(`/api/backup/download/${name}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toContain('attachment');
    expect((await request(s.app).get('/api/backup/download/notabackup.txt')).status).toBe(404);
    const missing = await request(s.app).get(
      '/api/backup/download/crane-backup-20200101-000000.zip'
    );
    expect(missing.status).toBe(404);
  });

  it('leaves the uploads out when BACKUP_INCLUDE_UPLOADS is off', async () => {
    const dbOnly = await startServer({ BACKUP_INCLUDE_UPLOADS: '0' });
    try {
      await dbOnly.create();
      const { name } = (await dbOnly.write('post', '/api/backup')).body as { name: string };
      const files = readZip(readFileSync(join(dbOnly.backups, name)));
      expect([...files.keys()]).toEqual(['crane.db']);
    } finally {
      dbOnly.cleanup();
    }
  });
});

describe('restore', () => {
  it('brings back the backed-up catalogue and drops later changes', async () => {
    const keep = await s.create({ make: 'Keepco', model: 'KX1', capacity: '50t' });
    const { name } = await backupNow();
    await s.create({ make: 'Laterco', model: 'LX9', capacity: '80t' });
    await s.write('delete', `/api/delete/${keep.id}`);

    const res = await s.write('post', '/api/backup/restore').send({ name });
    expect(res.status).toBe(200);
    const body = res.body as RestoreReply;
    expect(body.counts).toEqual({ cranes: 1, files: 1 });
    expect(body.restoredUploads).toBe(true);
    expect(body.safetyBackup).toMatch(/^crane-backup-\d{8}-\d{6}-prerestore\.zip$/);
    expect(await makes()).toEqual(new Set(['Keepco']));
    expect(existsSync(join(s.uploads, keep.id, 'tiny.pdf'))).toBe(true);
    expect(existsSync(join(s.backups, body.safetyBackup))).toBe(true);
    const logged = s.db
      .getDb()
      .prepare<[], { snapshot_after: string }>(
        "SELECT snapshot_after FROM spec_events WHERE event_type = 'restore'"
      )
      .get();
    expect(JSON.parse(must(logged).snapshot_after)).toMatchObject({ source: name, cranes: 1 });
  });

  it('restores an uploaded backup zip', async () => {
    await s.create({ make: 'Roundtrip', model: 'RT1', capacity: '75t' });
    const zip = (await request(s.app).get('/api/backup/download').buffer(true).parse(binary))
      .body as Buffer;
    for (const c of s.cranes.listCranes()) await s.write('delete', `/api/delete/${c.id}`);
    expect(await makes()).toEqual(new Set());
    const res = await s
      .write('post', '/api/backup/restore')
      .attach('file', zip, 'crane-backup-x.zip');
    expect(res.status).toBe(200);
    expect(await makes()).toEqual(new Set(['Roundtrip']));
  });

  it('restores a backup 1.x made', async () => {
    const dbFile = pythonDb(join(s.dir, 'python.db'));
    const zip = makeZip({ 'crane.db': dbFile, 'uploads/oldco_mobile_o1_10t/o1.pdf': '%PDF-1.4' });
    const res = await s
      .write('post', '/api/backup/restore')
      .attach('file', zip, 'crane-backup-20250601-090000-123456.zip');
    expect(res.status).toBe(200);
    const crane = must(s.cranes.getCrane('oldco_mobile_o1_10t'));
    expect(crane.url).toBe('/uploads/oldco_mobile_o1_10t/o1.pdf');
    const pdf = await request(s.app).get(must(crane.url));
    expect(pdf.status).toBe(200);
  });

  it('refuses bad names', async () => {
    const restore = (name: unknown) => s.write('post', '/api/backup/restore').send({ name });
    expect((await restore('evil.txt')).status).toBe(400);
    expect((await restore('../crane-backup-20260101-000000.zip')).status).toBe(400);
    expect((await restore('crane-backup-20260101-000000.zip')).status).toBe(404);
    expect((await restore(undefined)).status).toBe(400);
  });

  it('refuses something that is not a backup zip, leaving the catalogue alone', async () => {
    await s.create({ make: 'Guardco' });
    const upload = (body: Buffer, filename = 'crane-backup-x.zip') =>
      s.write('post', '/api/backup/restore').attach('file', body, filename);
    expect((await upload(Buffer.from('not a zip'))).status).toBe(400);
    expect((await upload(Buffer.from('zip'), 'backup.tar')).status).toBe(400);
    const noDb = await upload(makeZip({ 'uploads/foo/bar.pdf': '%PDF-1.4' }));
    expect(noDb.status).toBe(400);
    const wrongDb = await upload(makeZip({ 'crane.db': 'not sqlite' }));
    expect(wrongDb.status).toBe(400);
    expect(await makes()).toEqual(new Set(['Guardco']));
  });

  it('needs the CSRF token', async () => {
    const res = await request(s.app)
      .post('/api/backup/restore')
      .send({ name: 'crane-backup-20260101-000000.zip' });
    expect(res.status).toBe(403);
  });
});

describe('backups from 1.x', () => {
  it('renames them to the names Settings lists, leaving others alone', async () => {
    const mod = s.backupService;
    const dir = s.backups;
    mkdirSync(dir, { recursive: true });
    for (const name of [
      'crane-backup-20250601-090000-123456.zip',
      'crane-backup-20250601-090000-654321-prerestore.zip',
      'crane-backup-20250602-090000-111111.zip',
      'crane-backup-20250602-090000.zip',
      'notes.txt',
    ])
      writeFileSync(join(dir, name), 'x');
    const renamed = await mod.renameLegacyBackups();
    expect(renamed.sort()).toEqual([
      'crane-backup-20250601-090000-prerestore.zip',
      'crane-backup-20250601-090000.zip',
    ]);
    expect(readdirSync(dir).sort()).toEqual([
      'crane-backup-20250601-090000-prerestore.zip',
      'crane-backup-20250601-090000.zip',
      'crane-backup-20250602-090000-111111.zip',
      'crane-backup-20250602-090000.zip',
      'notes.txt',
    ]);
    expect(await mod.renameLegacyBackups()).toEqual([]);
  });

  it('does nothing when there is no backup folder', async () => {
    const empty = await startServer({ BACKUP_DIR: join(tmpdir(), 'crane-no-such-dir') });
    try {
      expect(await empty.backupService.renameLegacyBackups()).toEqual([]);
    } finally {
      empty.cleanup();
    }
  });
});
