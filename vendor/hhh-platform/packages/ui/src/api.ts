// The one way the browser calls the app's API. It sends JSON (or FormData for uploads),
// adds the CSRF header the server kit requires on POST/PUT/PATCH/DELETE, and turns the
// kit's {"error": "..."} replies into an ApiError the UI can show as is.
//
//   const cranes = await apiFetch<Crane[]>('/api/cranes');
//   await apiFetch('/api/cranes', { method: 'POST', body: { name } });

/** Must match CSRF_COOKIE and CSRF_HEADER in @hhh/server. */
export const CSRF_COOKIE = 'hhh_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export class ApiError extends Error {
  readonly status: number;
  /** The server's `details` (e.g. which fields failed validation), when it sent any. */
  readonly details: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Sent as JSON, or as multipart form data when it is a FormData. */
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export function readCsrfToken(): string | undefined {
  for (const part of document.cookie.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === CSRF_COOKIE)
      return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

function request(path: string, options: ApiOptions, token: string | undefined): Promise<Response> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...options.headers };
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) {
    body = options.body; // the browser sets the multipart boundary
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }
  if (!SAFE_METHODS.has(method) && token) headers[CSRF_HEADER] = token;
  return fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    ...(body === undefined ? {} : { body }),
    ...(options.signal ? { signal: options.signal } : {}),
  });
}

async function errorFrom(res: Response): Promise<ApiError> {
  let message = `Request failed (${res.status})`;
  let details: unknown;
  try {
    const data = (await res.json()) as { error?: unknown; details?: unknown };
    if (typeof data.error === 'string' && data.error) message = data.error;
    details = data.details;
  } catch {
    // Not JSON (e.g. a proxy's own error page): keep the generic message.
  }
  return new ApiError(res.status, message, details);
}

/**
 * Calls the API and returns its JSON (undefined for an empty reply). Throws ApiError for
 * any non-2xx reply, with the server's message. A 403 is retried once when the server
 * has just issued a new CSRF cookie (the old one was cleared or expired).
 */
export async function apiFetch<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const sent = readCsrfToken();
  let res = await request(path, options, sent);
  if (res.status === 403 && !SAFE_METHODS.has(options.method ?? 'GET')) {
    const fresh = readCsrfToken();
    if (fresh && fresh !== sent) res = await request(path, options, fresh);
  }
  if (!res.ok) throw await errorFrom(res);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}
