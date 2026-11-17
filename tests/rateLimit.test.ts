import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startServer } from './server.ts';

let s: Awaited<ReturnType<typeof startServer>>;

beforeAll(async () => {
  s = await startServer({ UPLOAD_RATE: '5 per minute', WRITE_RATE: '3 per minute' });
});
afterAll(() => s.cleanup());

describe('rate limits', () => {
  it('answers 429 with JSON after UPLOAD_RATE uploads', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await s.upload({ capacity: `${i}t` })).status);
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    const res = await s.upload({ capacity: '9t' });
    expect(res.body.error).toBeTruthy();
  });

  it('counts other changes against WRITE_RATE', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1)
      statuses.push((await s.write('delete', '/api/delete/nothing')).status);
    expect(statuses).toEqual([404, 404, 404, 429]);
  });
});
