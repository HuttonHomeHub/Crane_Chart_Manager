import { Moon, Sun } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import {
  applyThemeChoice,
  effectiveTheme,
  nextTheme,
  readThemeChoice,
  type ThemeChoice,
} from '../theme.ts';
import { IconButton } from './Button.tsx';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function safeStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function subscribeToSystem(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

/** Whether the system asks for dark, kept live as the setting changes. */
export function useSystemPrefersDark(): boolean {
  return useSyncExternalStore(subscribeToSystem, systemPrefersDark, () => false);
}

/**
 * Flips between light and dark, starting from what's shown now (the system setting
 * until the user picks). The icon shows the theme you'll switch to.
 */
export function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(() => readThemeChoice(safeStorage()));
  const prefersDark = useSystemPrefersDark();
  const target = nextTheme(choice, prefersDark);
  const shown = effectiveTheme(choice, prefersDark);
  return (
    <IconButton
      label={`Switch to ${target} theme`}
      icon={shown === 'dark' ? <Sun size={18} aria-hidden /> : <Moon size={18} aria-hidden />}
      onClick={() => {
        applyThemeChoice(target, document.documentElement, safeStorage());
        setChoice(target);
      }}
    />
  );
}
