// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandPalette } from '../src/components/CommandPalette.tsx';
import { ShortcutsDialog } from '../src/components/ShortcutsDialog.tsx';
import { isMac, modKey } from '../src/lib/keys.ts';
import { setUpDom } from './dom.tsx';
import { crane } from './factories.ts';

beforeEach(setUpDom);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cranes = [
  crane({ make: 'Liebherr', model: 'LTM1100', capacity: '100t' }, ['Outrigger']),
  crane({ make: 'Tadano', model: 'AC 500', capacity: '500t' }),
  crane({ make: 'Grove', model: 'GMK900', capacity: '900t' }),
];

function open(list = cranes) {
  const props = { onChoose: vi.fn(), onClose: vi.fn() };
  render(<CommandPalette cranes={list} {...props} />);
  return { ...props, input: screen.getByRole('combobox', { name: 'Jump to a crane' }) };
}

const titles = () =>
  screen.getAllByRole('option').map((o) => o.querySelector('.palette__result-title')?.textContent);

describe('the command palette', () => {
  it('lists every crane, focused and ready to type', () => {
    const { input } = open();
    expect(document.activeElement).toBe(input);
    expect(titles()).toEqual(['Liebherr LTM1100', 'Tadano AC 500', 'Grove GMK900']);
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('100t · Mobile · 2 files');
  });

  it('matches every word, labels included, and capacity queries smallest first', () => {
    const { input } = open();
    fireEvent.change(input, { target: { value: 'lieb outrigger' } });
    expect(titles()).toEqual(['Liebherr LTM1100']);
    fireEvent.change(input, { target: { value: '>=400' } });
    expect(titles()).toEqual(['Tadano AC 500', 'Grove GMK900']);
    fireEvent.change(input, { target: { value: 'nothing' } });
    expect(screen.getByText('No cranes match.')).toBeInTheDocument();
  });

  it('moves with the arrows and opens with Enter or a click', () => {
    const { input, onChoose } = open();
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(screen.getAllByRole('option')[2]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChoose).toHaveBeenCalledWith(cranes[1]);
    fireEvent.mouseMove(screen.getAllByRole('option')[0] as HTMLElement);
    fireEvent.click(screen.getAllByRole('option')[0] as HTMLElement);
    expect(onChoose).toHaveBeenLastCalledWith(cranes[0]);
    fireEvent.keyDown(input, { key: 'x' });
  });

  it('says when there are no cranes, and Enter then does nothing', () => {
    const { input, onChoose } = open([]);
    expect(screen.getByText('No cranes yet.')).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChoose).not.toHaveBeenCalled();
  });
});

describe('keys', () => {
  it('names the modifier for the platform', () => {
    expect(modKey('K', true)).toBe('⌘K');
    expect(modKey('K', false)).toBe('Ctrl+K');
    expect(isMac({ platform: 'MacIntel' } as Navigator)).toBe(true);
    expect(isMac({ platform: 'Win32' } as Navigator)).toBe(false);
    expect(
      isMac({ platform: '', userAgentData: { platform: 'macOS' } } as unknown as Navigator)
    ).toBe(true);
  });

  it('lists the shortcuts', () => {
    render(<ShortcutsDialog mac={false} onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toHaveTextContent(
      'Find a craneCtrl+K'
    );
  });
});
