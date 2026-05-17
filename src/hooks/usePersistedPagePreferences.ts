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

export function usePersistedLayoutPreferences(page: 'tracking', authenticated: boolean) {
  const initial = readLayoutFromCookies(page);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(initial.layoutMode);
  const [customCols, setCustomCols] = useState<GridSize>(initial.customCols);
  const [customRows, setCustomRows] = useState<GridSize>(initial.customRows);
  const [showLayoutDropdown, setShowLayoutDropdown] = useState(false);
  const loadedFromDb = useRef(false);
  const prefsReady = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          const merged: LayoutPreferences = {
            layoutMode: dbPrefs.layoutMode ?? initial.layoutMode,
            customCols: dbPrefs.customCols ?? initial.customCols,
            customRows: dbPrefs.customRows ?? initial.customRows,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const initial = readHomepageFromCookies();
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(initial.layoutMode);
  const [customCols, setCustomCols] = useState<GridSize>(initial.customCols);
  const [customRows, setCustomRows] = useState<GridSize>(initial.customRows);
  const [showRecentGames, setShowRecentGames] = useState(initial.showRecentUploads);
  const [showAllGames, setShowAllGames] = useState(initial.showAllGames);
  const [showLayoutDropdown, setShowLayoutDropdown] = useState(false);
  const loadedFromDb = useRef(false);
  const prefsReady = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          const merged: HomepagePreferences = {
            layoutMode: dbPrefs.layoutMode ?? initial.layoutMode,
            customCols: dbPrefs.customCols ?? initial.customCols,
            customRows: dbPrefs.customRows ?? initial.customRows,
            showRecentUploads: dbPrefs.showRecentUploads ?? initial.showRecentUploads,
            showAllGames: dbPrefs.showAllGames ?? initial.showAllGames,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
