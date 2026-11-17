// The design tokens: the one source of every colour, size and timing the apps use.
// styles/tokens.css is generated from this file (npm run tokens) and must not be
// edited by hand; a test fails if the two drift apart. Values and the contrast
// rules are set in the HuttonHomeHub App Standard, "Design system".

export const THEMES = ['light', 'dark'] as const;
export type ThemeName = (typeof THEMES)[number];

export interface ColorTokens {
  'bg-canvas': string;
  'bg-surface': string;
  'bg-surface-raised': string;
  'bg-surface-sunken': string;
  'bg-overlay': string;
  'bg-input': string;
  'bg-input-focus': string;
  'fg-primary': string;
  'fg-secondary': string;
  'fg-tertiary': string;
  'fg-inverse': string;
  'border-subtle': string;
  'border-default': string;
  'border-strong': string;
  accent: string;
  'accent-hover': string;
  'accent-active': string;
  'accent-fg': string;
  'accent-muted-bg': string;
  'accent-muted-border': string;
  'success-fg': string;
  'success-bg': string;
  'success-border': string;
  'warning-fg': string;
  'warning-bg': string;
  'warning-border': string;
  'danger-fg': string;
  'danger-bg': string;
  'danger-border': string;
  'info-fg': string;
  'info-bg': string;
  'info-border': string;
  'shadow-xs': string;
  'shadow-sm': string;
  'shadow-md': string;
  'shadow-lg': string;
  'shadow-xl': string;
  'shadow-focus': string;
}

/** Light: Crane Charts' greys with the shared deeper orange. Dark: PhotoMapper's navy. */
export const colors: Record<ThemeName, ColorTokens> = {
  light: {
    'bg-canvas': '#FAFAFA',
    'bg-surface': '#FFFFFF',
    'bg-surface-raised': '#F4F4F5',
    'bg-surface-sunken': '#E4E4E7',
    'bg-overlay': 'rgba(24, 24, 27, 0.50)',
    'bg-input': '#FFFFFF',
    'bg-input-focus': '#FFFFFF',
    'fg-primary': '#18181B',
    'fg-secondary': '#52525B',
    'fg-tertiary': '#63636B',
    'fg-inverse': '#FAFAFA',
    'border-subtle': '#E4E4E7',
    'border-default': '#D4D4D8',
    'border-strong': '#A1A1AA',
    accent: '#C2410C',
    'accent-hover': '#9A3412',
    'accent-active': '#7C2D12',
    'accent-fg': '#FFFFFF',
    'accent-muted-bg': 'rgba(194, 65, 12, 0.10)',
    'accent-muted-border': 'rgba(194, 65, 12, 0.28)',
    'success-fg': '#15803D',
    'success-bg': 'rgba(34, 197, 94, 0.10)',
    'success-border': 'rgba(34, 197, 94, 0.30)',
    'warning-fg': '#B45309',
    'warning-bg': 'rgba(217, 119, 6, 0.10)',
    'warning-border': 'rgba(217, 119, 6, 0.30)',
    'danger-fg': '#B91C1C',
    'danger-bg': 'rgba(239, 68, 68, 0.10)',
    'danger-border': 'rgba(239, 68, 68, 0.30)',
    'info-fg': '#1D4ED8',
    'info-bg': 'rgba(59, 130, 246, 0.10)',
    'info-border': 'rgba(59, 130, 246, 0.30)',
    'shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.04)',
    'shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.06), 0 1px 3px rgba(0, 0, 0, 0.08)',
    'shadow-md': '0 4px 6px rgba(0, 0, 0, 0.05), 0 2px 4px rgba(0, 0, 0, 0.06)',
    'shadow-lg': '0 10px 15px rgba(0, 0, 0, 0.08), 0 4px 6px rgba(0, 0, 0, 0.05)',
    'shadow-xl': '0 20px 25px rgba(0, 0, 0, 0.10), 0 10px 10px rgba(0, 0, 0, 0.04)',
    'shadow-focus': '0 0 0 3px rgba(194, 65, 12, 0.25)',
  },
  dark: {
    'bg-canvas': '#1A1A2E',
    'bg-surface': '#16213E',
    'bg-surface-raised': '#1A2545',
    'bg-surface-sunken': '#0F1B35',
    'bg-overlay': 'rgba(10, 10, 26, 0.72)',
    'bg-input': '#0F1B35',
    'bg-input-focus': '#162040',
    'fg-primary': '#E0E0E0',
    'fg-secondary': '#CCCCCC',
    'fg-tertiary': '#8A9BB7',
    'fg-inverse': '#1A1A2E',
    'border-subtle': 'rgba(15, 52, 96, 0.5)',
    'border-default': '#0F3460',
    'border-strong': '#2A4A7A',
    accent: '#E97B25',
    'accent-hover': '#D96E1A',
    'accent-active': '#C2610F',
    'accent-fg': '#1A1A2E',
    'accent-muted-bg': 'rgba(233, 123, 37, 0.12)',
    'accent-muted-border': 'rgba(233, 123, 37, 0.30)',
    'success-fg': '#06D6A0',
    'success-bg': 'rgba(6, 214, 160, 0.12)',
    'success-border': 'rgba(6, 214, 160, 0.30)',
    'warning-fg': '#FFB703',
    'warning-bg': 'rgba(255, 183, 3, 0.12)',
    'warning-border': 'rgba(255, 183, 3, 0.30)',
    'danger-fg': '#F87171',
    'danger-bg': 'rgba(248, 113, 113, 0.12)',
    'danger-border': 'rgba(248, 113, 113, 0.30)',
    'info-fg': '#4A90FF',
    'info-bg': 'rgba(74, 144, 255, 0.12)',
    'info-border': 'rgba(74, 144, 255, 0.30)',
    'shadow-xs': '0 1px 2px rgba(0, 0, 0, 0.40)',
    'shadow-sm': '0 2px 4px rgba(0, 0, 0, 0.40), 0 1px 2px rgba(0, 0, 0, 0.30)',
    'shadow-md': '0 4px 8px rgba(0, 0, 0, 0.45), 0 2px 4px rgba(0, 0, 0, 0.35)',
    'shadow-lg': '0 12px 24px rgba(0, 0, 0, 0.55), 0 4px 8px rgba(0, 0, 0, 0.40)',
    'shadow-xl': '0 24px 48px rgba(0, 0, 0, 0.65), 0 8px 16px rgba(0, 0, 0, 0.45)',
    'shadow-focus': '0 0 0 3px rgba(233, 123, 37, 0.35)',
  },
};

