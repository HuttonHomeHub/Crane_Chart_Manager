// What jsdom lacks for these components: native <dialog> methods, scrollIntoView,
// CSS.escape and IntersectionObserver (a controllable stand-in), plus matchMedia.
import { vi } from 'vitest';

export const observers: Array<{ callback: IntersectionObserverCallback; target?: Element }> = [];

/** Tells every observed sentinel it scrolled into view. */
export function scrollSentinelsIntoView() {
  for (const o of [...observers]) {
    if (o.target)
      o.callback(
        [{ isIntersecting: true, target: o.target } as IntersectionObserverEntry],
        {} as IntersectionObserver
      );
  }
}

let narrow = false;
/** Pretends the window is narrower than 900px (the drawer layout). */
export function setNarrow(value: boolean) {
  narrow = value;
}

export function setUpDom() {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  Element.prototype.scrollIntoView ??= () => {};
  globalThis.CSS ??= {} as typeof CSS;
  CSS.escape ??= (s: string) => s.replace(/["\\]/g, '\\$&');
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      entry: { callback: IntersectionObserverCallback; target?: Element };
      constructor(callback: IntersectionObserverCallback) {
        this.entry = { callback };
        observers.push(this.entry);
      }
      observe(target: Element) {
        this.entry.target = target;
      }
      disconnect() {
        observers.splice(observers.indexOf(this.entry), 1);
      }
    }
  );
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('max-width') && narrow,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
}
