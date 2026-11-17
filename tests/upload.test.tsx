// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@hhh/ui';
import { upload, withRetry } from '../src/lib/upload.ts';
import { stubXhr } from './fakeXhr.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = 'hhh_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
});

const form = () => {
  const f = new FormData();
  f.append('make', 'Grove');
  return f;
};

describe('upload', () => {
  it('posts the form with the CSRF token and reports progress', async () => {
    document.cookie = 'hhh_csrf=tok123';
    const sent = stubXhr(() => ({ status: 201, body: { id: 'x' } }));
    const progress = vi.fn();
    await expect(upload('/api/upload', form(), progress)).resolves.toEqual({ id: 'x' });
    expect(progress).toHaveBeenCalledWith(50);
    expect(sent[0]?.headers['X-CSRF-Token']).toBe('tok123');
    expect(sent[0]?.form.get('make')).toBe('Grove');
  });

  it('fails with the server’s message, or the status', async () => {
    stubXhr(() => ({ status: 409, body: { error: 'Already exists' } }));
    await expect(upload('/u', form())).rejects.toMatchObject({
      status: 409,
      message: 'Already exists',
    });
    stubXhr(() => ({ status: 502 }));
    await expect(upload('/u', form())).rejects.toThrow('Upload failed (502)');
    stubXhr(() => 'network-error');
    await expect(upload('/u', form())).rejects.toThrow('Network error during upload');
    stubXhr(() => 'abort');
    await expect(upload('/u', form())).rejects.toThrow('Upload aborted');
  });
});

describe('withRetry', () => {
  it('waits and retries on 429, up to five times', async () => {
    const pause = vi.fn(async (_ms: number) => undefined);
    let calls = 0;
    const work = async () => {
      calls += 1;
      if (calls < 3) throw new ApiError(429, 'Too many requests');
      return 'ok';
    };
    await expect(withRetry(work, pause)).resolves.toBe('ok');
    expect(pause.mock.calls.map(([ms]) => ms)).toEqual([1200, 2400]);

    const always = vi.fn(async () => {
      throw new ApiError(429, 'slow down');
    });
    await expect(withRetry(always, pause)).rejects.toThrow('slow down');
    expect(always).toHaveBeenCalledTimes(6);
  });

  it('does not retry other failures', async () => {
    const work = vi.fn(async () => {
      throw new ApiError(400, 'bad');
    });
    await expect(withRetry(work, vi.fn())).rejects.toThrow('bad');
    expect(work).toHaveBeenCalledTimes(1);
  });
});