/** Theme-independent tokens (Crane Charts' scales; the type scale is new). */
export const scale: Record<string, string> = {
  'font-sans':
    "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  'font-mono': "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
  'text-xs': '12px',
  'text-sm': '13px',
  'text-base': '14px',
  'text-md': '16px',
  'text-lg': '20px',
  'text-xl': '24px',
  'leading-tight': '1.25',
  'leading-normal': '1.5',
  'weight-regular': '400',
  'weight-medium': '500',
  'weight-semibold': '600',
  'space-1': '4px',
  'space-2': '8px',
  'space-3': '12px',
  'space-4': '16px',
  'space-5': '20px',
  'space-6': '24px',
  'space-8': '32px',
  'space-10': '40px',
  'space-12': '48px',
  'space-16': '64px',
  'radius-xs': '2px',
  'radius-sm': '4px',
  'radius-md': '6px',
  'radius-lg': '10px',
  'radius-xl': '14px',
  'radius-pill': '9999px',
  'ease-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
  'ease-in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
  'dur-fast': '120ms',
  'dur-base': '180ms',
  'dur-slow': '240ms',
  'z-sticky': '100',
  'z-app-bar': '200',
  'z-drawer': '300',
  'z-toolbar': '400',
  'z-dropzone': '700',
  'z-modal': '800',
  'z-toast': '900',
  'app-bar-h': '56px',
  'control-h-sm': '28px',
  'control-h-md': '36px',
  'focus-ring-width': '2px',
  'touch-target': '40px',
};

/** Breakpoints in px. CSS can't use custom properties in media queries, so components
 * import these numbers; tokens.css also exposes them for scripts via getComputedStyle. */
export const breakpoints = { mobile: 640, tablet: 900 } as const;

/**
 * Text/background pairs that must reach WCAG AA (4.5:1) in both themes. Accent and
 * status text only ever sit on canvas, surface or raised backgrounds, never on sunken
 * ones (wells and inputs): that rule is part of the standard.
 */
export const CONTRAST_MIN = 4.5;
const NEUTRAL_TEXT = ['fg-primary', 'fg-secondary', 'fg-tertiary'] as const;
const COLOURED_TEXT = ['accent', 'success-fg', 'warning-fg', 'danger-fg', 'info-fg'] as const;
const ALL_BG = ['bg-canvas', 'bg-surface', 'bg-surface-raised', 'bg-surface-sunken'] as const;
const OPEN_BG = ['bg-canvas', 'bg-surface', 'bg-surface-raised'] as const;

export const textPairs: ReadonlyArray<readonly [keyof ColorTokens, keyof ColorTokens]> = [
  ...NEUTRAL_TEXT.flatMap((fg) => ALL_BG.map((bg) => [fg, bg] as const)),
  ...COLOURED_TEXT.flatMap((fg) => OPEN_BG.map((bg) => [fg, bg] as const)),
  ['accent-fg', 'accent'],
  ['accent-fg', 'accent-hover'],
];
