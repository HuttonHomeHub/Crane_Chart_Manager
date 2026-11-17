// The crane API, ported from 1.x's tests/test_app.py (same routes, same JSON).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Crane, CranePage, DeleteFileReply, InstanceInfoReply } from '../shared/api.ts';
import { binary, must, startServer } from './server.ts';

let s: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  s = await startServer();
});
afterAll(() => s.cleanup());
beforeEach(() => s.reset());

interface EventRow {
  event_type: string;
  filename: string;
  snapshot_before: string | null;
  snapshot_after: string | null;
}
const events = (type: string) =>
  s.db
    .getDb()
    .prepare<[string], EventRow>('SELECT * FROM spec_events WHERE event_type = ?')
    .all(type);

const items = async () => ((await request(s.app).get('/api/pdfs')).body as CranePage).items;

describe('CSRF', () => {
  it('refuses a change without the token', async () => {
    const res = await request(s.app).delete('/api/delete/anything');
    expect(res.status).toBe(403);
    expect(res.body.error).toBeTruthy();
  });

  it('lets reads through without it', async () => {
    expect((await request(s.app).get('/api/pdfs')).status).toBe(200);
    expect((await request(s.app).get('/api/export')).status).toBe(200);
  });
});

describe('upload, edit and delete', () => {
  it('creates a crane with its PDF in its own folder', async () => {
    const res = await s.upload();
    expect(res.status).toBe(201);
    const body = res.body as Crane & { success: boolean };
    expect(body.success).toBe(true);
    expect(body.id).toBe('tadano_mobile_ac100_100t');
    expect(body.name).toBe(body.id);
    expect(body.file_count).toBe(1);
    const primary = must(body.files[0]);
    expect(primary.is_primary).toBe(true);
    expect(primary.stored_name).toBe('tiny.pdf');
    expect(primary.original_filename).toBe('tiny.pdf');
    expect(primary.url).toBe('/uploads/tadano_mobile_ac100_100t/tiny.pdf');
    expect(body.url).toBe(primary.url);
    expect(body.primary_file_id).toBe(primary.id);
    expect(body.uploaded_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}$/);
    expect(existsSync(join(s.uploads, body.id, primary.stored_name))).toBe(true);
    expect(s.cranes.getCrane(body.id)?.make).toBe('Tadano');
  });

  it('serves the stored PDF, including byte ranges', async () => {
    const crane = await s.create();
    const res = await request(s.app).get(must(crane.url));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    const part = await request(s.app)
      .get(must(crane.url))
      .set('Range', 'bytes=0-4')
      .buffer(true)
      .parse(binary);
    expect(part.status).toBe(206);
    expect((part.body as Buffer).toString()).toBe('%PDF-');
  });

  it('answers a missing PDF with JSON that names no path', async () => {
    const res = await request(s.app).get('/uploads/no-such-file.pdf');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'File not found' });
    expect(res.text).not.toContain(s.uploads);
    expect((await request(s.app).get('/uploads/../crane.db')).status).toBe(404);
  });

  it('refuses a second crane with the same details', async () => {
    await s.upload();
    const res = await s.upload();
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('File with these specifications already exists');
  });

  it('keeps the label the bulk importer sends for the first file', async () => {
    const res = await s.upload({ make: 'Liebherr', model: 'LTM1100', label: 'Load Chart' });
    expect(res.status).toBe(201);
    expect(res.body.files[0].label).toBe('Load Chart');
  });

  it('fills missing details with "Unknown", as 1.x did', async () => {
    const res = await s
      .write('post', '/api/upload')
      .field('make', 'Grove')
      .attach('file', Buffer.from('%PDF-1.4'), 'g.pdf');
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('grove_unknown_unknown_unknown');
  });

  it('stores an awkward filename safely and keeps a readable original', async () => {
    const res = await s
      .write('post', '/api/upload')
      .field('make', 'Sany')
      .field('type', 'Crawler')
      .field('model', 'SCC')
      .field('capacity', '1t')
      .attach('file', Buffer.from('%PDF-1.4'), 'Über chart (v2).PDF');
    expect(res.status).toBe(201);
    expect(res.body.files[0].stored_name).toBe('Uber_chart_v2.PDF');
    expect(res.body.files[0].original_filename).toBe('Uber_chart_v2.PDF');
  });

  it('renames the crane and its folder when an edit changes the slug', async () => {
    const first = await s.create();
    const res = await s
      .write('put', `/api/metadata/${first.id}`)
      .send({ make: 'Tadano', type: 'Mobile', model: 'AC100', capacity: '200t' });
    expect(res.status).toBe(200);
    expect(res.body.renamed).toBe(true);
    expect(res.body.old_name).toBe(first.id);
    expect(res.body.id).toBe('tadano_mobile_ac100_200t');
    expect(res.body.files[0].url).toBe('/uploads/tadano_mobile_ac100_200t/tiny.pdf');
    expect(existsSync(join(s.uploads, first.id))).toBe(false);
    expect(existsSync(join(s.uploads, res.body.id, 'tiny.pdf'))).toBe(true);
    expect(s.cranes.getCrane(first.id)).toBeUndefined();
    expect(s.cranes.getCrane(res.body.id)).toBeDefined();
  });

  it('edits in place, keeping uploaded_at and setting updated_at', async () => {
    const first = await s.create();
    const res = await s
      .write('put', `/api/metadata/${first.id}`)
      .send({ make: ' Tadano ', type: 'Mobile', model: 'AC100', capacity: '100t' });
    expect(res.body.renamed).toBe(false);
    const after = must(s.cranes.getCrane(first.id));
    expect(after.uploaded_at).toBe(first.uploaded_at);
    expect(after.updated_at).not.toBeNull();
    expect(after.make).toBe('Tadano');
  });

  it('refuses an edit onto another crane', async () => {
    const a = await s.create();
    await s.create({ capacity: '200t' });
    const res = await s
      .write('put', `/api/metadata/${a.id}`)
      .send({ make: 'Tadano', type: 'Mobile', model: 'AC100', capacity: '200t' });
    expect(res.status).toBe(409);
    expect(existsSync(join(s.uploads, a.id))).toBe(true);
  });

  it('moves the folder back if the database step of a rename fails', async () => {
    const a = await s.create();
    const db = s.db.getDb();
    db.exec(`CREATE TRIGGER block BEFORE UPDATE ON files BEGIN SELECT RAISE(ABORT, 'no'); END`);
    try {
      const res = await s
        .write('put', `/api/metadata/${a.id}`)
        .send({ make: 'Tadano', type: 'Mobile', model: 'AC100', capacity: '300t' });
      expect(res.status).toBe(500);
    } finally {
      db.exec('DROP TRIGGER block');
    }
    expect(existsSync(join(s.uploads, a.id, 'tiny.pdf'))).toBe(true);
    expect(existsSync(join(s.uploads, 'tadano_mobile_ac100_300t'))).toBe(false);
    expect(s.cranes.getCrane(a.id)?.capacity).toBe('100t');
  });

  it('deletes a crane, its folder and its rows', async () => {
    const first = await s.create();
    const res = await s.write('delete', `/api/delete/${first.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
    expect(existsSync(join(s.uploads, first.id))).toBe(false);
    expect(s.cranes.getCrane(first.id)).toBeUndefined();
    expect((await s.write('delete', `/api/delete/${first.id}`)).status).toBe(404);
  });

  it('edits and deletes a crane whose id has accented letters', async () => {
    const crane = await s.create({ make: 'Été' });
    expect(crane.id).toBe('été_mobile_ac100_100t');
    const url = `/api/metadata/${encodeURIComponent(crane.id)}`;
    const edit = await s
      .write('put', url)
      .send({ make: 'Été', type: 'Mobile', model: 'AC100', capacity: '100t' });
    expect(edit.status).toBe(200);
    const del = await s.write('delete', `/api/delete/${encodeURIComponent(crane.id)}`);
    expect(del.status).toBe(200);
  });

  it('never loses an upload made while other cranes are being deleted', async () => {
    const victims: string[] = [];
    for (let i = 0; i < 10; i += 1) victims.push((await s.create({ make: `Del${i}` })).id);
    const results = await Promise.all([
      ...Array.from({ length: 10 }, (_, i) => s.upload({ make: `New${i}`, capacity: '2t' })),
      ...victims.map((v) => s.write('delete', `/api/delete/${v}`)),
    ]);
    expect(results.map((r) => r.status).every((st) => st === 200 || st === 201)).toBe(true);
    const ids = new Set(s.cranes.listCranes().map((c) => c.id));
    for (let i = 0; i < 10; i += 1) expect(ids.has(`new${i}_mobile_ac100_2t`)).toBe(true);
    expect(ids.size).toBe(10);
  });
});

describe('validation', () => {
  it('refuses a file that is not a PDF by name', async () => {
    const res = await s.upload({}, Buffer.from('<html>'), 'evil.html');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('PDF');
  });

  it('refuses a .pdf whose bytes are not a PDF', async () => {
    const res = await s.upload({}, Buffer.from('<html>not a pdf</html>'), 'sneaky.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Only PDF files are allowed');
    expect(readdirSync(s.uploads)).toEqual([]);
  });

  it('refuses an upload with no file', async () => {
    const res = await s.write('post', '/api/upload').field('make', 'X');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No file part');
  });

  it('refuses a file under another field name', async () => {
    const res = await s.write('post', '/api/upload').attach('other', Buffer.from('%PDF-'), 'a.pdf');
    expect(res.status).toBe(400);
  });

  it.each([
    ['make', 'Manufacturer'],
    ['type', 'Type'],
    ['model', 'Model'],
    ['capacity', 'Capacity'],
    ['label', 'Label'],
  ])('caps %s at MAX_FIELD_LEN characters', async (field, name) => {
    const res = await s.upload({ [field]: 'X'.repeat(65) });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe(`${name} is too long (max 64 characters).`);
    expect((await s.upload({ [field]: 'é'.repeat(64) })).status).toBe(201);
  });

  it('needs every detail for an edit', async () => {
    const first = await s.create();
    const res = await s
      .write('put', `/api/metadata/${first.id}`)
      .send({ make: '', type: 'X', model: 'X', capacity: '1t' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('make, type, model, and capacity are required');
    const long = await s
      .write('put', `/api/metadata/${first.id}`)
      .send({ make: 'X'.repeat(65), type: 'X', model: 'X', capacity: '1t' });
    expect(long.status).toBe(400);
  });

  it('answers an edit of an unknown crane with JSON', async () => {
    const res = await s
      .write('put', '/api/metadata/nonexistent')
      .send({ make: 'A', type: 'B', model: 'C', capacity: '1t' });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'File not found' });
  });

  it('answers a PDF over MAX_UPLOAD_MB with 1.x’s message', async () => {
    const big = await startServer({ MAX_UPLOAD_MB: '1' });
    try {
      const res = await big.upload({}, Buffer.alloc(1024 * 1024 + 1, 0x25));
      expect(res.status).toBe(413);
      expect(res.body.error).toBe('File too large. Maximum upload size is 1 MB.');
    } finally {
      big.cleanup();
    }
  });
});

describe('pagination', () => {
  it('returns items, total and next_cursor', async () => {
    expect((await request(s.app).get('/api/pdfs')).body).toEqual({
      items: [],
      total: 0,
      next_cursor: null,
    });
  });

  it('pages by cursor in id order', async () => {
    const names: string[] = [];
    for (let i = 2; i >= 0; i -= 1) names.push((await s.create({ make: `Pg0${i}` })).name);
    names.sort();
    const p1 = (await request(s.app).get('/api/pdfs?limit=2')).body as CranePage;
    expect(p1.total).toBe(3);
    expect(p1.items.map((c) => c.name)).toEqual(names.slice(0, 2));
    expect(p1.next_cursor).toBe(names[1]);
    const p2 = (await request(s.app).get(`/api/pdfs?after=${p1.next_cursor ?? ''}&limit=2`))
      .body as CranePage;
    expect(p2.items.map((c) => c.name)).toEqual([names[2]]);
    expect(p2.next_cursor).toBeNull();
  });

  it('returns everything without a limit, and ignores an unknown cursor', async () => {
    await s.create({ make: 'All1' });
    await s.create({ make: 'All2' });
    const all = (await request(s.app).get('/api/pdfs?limit=x')).body as CranePage;
    expect(all.next_cursor).toBeNull();
    expect(all.items).toHaveLength(2);
    const unknown = (await request(s.app).get('/api/pdfs?after=zzz')).body as CranePage;
    expect(unknown.items).toHaveLength(2);
  });
});

describe('export', () => {
  it('downloads the catalogue as JSON keyed by crane id', async () => {
    const crane = await s.create();
    const res = await request(s.app).get('/api/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="?crane_export\.json"?$/
    );
    const body = JSON.parse(res.text) as Record<string, Crane>;
    expect(Object.keys(body)).toEqual([crane.id]);
    expect(res.text).toContain('\n  "');
  });

  it('exports an empty catalogue as {}', async () => {
    expect(JSON.parse((await request(s.app).get('/api/export')).text)).toEqual({});
  });
});

describe('facets and merging manufacturers', () => {
  it('lists distinct makes and types', async () => {
    await s.create({ make: 'Liebherr', type: 'Mobile', model: 'LTM1', capacity: '90t' });
    await s.create({ make: 'liebherr2', type: 'Crawler', model: 'LR1', capacity: '60t' });
    await s.create({ make: 'Tadano', type: 'Mobile', model: 'AC1', capacity: '50t' });
    const res = await request(s.app).get('/api/facets');
    expect(res.body.makes).toEqual(['Liebherr', 'liebherr2', 'Tadano']);
    expect(new Set(res.body.types)).toEqual(new Set(['Mobile', 'Crawler']));
  });

  it('renames cranes to the new make when nothing collides', async () => {
    const typo = await s.create({ make: 'Liebherri', model: 'LTM1', capacity: '90t' });
    await s.addFile(typo.id);
    const res = await s
      .write('post', '/api/merge-make')
      .send({ from: 'Liebherri', into: 'Liebherr' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, moved: 1, absorbed: 0 });
    expect(s.cranes.getCrane(typo.id)).toBeUndefined();
    const merged = must(s.cranes.getCrane('liebherr_mobile_ltm1_90t'));
    expect(merged.make).toBe('Liebherr');
    expect(merged.file_count).toBe(2);
    expect(readdirSync(join(s.uploads, merged.id))).toHaveLength(2);
    expect((await request(s.app).get('/api/facets')).body.makes).not.toContain('Liebherri');
    expect(events('merge')).toHaveLength(1);
  });

  it('moves files into the existing crane on a collision', async () => {
    const good = await s.create({ make: 'Liebherr', model: 'LTM1', capacity: '90t' });
    await s.create({ make: 'Liebherri', model: 'LTM1', capacity: '90t' });
    const res = await s
      .write('post', '/api/merge-make')
      .send({ from: 'Liebherri', into: 'Liebherr' });
    expect(res.status).toBe(200);
    expect(res.body.absorbed).toBe(1);
    const target = must(s.cranes.getCrane(good.id));
    expect(target.file_count).toBe(2);
    expect(target.files.map((f) => f.stored_name).sort()).toEqual(['tiny.pdf', 'tiny_2.pdf']);
    expect(readdirSync(join(s.uploads, good.id)).sort()).toEqual(['tiny.pdf', 'tiny_2.pdf']);
    expect(s.cranes.getCrane('liebherri_mobile_ltm1_90t')).toBeUndefined();
    expect(existsSync(join(s.uploads, 'liebherri_mobile_ltm1_90t'))).toBe(false);
  });

  it('checks its input', async () => {
    const merge = (body: object) => s.write('post', '/api/merge-make').send(body);
    expect((await merge({ from: 'A', into: 'A' })).status).toBe(400);
    expect((await merge({ from: '', into: 'B' })).status).toBe(400);
    expect((await merge({})).status).toBe(400);
    expect((await merge({ from: 'A', into: 'B'.repeat(65) })).status).toBe(400);
    const none = await merge({ from: 'Nope', into: 'B' });
    expect(none.status).toBe(404);
    expect(none.body.error).toBe('No cranes with manufacturer "Nope"');
  });
});

describe('instance info', () => {
  it('reports the version, counts, paths and limits', async () => {
    await s.create();
    const body = (await request(s.app).get('/api/info')).body as InstanceInfoReply;
    expect(body.version).toBe('2.0.0-test');
    expect(body.counts).toEqual({ cranes: 1, files: 1 });
    expect(body.paths).toEqual({
      database: join(s.dir, 'crane.db'),
      uploads: s.uploads,
      backups: s.backups,
    });
    expect(body.limits).toEqual({
      maxUploadMb: 500,
      maxFieldLen: 64,
      uploadRate: { limit: 1000, windowMs: 60_000 },
      writeRate: { limit: 1000, windowMs: 60_000 },
    });
    expect(body.trustProxyHops).toBe(0);
  });
});

describe('audit log', () => {
  it('records an upload with what was created', async () => {
    const crane = await s.create();
    const [row] = events('upload');
    expect(must(row).filename).toBe(crane.name);
    expect(must(row).snapshot_before).toBeNull();
    expect(JSON.parse(must(must(row).snapshot_after))).toMatchObject({
      id: crane.id,
      files: [{ stored_name: 'tiny.pdf', is_primary: true }],
    });
  });

  it('records a delete with what was removed', async () => {
    const crane = await s.create();
    await s.write('delete', `/api/delete/${crane.id}`);
    const rows = events('delete');
    expect(rows).toHaveLength(1);
    expect(must(rows[0]).filename).toBe(crane.id);
    expect(must(rows[0]).snapshot_before).not.toBeNull();
    expect(must(rows[0]).snapshot_after).toBeNull();
  });

  it('records an edit before and after', async () => {
    const crane = await s.create();
    await s
      .write('put', `/api/metadata/${crane.id}`)
      .send({ make: 'Tadano', type: 'Mobile', model: 'AC100', capacity: '200t' });
    const [row] = events('edit');
    expect(JSON.parse(must(must(row).snapshot_after)).new_id).toBe('tadano_mobile_ac100_200t');
    expect(must(row).snapshot_before).not.toBeNull();
  });

  it('records an added file, a label change and a primary change', async () => {
    const crane = await s.create();
    const added = (await s.addFile(crane.id)).body as Crane;
    const extra = must(added.files.find((f) => !f.is_primary));
    await s.write('patch', `/api/cranes/${crane.id}/files/${extra.id}`).send({ label: 'Dims' });
    await s.write('put', `/api/cranes/${crane.id}/primary`).send({ file_id: extra.id });
    expect(must(events('file_add')[0]).filename).toBe(crane.id);
    expect(JSON.parse(must(must(events('label_edit')[0]).snapshot_after))).toEqual({
      label: 'Dims',
    });
    expect(JSON.parse(must(must(events('primary_change')[0]).snapshot_before))).toEqual({
      primary_file_id: crane.primary_file_id,
    });
  });

  it('carries on when the audit log cannot be written', async () => {
    const db = s.db.getDb();
    db.exec('ALTER TABLE spec_events RENAME TO spec_events_away');
    try {
      expect((await s.upload()).status).toBe(201);
    } finally {
      db.exec('ALTER TABLE spec_events_away RENAME TO spec_events');
    }
  });
});

describe('several files per crane', () => {
  it('adds a labelled file, keeping one primary', async () => {
    const crane = await s.create();
    const res = await s.addFile(crane.id, { filename: 'outrigger.pdf', label: 'Outrigger chart' });
    expect(res.status).toBe(201);
    expect(res.body.file_count).toBe(2);
    expect(res.body.files.map((f: { label: string }) => f.label)).toContain('Outrigger chart');
    expect(res.body.files.filter((f: { is_primary: boolean }) => f.is_primary)).toHaveLength(1);
    expect(res.body.files[0].is_primary).toBe(true);
    expect(readdirSync(join(s.uploads, crane.id))).toHaveLength(2);
  });

  it('refuses a file for an unknown crane, or one that is not a PDF', async () => {
    expect((await s.addFile('no_such_crane')).status).toBe(404);
    const crane = await s.create();
    const res = await s.addFile(crane.id, { filename: 'evil.pdf', body: Buffer.from('<html>') });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('PDF');
    const long = await s.addFile(crane.id, { label: 'X'.repeat(65) });
    expect(long.status).toBe(400);
  });

  it('gives a second file of the same name its own name on disk', async () => {
    const crane = await s.create();
    await s.addFile(crane.id, { filename: 'dims.pdf', label: 'A' });
    const res = await s.addFile(crane.id, { filename: 'dims.pdf', label: 'B' });
    const stored = (res.body as Crane).files.map((f) => f.stored_name).sort();
    expect(stored).toEqual(['dims.pdf', 'dims_2.pdf', 'tiny.pdf']);
  });

  it('switches the primary file', async () => {
    const crane = await s.create();
    const added = (await s.addFile(crane.id)).body as Crane;
    const supp = must(added.files.find((f) => !f.is_primary));
    const res = await s
      .write('put', `/api/cranes/${crane.id}/primary`)
      .send({ file_id: String(supp.id) });
    expect(res.status).toBe(200);
    const body = res.body as Crane;
    expect(body.primary_file_id).toBe(supp.id);
    expect(must(body.files[0]).id).toBe(supp.id);
    expect(body.url).toBe(supp.url);
  });

  it('checks the primary file id', async () => {
    const crane = await s.create();
    const put = (body: object, id = crane.id) =>
      s.write('put', `/api/cranes/${id}/primary`).send(body);
    expect((await put({ file_id: 999999 })).status).toBe(404);
    expect((await put({})).status).toBe(400);
    expect((await put({ file_id: 'one' })).status).toBe(400);
    expect((await put({ file_id: 1 }, 'nope')).status).toBe(404);
  });

  it('deletes one file and keeps the crane', async () => {
    const crane = await s.create();
    const added = (await s.addFile(crane.id)).body as Crane;
    const supp = must(added.files.find((f) => !f.is_primary));
    const res = await s.write('delete', `/api/cranes/${crane.id}/files/${supp.id}`);
    expect(res.status).toBe(200);
    const body = res.body as DeleteFileReply;
    expect(body.crane_deleted).toBe(false);
    if (!body.crane_deleted) expect(body.file_count).toBe(1);
    expect(existsSync(join(s.uploads, crane.id, supp.stored_name))).toBe(false);
  });

  it('deletes the crane with its last file', async () => {
    const crane = await s.create();
    const only = must(crane.files[0]);
    const res = await s.write('delete', `/api/cranes/${crane.id}/files/${only.id}`);
    expect(res.body).toEqual({ success: true, crane_deleted: true });
    expect(s.cranes.getCrane(crane.id)).toBeUndefined();
    expect(existsSync(join(s.uploads, crane.id))).toBe(false);
  });

  it('falls back to the remaining file when the primary is deleted', async () => {
    const crane = await s.create();
    const primary = must(crane.files[0]);
    const added = (await s.addFile(crane.id)).body as Crane;
    const supp = must(added.files.find((f) => !f.is_primary));
    const res = await s.write('delete', `/api/cranes/${crane.id}/files/${primary.id}`);
    const body = res.body as Crane;
    expect(body.files).toHaveLength(1);
    expect(must(body.files[0]).id).toBe(supp.id);
    expect(must(body.files[0]).is_primary).toBe(true);
    expect(body.primary_file_id).toBe(supp.id);
  });

  it('answers 404 for an unknown crane, file or file id', async () => {
    expect((await s.write('delete', '/api/cranes/nope/files/1')).status).toBe(404);
    const crane = await s.create();
    expect((await s.write('delete', `/api/cranes/${crane.id}/files/999`)).status).toBe(404);
    expect((await s.write('delete', `/api/cranes/${crane.id}/files/abc`)).status).toBe(404);
  });

  it('edits a file label', async () => {
    const crane = await s.create();
    const fid = must(crane.files[0]).id;
    const res = await s
      .write('patch', `/api/cranes/${crane.id}/files/${fid}`)
      .send({ label: ' Primary load chart ' });
    expect(res.status).toBe(200);
    expect(must((res.body as Crane).files.find((f) => f.id === fid)).label).toBe(
      'Primary load chart'
    );
  });

  it('checks a label edit', async () => {
    const crane = await s.create();
    const fid = must(crane.files[0]).id;
    const patch = (url: string, label: string) => s.write('patch', url).send({ label });
    expect((await patch(`/api/cranes/${crane.id}/files/${fid}`, 'X'.repeat(65))).status).toBe(400);
    expect((await patch(`/api/cranes/${crane.id}/files/999999`, 'x')).status).toBe(404);
    expect((await patch(`/api/cranes/nope/files/${fid}`, 'x')).status).toBe(404);
  });

  it('opens the earliest file when no primary is recorded', async () => {
    const crane = await s.create();
    await s.addFile(crane.id);
    s.db.getDb().prepare('UPDATE cranes SET primary_file = NULL').run();
    const again = must(s.cranes.getCrane(crane.id));
    expect(again.primary_file_id).toBe(must(crane.files[0]).id);
    expect((await items())[0]?.files[0]?.is_primary).toBe(true);
  });
});
