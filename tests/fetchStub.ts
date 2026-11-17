// A typed stand-in for fetch in browser (jsdom) tests: each call is answered by
// `route` with a real Response, as fetch would return.
import { vi } from 'vitest';

export interface RouteReply {
  status?: number;
  body?: unknown;
}

export type Route = (url: string, init: RequestInit) => RouteReply;

export function stubFetch(route: Route) {
  const fetchMock = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const r = route(String(input), init);
    return new Response(JSON.stringify(r.body ?? null), { status: r.status ?? 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const isGet = (init: RequestInit) => !init.method || init.method === 'GET';
