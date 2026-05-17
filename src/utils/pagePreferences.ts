export type LayoutMode = 'grid' | 'horizontal';
export type GridSize = number | 'auto';
export type PageKey = 'homepage' | 'tracking';

export interface LayoutPreferences {
  layoutMode: LayoutMode;
  customCols: GridSize;
  customRows: GridSize;
}

export interface HomepagePreferences extends LayoutPreferences {
  showRecentUploads: boolean;
  showAllGames: boolean;
}

export interface TrackingPreferences extends LayoutPreferences {}

const COOKIE_KEYS: Record<PageKey, Record<string, string>> = {
  homepage: {
    layoutMode: 'homepageLayoutMode',
    customCols: 'homepageCustomCols',
    customRows: 'homepageCustomRows',
    showRecentUploads: 'showRecentGames',
    showAllGames: 'homepageShowAllGames',
  },
  tracking: {
    layoutMode: 'trackingLayoutMode',
    customCols: 'trackingCustomCols',
    customRows: 'trackingCustomRows',
  },
};

export function getCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const value = document.cookie
    .split('; ')
    .find(row => row.startsWith(`${name}=`))
    ?.split('=')[1];
  return value ? decodeURIComponent(value) : null;
}

export function setCookie(name: string, value: string, days = 365): void {
  if (typeof document === 'undefined') return;
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/`;
}

export function parseGridSize(raw: string | null | undefined): GridSize {
  if (!raw || raw === 'auto') return 'auto';
  const n = Number(raw);
  if (!Number.isNaN(n) && n >= 1 && n <= 12) return n;
  return 'auto';
}

export function gridSizeToCookie(value: GridSize): string {
  return value === 'auto' ? 'auto' : String(value);
}

export function parseLayoutMode(raw: string | null | undefined): LayoutMode {
  return raw === 'horizontal' ? 'horizontal' : 'grid';
}

export function readLayoutFromCookies(page: PageKey): LayoutPreferences {
  const keys = COOKIE_KEYS[page];
  return {
    layoutMode: parseLayoutMode(getCookie(keys.layoutMode)),
    customCols: parseGridSize(getCookie(keys.customCols)),
    customRows: parseGridSize(getCookie(keys.customRows)),
  };
}

export function writeLayoutToCookies(page: PageKey, prefs: LayoutPreferences): void {
  const keys = COOKIE_KEYS[page];
  setCookie(keys.layoutMode, prefs.layoutMode);
  setCookie(keys.customCols, gridSizeToCookie(prefs.customCols));
  setCookie(keys.customRows, gridSizeToCookie(prefs.customRows));
}

export function readHomepageFromCookies(): HomepagePreferences {
  const layout = readLayoutFromCookies('homepage');
  const keys = COOKIE_KEYS.homepage;
  return {
    ...layout,
    showRecentUploads: getCookie(keys.showRecentUploads) === 'true',
    showAllGames: getCookie(keys.showAllGames) === 'true',
  };
}

export function writeHomepageToCookies(prefs: Partial<HomepagePreferences>): void {
  if (prefs.layoutMode !== undefined || prefs.customCols !== undefined || prefs.customRows !== undefined) {
    writeLayoutToCookies('homepage', {
      layoutMode: prefs.layoutMode ?? readLayoutFromCookies('homepage').layoutMode,
      customCols: prefs.customCols ?? readLayoutFromCookies('homepage').customCols,
      customRows: prefs.customRows ?? readLayoutFromCookies('homepage').customRows,
    });
  }
  const keys = COOKIE_KEYS.homepage;
  if (typeof prefs.showRecentUploads === 'boolean') {
    // Short TTL for recent visibility (matches prior behavior)
    setCookie(keys.showRecentUploads, prefs.showRecentUploads ? 'true' : 'false', 1 / 24);
  }
  if (typeof prefs.showAllGames === 'boolean') {
    setCookie(keys.showAllGames, prefs.showAllGames ? 'true' : 'false');
  }
}

export function buildCustomGridStyle(
  layoutMode: LayoutMode,
  customCols: GridSize,
  customRows: GridSize
): Record<string, string> | undefined {
  if (layoutMode !== 'grid') return undefined;
  const style: Record<string, string> = { display: 'grid', gap: '1rem' };
  if (customCols !== 'auto') {
    style.gridTemplateColumns = `repeat(${customCols}, minmax(0, 1fr))`;
  }
  if (customRows !== 'auto') {
    style.gridTemplateRows = `repeat(${customRows}, minmax(0, 1fr))`;
  }
  return style;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function layoutFromDbRecord(raw: any): Partial<LayoutPreferences> | null {
  if (!raw || typeof raw !== 'object') return null;
  const out: Partial<LayoutPreferences> = {};
  if (raw.layoutMode === 'grid' || raw.layoutMode === 'horizontal') {
    out.layoutMode = raw.layoutMode;
  }
  if (raw.customCols === 'auto' || raw.customCols === null || raw.customCols === undefined) {
    out.customCols = 'auto';
  } else {
    const n = Number(raw.customCols);
    if (!Number.isNaN(n) && n >= 1 && n <= 12) out.customCols = n;
  }
  if (raw.customRows === 'auto' || raw.customRows === null || raw.customRows === undefined) {
    out.customRows = 'auto';
  } else {
    const n = Number(raw.customRows);
    if (!Number.isNaN(n) && n >= 1 && n <= 12) out.customRows = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function homepageFromDbRecord(raw: any): Partial<HomepagePreferences> | null {
  const layout = layoutFromDbRecord(raw);
  if (!raw || typeof raw !== 'object') return layout;
  const out: Partial<HomepagePreferences> = { ...(layout || {}) };
  if (typeof raw.showRecentUploads === 'boolean') out.showRecentUploads = raw.showRecentUploads;
  if (typeof raw.showAllGames === 'boolean') out.showAllGames = raw.showAllGames;
  return Object.keys(out).length > 0 ? out : null;
}
