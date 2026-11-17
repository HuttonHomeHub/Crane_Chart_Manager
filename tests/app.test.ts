import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let app: Express;
let dir: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'crane-app-'));
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = dir;
  process.env.DB_PATH = join(dir, 'crane.db');
  process.env.APP_VERSION = '2.0.0-test';
  ({ app } = await import('../server/index.ts'));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('the app on the shared kit', () => {
  it('reports health, version and readiness', async () => {
    expect((await request(app).get('/health')).body).toEqual({
      status: 'ok',
      version: '2.0.0-test',
    });
    expect((await request(app).get('/version')).body).toEqual({ version: '2.0.0-test' });
    const ready = await request(app).get('/ready');
    expect(ready.status).toBe(200);
    expect(ready.body).toEqual({ status: 'ready' });
  });

  it('answers an unknown /api path with JSON, and sends the security headers', async () => {
    const res = await request(app).get('/api/nothing-here');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Not found' });
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(String(res.headers['set-cookie'])).toMatch(/hhh_csrf=/);
  });

  it('refuses a write without the CSRF token', async () => {
    const res = await request(app).post('/api/anything').send({});
    expect(res.status).toBe(403);
  });
});
