// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAG_WATCHDOG_MS, DropZone } from '../src/components/DropZone.tsx';
import { setUpDom } from './dom.tsx';

beforeEach(setUpDom);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const files = [new File(['x'], 'a.pdf')];
const drag = (type: string, withFiles = true) =>
  fireEvent(
    window,
    Object.assign(new Event(type, { bubbles: true, cancelable: true }), {
      dataTransfer: { types: withFiles ? ['Files'] : ['text/plain'], files },
    })
  );
const overlay = () => document.getElementById('dropzone');

describe('the window drop zone', () => {
  it('shows while files are dragged over and hands over a drop', () => {
    const onDrop = vi.fn();
    render(<DropZone onDrop={onDrop} />);
    drag('dragenter');
    expect(overlay()).toHaveClass('is-visible');
    drag('dragover');
    drag('drop');
    expect(overlay()).not.toHaveClass('is-visible');
    expect(onDrop).toHaveBeenCalledWith(files);
  });

  it('hides when the drag leaves, or goes quiet', () => {
    vi.useFakeTimers();
    render(<DropZone onDrop={vi.fn()} />);
    drag('dragenter');
    drag('dragenter');
    drag('dragleave');
    expect(overlay()).toHaveClass('is-visible');
    drag('dragleave');
    expect(overlay()).not.toHaveClass('is-visible');
    drag('dragenter');
    act(() => vi.advanceTimersByTime(DRAG_WATCHDOG_MS + 1));
    expect(overlay()).not.toHaveClass('is-visible');
  });

  it('ignores text drags, and everything while a dialog is open', () => {
    const onDrop = vi.fn();
    render(<DropZone onDrop={onDrop} />);
    drag('dragenter', false);
    drag('dragover', false);
    drag('dragleave', false);
    drag('drop', false);
    expect(overlay()).not.toHaveClass('is-visible');
    const dialog = document.createElement('dialog');
    dialog.setAttribute('open', '');
    document.body.append(dialog);
    drag('dragenter');
    drag('dragover');
    drag('drop');
    expect(overlay()).not.toHaveClass('is-visible');
    expect(onDrop).not.toHaveBeenCalled();
    dialog.remove();
  });
});
