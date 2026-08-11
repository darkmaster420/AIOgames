'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type GridSize,
  type HomepagePreferences,
  type LayoutMode,
  type LayoutPreferences,
  homepageFromDbRecord,
  layoutFromDbRecord,
  readHomepageFromCookies,
  readLayoutFromCookies,
  writeHomepageToCookies,
  writeLayoutToCookies,
} from '../utils/pagePreferences';

const SAVE_DEBOUNCE_MS = 800;

async function patchUserPreferences(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/user/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.warn('[preferences] Failed to save:', await res.text().catch(() => res.statusText));
  }
}

function layoutPayload(prefs: LayoutPreferences) {
  return {
    layoutMode: prefs.layoutMode,
    customCols: prefs.customCols === 'auto' ? 'auto' : prefs.customCols,
    customRows: prefs.customRows === 'auto' ? 'auto' : prefs.customRows,
  };
}

// Hard-coded SSR defaults. We deliberately do NOT seed state from cookies
// at construction time - cookies live on `document`, which only exists in
// the browser, so doing so would make the first client paint diverge from
// the SSR'd HTML and trigger a hydration mismatch. Cookies are applied
// inside a useEffect once we know we're on the client.
const SSR_DEFAULT_LAYOUT: LayoutPreferences = {
  layoutMode: 'grid',
  customCols: 'auto',
  customRows: 'auto',
};

export function usePersistedLayoutPreferences(page: 'tracking', authenticated: boolean) {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(SSR_DEFAULT_LAYOUT.layoutMode);
  const [customCols, setCustomCols] = useState<GridSize>(SSR_DEFAULT_LAYOUT.customCols);
  const [customRows, setCustomRows] = useState<GridSize>(SSR_DEFAULT_LAYOUT.customRows);
  const [showLayoutDropdown, setShowLayoutDropdown] = useState(false);
  const loadedFromDb = useRef(false);
  const prefsReady = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cookies → state, only after mount. This is what users with persisted
  // preferences see on second paint. For authenticated users the DB-load
  // effect below may then layer over these.
  useEffect(() => {
    const cookiePrefs = readLayoutFromCookies(page);
    setLayoutMode(cookiePrefs.layoutMode);
    setCustomCols(cookiePrefs.customCols);
    setCustomRows(cookiePrefs.customRows);
  }, [page]);

  const queueDbSave = useCallback(
    (prefs: LayoutPreferences) => {
      if (!authenticated) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void patchUserPreferences({ tracking: layoutPayload(prefs) });
      }, SAVE_DEBOUNCE_MS);
    },
    [authenticated]
  );

  useEffect(() => {
    if (!authenticated) {
      prefsReady.current = true;
      return;
    }
    if (loadedFromDb.current) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/user/me');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const dbPrefs = layoutFromDbRecord(data.preferences?.tracking);
        if (dbPrefs && !cancelled) {
          loadedFromDb.current = true;
          // Re-read cookies inside the closure so the merge can fall back to
          // whatever the user already had locally when the DB doesn't carry
          // a field (e.g. a new account hasn't saved layoutMode yet).
          const cookiePrefs = readLayoutFromCookies(page);
          const merged: LayoutPreferences = {
            layoutMode: dbPrefs.layoutMode ?? cookiePrefs.layoutMode,
            customCols: dbPrefs.customCols ?? cookiePrefs.customCols,
            customRows: dbPrefs.customRows ?? cookiePrefs.customRows,
          };
          setLayoutMode(merged.layoutMode);
          setCustomCols(merged.customCols);
          setCustomRows(merged.customRows);
          writeLayoutToCookies(page, merged);
        }
      } catch {
        /* non-critical */
      } finally {
        if (!cancelled) prefsReady.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authenticated, page]);

  useEffect(() => {
    if (!prefsReady.current) return;
    const prefs: LayoutPreferences = { layoutMode, customCols, customRows };
    writeLayoutToCookies(page, prefs);
    queueDbSave(prefs);
  }, [layoutMode, customCols, customRows, page, queueDbSave]);

  return {
    layoutMode,
    setLayoutMode,
    customCols,
    setCustomCols,
    customRows,
    setCustomRows,
    showLayoutDropdown,
    setShowLayoutDropdown,
  };
}

