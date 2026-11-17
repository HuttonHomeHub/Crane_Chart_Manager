// Theme choice: follow the system setting until the user picks light or dark; the
// pick is remembered per app in localStorage ('hhh.theme') and applied as
// <html data-theme>. With no pick, tokens.css follows prefers-color-scheme on its own,
// so the page never flashes the wrong theme. theme-init.js applies a stored pick
// before first paint; this module is what the theme toggle calls.
import type { ThemeName } from './tokens.ts';

export const THEME_STORAGE_KEY = 'hhh.theme';
export type ThemeChoice = ThemeName | 'system';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
interface RootLike {
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

export function readThemeChoice(storage: StorageLike | undefined): ThemeChoice {
  try {
    const value = storage?.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system'; // storage blocked (private mode, policy): follow the system
  }
}

export function applyThemeChoice(
  choice: ThemeChoice,
  root: RootLike,
  storage: StorageLike | undefined
): void {
  if (choice === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', choice);
  try {
    if (choice === 'system') storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, choice);
  } catch {
    // the choice still applies for this page view
  }
}

/** What the page shows right now: the pick, or the system setting when there is none. */
export function effectiveTheme(choice: ThemeChoice, systemPrefersDark: boolean): ThemeName {
  if (choice !== 'system') return choice;
  return systemPrefersDark ? 'dark' : 'light';
}

/** The toggle flips between light and dark, starting from what is shown now. */
export function nextTheme(choice: ThemeChoice, systemPrefersDark: boolean): ThemeName {
  return effectiveTheme(choice, systemPrefersDark) === 'dark' ? 'light' : 'dark';
}
