// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PdfView, type FindState } from '../src/components/PdfView.tsx';
import { setUpDom } from './dom.tsx';
import { craneFile } from './factories.ts';
import { destroyed, fakePdfs, renders } from './fakePdf.tsx';

vi.mock('../src/lib/pdfjs.ts', () => import('./fakePdf.tsx'));

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 1200 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 800 });
});
beforeEach(() => {
  setUpDom();
  renders.length = 0;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      cb: () => void;
      constructor(cb: () => void) {
        this.cb = cb;
      }
      observe() {
        this.cb();
      }
      disconnect() {}
    }
  );
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    cb();
    return 0;
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const file = craneFile('c', { stored_name: 'chart.pdf', label: 'Load chart' });
fakePdfs.set(file.url, [['Max 250t', 'Radius 10m'], ['Counterweight'], ['250t at 6m']]);

function Harness({
  notice = vi.fn(),
  url = file.url,
}: {
  notice?: (m: string) => void;
  url?: string;
}) {
  const [find, setFind] = useState<FindState>({ open: false, query: '' });
  return <PdfView file={{ ...file, url }} find={find} onFind={setFind} onNotice={notice} />;
}

const lastRender = () => renders.at(-1);

describe('the PDF view', () => {
  it('shows page 1, fitted to the window, with the page count', async () => {
    render(<Harness />);
    await waitFor(() => expect(lastRender()).toEqual({ url: file.url, page: 1, scale: 1 }));
    expect(document.getElementById('page-total')).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(document.getElementById('zoom-level')).toHaveTextContent('100%');
    expect(screen.getByRole('link', { name: 'Download PDF' })).toHaveAttribute(
      'download',
      'chart.pdf'
    );
  });

  it('moves between pages with the buttons, the page box and the arrow keys', async () => {
    render(<Harness />);
    await waitFor(() => expect(lastRender()?.page).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(lastRender()?.page).toBe(2));
    const box = screen.getByRole('spinbutton', { name: 'Page' });
    fireEvent.change(box, { target: { value: '9' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.blur(box);
    await waitFor(() => expect(lastRender()?.page).toBe(3));
    expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await waitFor(() => expect(lastRender()?.page).toBe(2));
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => expect(lastRender()?.page).toBe(3));
  });

  it('zooms in steps, fits width or page, and cycles from the readout', async () => {
    render(<Harness />);
    await waitFor(() => expect(lastRender()?.scale).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(lastRender()?.scale).toBe(1.25));
    fireEvent.keyDown(window, { key: '-' });
    await waitFor(() => expect(lastRender()?.scale).toBe(1));
    fireEvent.keyDown(window, { key: '=' });
    await waitFor(() => expect(lastRender()?.scale).toBe(1.25));
    fireEvent.click(screen.getByRole('button', { name: 'Fit width' }));
    await waitFor(() => expect(lastRender()?.scale).toBe(2));
    expect(screen.getByRole('button', { name: 'Fit width' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fit page' }));
    await waitFor(() => expect(lastRender()?.scale).toBe(1));
    const readout = document.getElementById('zoom-level') as HTMLElement;
    fireEvent.click(readout); // → width
    await waitFor(() => expect(lastRender()?.scale).toBe(2));
    fireEvent.click(readout); // → 100%
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    await waitFor(() => expect(lastRender()?.scale).toBe(0.75));
    fireEvent.click(readout); // → page
    await waitFor(() => expect(readout).toHaveTextContent('100%'));
  });

  it('finds text across pages, highlights it and steps through the matches', async () => {
    render(<Harness />);
    await waitFor(() => expect(lastRender()?.page).toBe(1));
    fireEvent.click(screen.getByRole('button', { name: 'Find in document' }));
    const input = screen.getByRole('searchbox', { name: 'Find in document' });
    expect(document.getElementById('find-bar')).toBeVisible();
    fireEvent.change(input, { target: { value: '250t' } });
    await waitFor(() => expect(document.getElementById('find-count')).toHaveTextContent('1/2'));
    await waitFor(() => expect(document.querySelectorAll('.pdf-highlight')).toHaveLength(1));
    expect(document.querySelector('.pdf-highlight')).toHaveClass('is-current');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(document.getElementById('find-count')).toHaveTextContent('2/2');
    await waitFor(() => expect(lastRender()?.page).toBe(3));
    fireEvent.click(screen.getByRole('button', { name: 'Next match' }));
    expect(document.getElementById('find-count')).toHaveTextContent('1/2');
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(document.getElementById('find-count')).toHaveTextContent('2/2');
    fireEvent.click(screen.getByRole('button', { name: 'Previous match' }));
    expect(document.getElementById('find-count')).toHaveTextContent('1/2');
    fireEvent.change(input, { target: { value: 'nowhere' } });
    await waitFor(() => expect(document.getElementById('find-count')).toHaveTextContent('0/0'));
    expect(document.querySelectorAll('.pdf-highlight')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Next match' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(document.getElementById('find-bar')).not.toBeVisible();
    fireEvent.keyDown(window, { key: '/' });
    expect(document.getElementById('find-bar')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Close find' }));
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(document.getElementById('find-bar')).toBeVisible();
  });

  it('leaves single keys alone while typing', async () => {
    render(<Harness />);
    await waitFor(() => expect(lastRender()?.page).toBe(1));
    const box = screen.getByRole('spinbutton', { name: 'Page' });
    fireEvent.keyDown(box, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight', ctrlKey: true });
    expect(lastRender()?.page).toBe(1);
  });

  it('reports fullscreen it cannot have, and toggles it when it can', async () => {
    const notice = vi.fn();
    render(<Harness notice={notice} />);
    await waitFor(() => expect(lastRender()).toBeDefined());
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
    expect(notice).toHaveBeenCalledWith('Fullscreen unavailable');
    const request = vi.fn(async () => {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        value: document.documentElement,
      });
      document.dispatchEvent(new Event('fullscreenchange'));
    });
    document.documentElement.requestFullscreen = request;
    document.exitFullscreen = vi.fn(async () => undefined);
    fireEvent.keyDown(window, { key: 'f' });
    expect(request).toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'Exit fullscreen' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
    expect(document.exitFullscreen).toHaveBeenCalled();
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, value: null });
    document.documentElement.requestFullscreen = vi.fn(async () => {
      throw new Error('denied');
    });
    act(() => document.dispatchEvent(new Event('fullscreenchange')));
    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }));
    await waitFor(() => expect(notice).toHaveBeenCalledWith('Could not enter fullscreen'));
  });

  it('says so when a PDF will not open, and frees a document it no longer shows', async () => {
    const { unmount } = render(<Harness url="/uploads/missing.pdf" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not open this PDF.');
    unmount();
    const view = render(<Harness />);
    await waitFor(() => expect(lastRender()).toBeDefined());
    view.unmount();
    expect(destroyed).toContain(file.url);
  });
});
