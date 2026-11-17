// A stand-in XMLHttpRequest for upload tests: `reply` answers each request, after one
// progress event at 50%. Requests are kept in `sent` for assertions.
import { vi } from 'vitest';

export interface SentUpload {
  url: string;
  form: FormData;
  headers: Record<string, string>;
}

export type UploadReply = { status: number; body?: unknown } | 'network-error' | 'abort';

export function stubXhr(reply: (url: string, form: FormData) => UploadReply) {
  const sent: SentUpload[] = [];
  class FakeXhr {
    url = '';
    status = 0;
    response: unknown = null;
    responseType = '';
    headers: Record<string, string> = {};
    upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    open(_method: string, url: string) {
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    send(form: FormData) {
      sent.push({ url: this.url, form, headers: this.headers });
      const r = reply(this.url, form);
      void Promise.resolve().then(() => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 2 } as ProgressEvent);
        if (r === 'network-error') this.onerror?.();
        else if (r === 'abort') this.onabort?.();
        else {
          this.status = r.status;
          this.response = r.body ?? null;
          this.onload?.();
        }
      });
    }
  }
  vi.stubGlobal('XMLHttpRequest', FakeXhr);
  return sent;
}
