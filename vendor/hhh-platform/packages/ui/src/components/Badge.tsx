import type { ReactNode } from 'react';

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`hhh-badge hhh-badge--${tone}`}>{children}</span>;
}

export function Spinner({
  size = 'md',
  label = 'Loading',
}: {
  size?: 'sm' | 'md';
  label?: string;
}) {
  return <span className={`hhh-spinner hhh-spinner--${size}`} role="status" aria-label={label} />;
}
