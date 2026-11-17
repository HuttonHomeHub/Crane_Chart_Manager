// Uploads with progress (fetch can't report it), sending the CSRF header as apiFetch
// does and failing with the same ApiError, so callers treat both alike.
import { ApiError, CSRF_HEADER, readCsrfToken } from '@hhh/ui';

/** POSTs `form` to `url`; `onProgress` gets 0–100 as the file goes up. */
export function upload<T>(url: string, form: FormData, onProgress?: (pct: number) => void) {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'json';
    xhr.setRequestHeader('Accept', 'application/json');
    const token = readCsrfToken();
    if (token) xhr.setRequestHeader(CSRF_HEADER, token);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      const body = xhr.response as { error?: unknown } | null;
      if (xhr.status >= 200 && xhr.status < 300) resolve(body as T);
      else {
        const message =
          typeof body?.error === 'string' && body.error
            ? body.error
            : `Upload failed (${xhr.status})`;
        reject(new ApiError(xhr.status, message));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'Network error during upload'));
    xhr.onabort = () => reject(new ApiError(0, 'Upload aborted'));
    xhr.send(form);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `work`, retrying up to 5 times when the server says to slow down (429), waiting
 * 1.2 s, 2.4 s … 6 s, as 1.x's bulk importer did.
 */
export async function withRetry<T>(work: () => Promise<T>, pause = wait): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await work();
    } catch (err) {
      if (!(err instanceof ApiError) || err.status !== 429 || attempt >= 5) throw err;
      await pause(1200 * (attempt + 1));
    }
  }
}
