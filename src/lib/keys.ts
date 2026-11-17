/** Mac-like platform: shortcuts read ⌘ instead of Ctrl. */
export function isMac(nav: Navigator = navigator): boolean {
  const data = (nav as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return /mac|iphone|ipad|ipod/i.test(data?.platform || nav.platform || '');
}

/** "⌘K" on a Mac, "Ctrl+K" elsewhere. */
export const modKey = (key: string, mac = isMac()) => (mac ? `⌘${key}` : `Ctrl+${key}`);