export function usePersistedHomepagePreferences(authenticated: boolean) {
  // Same SSR-safe pattern as the layout hook: start from constants so the
  // server-rendered HTML matches the client's first paint, then apply
  // cookies in a useEffect after mount. Reading cookies during render
  // would diverge SSR (document = undefined → defaults) from client
  // (document present → cookie values) and crash hydration.
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(SSR_DEFAULT_LAYOUT.layoutMode);
  const [customCols, setCustomCols] = useState<GridSize>(SSR_DEFAULT_LAYOUT.customCols);
  const [customRows, setCustomRows] = useState<GridSize>(SSR_DEFAULT_LAYOUT.customRows);
  const [showRecentGames, setShowRecentGames] = useState(false);
  const [showAllGames, setShowAllGames] = useState(false);
  const [showLayoutDropdown, setShowLayoutDropdown] = useState(false);
  const loadedFromDb = useRef(false);
  const prefsReady = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cookies → state on mount only. Re-render is unavoidable but the first
  // paint matches SSR so React stays happy.
  useEffect(() => {
    const cookiePrefs = readHomepageFromCookies();
    setLayoutMode(cookiePrefs.layoutMode);
    setCustomCols(cookiePrefs.customCols);
    setCustomRows(cookiePrefs.customRows);
    setShowRecentGames(cookiePrefs.showRecentUploads);
    setShowAllGames(cookiePrefs.showAllGames);
  }, []);

  const queueDbSave = useCallback(
    (prefs: HomepagePreferences) => {
      if (!authenticated) return;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void patchUserPreferences({
          homepage: {
            ...layoutPayload(prefs),
            showRecentUploads: prefs.showRecentUploads,
            showAllGames: prefs.showAllGames,
          },
        });
      }, SAVE_DEBOUNCE_MS);
    },
    [authenticated]
  );

  const snapshot = useCallback(
    (): HomepagePreferences => ({
      layoutMode,
      customCols,
      customRows,
      showRecentUploads: showRecentGames,
      showAllGames,
    }),
    [layoutMode, customCols, customRows, showRecentGames, showAllGames]
  );

  useEffect(() => {
    if (!authenticated) {
      prefsReady.current = true;
      return;
    }
    if (loadedFromDb.current) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch('/api/user/me');
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const dbPrefs = homepageFromDbRecord(data.preferences?.homepage);
        if (dbPrefs && !cancelled) {
          loadedFromDb.current = true;
          // Re-read cookies inside the closure so fields missing from the
          // DB record fall back to the user's local state rather than
          // resetting to defaults.
          const cookiePrefs = readHomepageFromCookies();
          const merged: HomepagePreferences = {
            layoutMode: dbPrefs.layoutMode ?? cookiePrefs.layoutMode,
            customCols: dbPrefs.customCols ?? cookiePrefs.customCols,
            customRows: dbPrefs.customRows ?? cookiePrefs.customRows,
            showRecentUploads: dbPrefs.showRecentUploads ?? cookiePrefs.showRecentUploads,
            showAllGames: dbPrefs.showAllGames ?? cookiePrefs.showAllGames,
          };
          setLayoutMode(merged.layoutMode);
          setCustomCols(merged.customCols);
          setCustomRows(merged.customRows);
          setShowRecentGames(merged.showRecentUploads);
          setShowAllGames(merged.showAllGames);
          writeHomepageToCookies(merged);
        }
      } catch {
        /* non-critical */
      } finally {
        if (!cancelled) prefsReady.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  useEffect(() => {
    if (!prefsReady.current) return;
    const prefs = snapshot();
    writeHomepageToCookies(prefs);
    queueDbSave(prefs);
  }, [snapshot, queueDbSave]);

  const setRecentGamesVisible = useCallback((show: boolean) => {
    setShowRecentGames(show);
  }, []);

  const setShowAllGamesPersisted = useCallback((value: boolean | ((prev: boolean) => boolean)) => {
    setShowAllGames(value);
  }, []);

  return {
    layoutMode,
    setLayoutMode,
    customCols,
    setCustomCols,
    customRows,
    setCustomRows,
    showLayoutDropdown,
    setShowLayoutDropdown,
    showRecentGames,
    setRecentGamesVisible,
    showAllGames,
    setShowAllGames: setShowAllGamesPersisted,
  };
}
