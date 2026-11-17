import { Keyboard, Menu, Settings } from 'lucide-react';
import type { ReactNode } from 'react';
import { IconButton } from './Button.tsx';
import { ThemeToggle } from './ThemeToggle.tsx';

export function VersionBadge({ version }: { version: string }) {
  return (
    <span className="hhh-version" title="Running version">
      {version}
    </span>
  );
}

export interface AppBarProps {
  appName: string;
  /** The running version (`1.9.0`, or `dev`); always shown. */
  version: string;
  icon?: ReactNode;
  /** The app's main search; `/` should focus it. */
  search?: ReactNode;
  /** The app's own actions (e.g. Upload), shown before the standard ones. */
  actions?: ReactNode;
  /** Shows the menu button (sidebar as a drawer on narrow screens). */
  onMenu?: () => void;
  menuOpen?: boolean;
  onShortcuts?: () => void;
  onSettings?: () => void;
}

/** The top bar every app uses: menu, brand with version, search, then actions in a fixed order. */
export function AppBar({
  appName,
  version,
  icon,
  search,
  actions,
  onMenu,
  menuOpen = false,
  onShortcuts,
  onSettings,
}: AppBarProps) {
  return (
    <header className="hhh-app-bar">
      {onMenu ? (
        <IconButton
          className="hhh-app-bar__menu"
          label="Toggle navigation"
          aria-expanded={menuOpen}
          icon={<Menu size={20} aria-hidden />}
          onClick={onMenu}
        />
      ) : null}
      <div className="hhh-app-bar__brand">
        {icon ? <span className="hhh-app-bar__icon">{icon}</span> : null}
        <span className="hhh-app-bar__name">{appName}</span>
        <VersionBadge version={version} />
      </div>
      {search ? <div className="hhh-app-bar__search">{search}</div> : null}
      <div className="hhh-app-bar__spacer" />
      <div className="hhh-app-bar__actions">
        {actions}
        {onShortcuts ? (
          <IconButton
            label="Keyboard shortcuts"
            icon={<Keyboard size={18} aria-hidden />}
            onClick={onShortcuts}
          />
        ) : null}
        <ThemeToggle />
        {onSettings ? (
          <IconButton
            label="Settings"
            icon={<Settings size={18} aria-hidden />}
            onClick={onSettings}
          />
        ) : null}
      </div>
    </header>
  );
}
