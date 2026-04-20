'use client';

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { GamePosterCard } from '../components/GamePosterCard';
import { AddCustomGame } from '../components/AddCustomGame';
import { useNotification } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { SITES } from '../lib/sites';
import { cleanGameTitle, buildSteamSearchQueryVariants } from '../utils/steamApi';
import { calculateGameSimilarity } from '../utils/titleMatching';

type TrackedGameInfo = {
  trackedId: string;
  gameId: string;
  version: string;
  priority: number;
  fullTitle: string;
};

type TrackState = {
  isExactTracked: boolean;
  hasTrackedVariant: boolean;
  trackedVersion?: string;
  trackedLabel?: string;
};

type Game = {
  id: string;
  originalId?: string | number; // Optional since some APIs might not include it
  title: string;
  originalTitle?: string; // Raw post title for advanced view
  description: string;
  source: string;
  siteType: string;
  link: string;
  image: string;
  date?: string;
  appid?: number | string;
  appId?: number | string;
  steamAppId?: number | string;
  steam_appid?: number | string;
  downloadLinks?: Array<{ url: string; label?: string; service?: string }>;
};

type DisplayGame = Game & {
  displayKey: string;
  postCount: number;
};

type SteamSearchResult = {
  appid: string;
  name: string;
};

function DashboardInner() {
  const [searchQuery, setSearchQuery] = useState('');
  const [siteFilter, setSiteFilter] = useState('all');
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackedGames, setTrackedGames] = useState<Set<string>>(new Set());
  const [trackedGamesById, setTrackedGamesById] = useState<Map<string, TrackedGameInfo>>(new Map());
  const [trackedTitles, setTrackedTitles] = useState<Map<string, TrackedGameInfo[]>>(new Map());
  const { status } = useSession();
  const notify = useNotification();
  const { confirm } = useConfirm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [refineText, setRefineText] = useState('');
  const [showRefine, setShowRefine] = useState(false);
  const [showRecentGames, setShowRecentGames] = useState(false);
  const [resolvedAppIds, setResolvedAppIds] = useState<Record<string, string | null>>({});
  const [steamAppIdByTitleCache, setSteamAppIdByTitleCache] = useState<Record<string, string | null>>({});
  const [showAllGames, setShowAllGames] = useState(false);

  // AbortController for the main games fetches (recent/search). Cancels in-flight
  // requests when the component unmounts (e.g. user navigates to an appid page)
  // or when a newer fetch supersedes an older one, so we don't hog browser
  // connection slots or keep the server busy on work whose result is discarded.
  const fetchAbortRef = useRef<AbortController | null>(null);
  const enrichTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginFetch = useCallback(() => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    return controller.signal;
  }, []);

  useEffect(() => {
    return () => {
      fetchAbortRef.current?.abort();
      if (enrichTimeoutRef.current) clearTimeout(enrichTimeoutRef.current);
    };
  }, []);

  // Function to update URL parameters
  const updateURL = useCallback((search?: string, site?: string, refine?: string) => {
    const params = new URLSearchParams();
    
    if (search && search.trim()) {
      params.set('search', search.trim());
    }
    
    if (site && site !== 'all') {
      params.set('site', site);
    }
    
    if (refine && refine.trim()) {
      params.set('refine', refine.trim());
    }
    
    const newURL = params.toString() ? `/?${params.toString()}` : '/';
    router.replace(newURL, { scroll: false });
  }, [router]);

  // Load initial values from URL
  useEffect(() => {
    const urlSearch = searchParams.get('search') || '';
    const urlSite = searchParams.get('site') || 'all';
    const urlRefine = searchParams.get('refine') || '';
    
    setSearchQuery(urlSearch);
    setSiteFilter(urlSite);
    setRefineText(urlRefine);
    
    // If there's a search query in the URL, perform the search after state is set
    if (urlSearch.trim()) {
      // Use a minimal delay to ensure state updates are complete
      const timer = setTimeout(() => {
        const performInitialSearch = async () => {
          const signal = beginFetch();
          setLoading(true);
          setError(null);
          try {
            const params = new URLSearchParams({ search: urlSearch });
            if (urlSite !== 'all') {
              params.set('site', urlSite);
            }
            if (urlRefine.trim()) {
              params.set('refine', urlRefine);
            }
            const response = await fetch(`/api/games/search?${params}`, { cache: 'no-store', signal });
            if (!response.ok) {
              throw new Error('Failed to search games');
            }
            const data = await response.json();
            if (signal.aborted) return;
            setGames(data);
            setShowRefine(true);
            setRecentGamesCookie(true);
          } catch (err) {
            if ((err as { name?: string })?.name === 'AbortError') return;
            setError(err instanceof Error ? err.message : 'Failed to search games');
            setGames([]);
          } finally {
            if (!signal.aborted) setLoading(false);
          }
        };
        performInitialSearch();
      }, 50);

      return () => clearTimeout(timer);
    }
  }, [searchParams, beginFetch]);

  // Function to set cookie with 1 hour expiration
  const setRecentGamesCookie = (show: boolean) => {
    const expires = new Date();
    expires.setTime(expires.getTime() + (60 * 60 * 1000)); // 1 hour
    document.cookie = `showRecentGames=${show}; expires=${expires.toUTCString()}; path=/`;
    setShowRecentGames(show);
  };



  // Load tracked games from localStorage or API
  const loadTrackedGames = useCallback(async () => {
    if (status === 'authenticated') {
      try {
        const response = await fetch('/api/tracking');
        if (response.ok) {
          const data = await response.json();
          const trackedGameIds = new Set<string>(data.games.map((game: { gameId: string }) => String(game.gameId)));
          setTrackedGames(trackedGameIds);
          const idMap = new Map<string, TrackedGameInfo>();
          
          // Store cleaned titles -> array of tracked game info for cross-version matching with priority
          const titleMap = new Map<string, TrackedGameInfo[]>();
          for (const game of data.games) {
            const cleaned = cleanGameTitle(game.title || game.originalTitle || '');
            if (cleaned) {
              const info: TrackedGameInfo = {
                trackedId: game._id,
                gameId: game.gameId,
                version: game.lastKnownVersion || '',
                priority: game.priority || 2,
                fullTitle: game.title || game.originalTitle || ''
              };
              idMap.set(String(game.gameId), info);
              
              if (!titleMap.has(cleaned)) {
                titleMap.set(cleaned, []);
              }
              titleMap.get(cleaned)!.push(info);
            }
          }
          setTrackedGamesById(idMap);
          setTrackedTitles(titleMap);
        }
      } catch (error) {
        console.error('Failed to load tracked games:', error);
      }
    }
  }, [status]);

  // Load recent games (default view). No client cache — always ask the server,
  // which serves from its own in-memory cache or re-scrapes as needed.
  const loadRecentGames = useCallback(async (forceRefresh = false) => {
    const signal = beginFetch();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (forceRefresh) params.set('refresh', 'true');
      const response = await fetch(`/api/games/recent?${params}`, { cache: 'no-store', signal });
      if (!response.ok) {
        throw new Error('Failed to fetch recent games');
      }
      const data = await response.json();
      if (signal.aborted) return;
      setGames(data);

      // If images are still being enriched in background, auto-refresh after a delay
      const pendingImages = parseInt(response.headers.get('X-Pending-Images') || '0', 10);
      if (pendingImages > 0) {
        if (enrichTimeoutRef.current) clearTimeout(enrichTimeoutRef.current);
        enrichTimeoutRef.current = setTimeout(async () => {
          // Don't start a follow-up fetch if the user already navigated away or
          // kicked off a newer fetch.
          if (signal.aborted) return;
          try {
            const refreshResp = await fetch('/api/games/recent', { cache: 'no-store', signal });
            if (refreshResp.ok && !signal.aborted) {
              const refreshData = await refreshResp.json();
              if (!signal.aborted) setGames(refreshData);
            }
          } catch { /* silent retry / abort */ }
        }, Math.min(pendingImages * 400, 15000));
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to fetch recent games');
      setGames([]);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [beginFetch]);

  // Search games handler
  const searchGames = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) {
      setRecentGamesCookie(false);
      updateURL(); // Clear URL parameters
      loadRecentGames();
      return;
    }

    // Update URL with current search parameters
    updateURL(searchQuery, siteFilter, refineText);

    const signal = beginFetch();
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ search: searchQuery });
      if (siteFilter !== 'all') {
        params.set('site', siteFilter);
      }
      if (refineText.trim()) {
        params.set('refine', refineText);
      }
      const response = await fetch(`/api/games/search?${params}`, { cache: 'no-store', signal });
      if (!response.ok) {
        throw new Error('Failed to search games');
      }
      const data = await response.json();
      if (signal.aborted) return;
      setGames(data);
      setShowRefine(true);
      setRecentGamesCookie(true);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to search games');
      setGames([]);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [searchQuery, siteFilter, refineText, loadRecentGames, updateURL, beginFetch]);

  // Load recent games on mount and check cookie/user preference for visibility
  useEffect(() => {
    const recentGamesVisible = document.cookie
      .split('; ')
      .find(row => row.startsWith('showRecentGames='))
      ?.split('=')[1] === 'true';
    
    setShowRecentGames(recentGamesVisible);
    loadRecentGames(); // Always load games, but visibility is controlled by state
    
    // Fetch user preference for always showing recent uploads
    if (status === 'authenticated') {
      fetch('/api/user/me')
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data?.preferences?.homepage?.showRecentUploads) {
            setShowRecentGames(true);
          }
        })
        .catch(() => {}); // Silently ignore errors
    }
  }, [loadRecentGames, status]);

  // Load tracked games when authentication status changes
  useEffect(() => {
    loadTrackedGames();
  }, [loadTrackedGames]);

    const getTrackState = useCallback((game: Game): TrackState => {
      const cleaned = cleanGameTitle(game.title);
      const exactTracked = trackedGamesById.get(game.id);
      
      // Exact ID match
      if (trackedGames.has(game.id) && exactTracked) {
        return {
          isExactTracked: true,
          hasTrackedVariant: false,
          trackedVersion: exactTracked.version || undefined,
          trackedLabel: exactTracked.version ? `Tracking ${exactTracked.version}` : 'Tracked'
        };
      }
      
      if (!cleaned) {
        return { isExactTracked: false, hasTrackedVariant: false };
      }
      
      const exactMatches = trackedTitles.get(cleaned);
      if (exactMatches && exactMatches.length > 0) {
        const sorted = [...exactMatches].sort((a, b) => a.priority - b.priority);
        const best = sorted[0];
        return {
          isExactTracked: false,
          hasTrackedVariant: true,
          trackedVersion: best.version || undefined,
          trackedLabel: best.version ? `Tracking another version (${best.version})` : 'Tracking another version'
        };
      }
      
      return { isExactTracked: false, hasTrackedVariant: false };
    }, [trackedGames, trackedGamesById, trackedTitles]);

    const extractAppId = useCallback((game: Game): string | null => {
      const candidates = [game.appid, game.appId, game.steamAppId, game.steam_appid];
      for (const candidate of candidates) {
        if (candidate === undefined || candidate === null) continue;
        const value = String(candidate).trim();
        if (/^\d+$/.test(value)) return value;
      }
      return null;
    }, []);

    const resolveAppIdFromCleanTitle = useCallback(async (cleanTitle: string): Promise<string | null> => {
      if (!cleanTitle || cleanTitle.length < 2) {
        return null;
      }

      try {
        const variants = buildSteamSearchQueryVariants(cleanTitle);
        const allResults: SteamSearchResult[] = [];

        for (const query of variants) {
          const params = new URLSearchParams({ action: 'search', q: query });
          const response = await fetch(`/api/steam?${params.toString()}`);
          if (!response.ok) continue;

          const payload = await response.json();
          const results: SteamSearchResult[] = Array.isArray(payload?.results) ? payload.results : [];
          for (const r of results) {
            if (!allResults.some(existing => String(existing.appid) === String(r.appid))) {
              allResults.push(r);
            }
          }
          if (allResults.length > 0) break;
        }

        if (allResults.length === 0) {
          return null;
        }

        const best = allResults
          .slice(0, 8)
          .map((result) => {
            const score = calculateGameSimilarity(cleanTitle, result.name || '');
            const exactBonus = cleanGameTitle(result.name || '') === cleanTitle ? 0.2 : 0;
            return {
              appid: String(result.appid),
              score: score + exactBonus,
            };
          })
          .sort((a, b) => b.score - a.score)[0];

        if (best && best.score >= 0.45) {
          return best.appid;
        }

        return null;
      } catch {
        return null;
      }
    }, []);

    const displayGames = useMemo(() => {
      const refinedGames = games.filter((game) => {
        if (refineText.trim()) {
          const searchText = refineText.toLowerCase();
          return game.title.toLowerCase().includes(searchText) ||
                 game.description.toLowerCase().includes(searchText);
        }
        return true;
      });

      const grouped = new Map<string, DisplayGame>();
      const isRecentUploads = !searchQuery.trim();

      for (const game of refinedGames) {
        const appId = extractAppId(game);
        const cleanedTitle = cleanGameTitle(game.originalTitle || game.title || '').toLowerCase();
        const groupKey = isRecentUploads
          ? (appId ? `appid:${appId}` : `title:${cleanedTitle || game.id}`)
          : game.id;

        const existing = grouped.get(groupKey);

        if (!isRecentUploads || !existing) {
          grouped.set(groupKey, { ...game, displayKey: groupKey, postCount: 1 });
          continue;
        }

        const candidateDate = game.date ? new Date(game.date).getTime() : 0;
        const existingDate = existing?.date ? new Date(existing.date).getTime() : 0;
        const candidateHasImage = Boolean(game.image);
        const existingHasImage = Boolean(existing?.image);

        const PREFERRED_SOURCES = ['skidrowreloaded', 'skidrow'];
        const candidatePreferred = PREFERRED_SOURCES.some(s => (game.source || '').toLowerCase().includes(s) || (game.siteType || '').toLowerCase().includes(s));
        const existingPreferred = existing ? PREFERRED_SOURCES.some(s => (existing.source || '').toLowerCase().includes(s) || (existing.siteType || '').toLowerCase().includes(s)) : false;

        const shouldReplace =
          // Preferred source always wins over non-preferred regardless of date
          (candidatePreferred && !existingPreferred) ||
          // Among same preference tier, newer date wins
          (!candidatePreferred && existingPreferred ? false :
            (candidateDate > existingDate) ||
            (candidateDate === existingDate && candidateHasImage && !existingHasImage));

        if (shouldReplace) {
          grouped.set(groupKey, {
            ...game,
            displayKey: groupKey,
            postCount: existing.postCount + 1,
          });
        } else {
          grouped.set(groupKey, {
            ...existing,
            postCount: existing.postCount + 1,
          });
        }
      }

      return Array.from(grouped.values()).sort((a, b) => {
        const dateA = a.date ? new Date(a.date).getTime() : 0;
        const dateB = b.date ? new Date(b.date).getTime() : 0;
        return dateB - dateA;
      });
    }, [games, refineText, extractAppId, searchQuery]);

    useEffect(() => {
      if (displayGames.length === 0) {
        setResolvedAppIds(prev => (Object.keys(prev).length === 0 ? prev : {}));
        return;
      }

      const activeDisplayKeys = new Set(displayGames.map(game => game.displayKey));
      setResolvedAppIds(prev => {
        const next: Record<string, string | null> = {};
        for (const [key, value] of Object.entries(prev)) {
          if (activeDisplayKeys.has(key)) {
            next[key] = value;
          }
        }
        const sameSize = Object.keys(next).length === Object.keys(prev).length;
        const unchanged = sameSize && Object.entries(next).every(([key, value]) => prev[key] === value);
        return unchanged ? prev : next;
      });

      let cancelled = false;

      const resolveMissingAppIds = async () => {
        for (const game of displayGames) {
          const nativeAppId = extractAppId(game);
          if (nativeAppId) {
            setResolvedAppIds(prev => (prev[game.displayKey] === nativeAppId ? prev : { ...prev, [game.displayKey]: nativeAppId }));
            continue;
          }

          if (resolvedAppIds[game.displayKey] !== undefined) {
            continue;
          }

          const cleanTitle = cleanGameTitle(game.originalTitle || game.title || '').trim();
          if (!cleanTitle) {
            setResolvedAppIds(prev => (prev[game.displayKey] === null ? prev : { ...prev, [game.displayKey]: null }));
            continue;
          }

          if (steamAppIdByTitleCache[cleanTitle] !== undefined) {
            const cachedValue = steamAppIdByTitleCache[cleanTitle];
            setResolvedAppIds(prev => (prev[game.displayKey] === cachedValue ? prev : { ...prev, [game.displayKey]: cachedValue }));
            continue;
          }

          const appId = await resolveAppIdFromCleanTitle(cleanTitle);
          if (cancelled) {
            return;
          }

          setSteamAppIdByTitleCache(prev => (prev[cleanTitle] === appId ? prev : { ...prev, [cleanTitle]: appId }));
          setResolvedAppIds(prev => (prev[game.displayKey] === appId ? prev : { ...prev, [game.displayKey]: appId }));

          await new Promise(resolve => setTimeout(resolve, 60));
        }
      };

      resolveMissingAppIds();

      return () => {
        cancelled = true;
      };
    }, [displayGames, resolvedAppIds, steamAppIdByTitleCache, extractAppId, resolveAppIdFromCleanTitle]);

    // Track/untrack handlers
    const handleTrackGame = useCallback(async (game: Game, forceReplace = false) => {
      if (status !== 'authenticated') {
        router.push('/auth/signin');
        return;
      }

      try {
        const response = await fetch('/api/tracking', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            gameId: game.id,
            title: game.originalTitle || game.title, // Use original title for Steam verification
            originalTitle: game.originalTitle || game.title, // Ensure we always have original title
            cleanedTitle: game.title, // Pass the cleaned title separately
            source: game.source,
            image: game.image,
            description: game.description,
            gameLink: game.link,
            forceReplace,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          await loadTrackedGames();
          notify?.showSuccess(data.message || 'Game added to tracking!');
        } else if (response.status === 409) {
          const error = await response.json();
          if (error.confirmationRequired) {
            const confirmed = await confirm(
              'Replace Tracked Game?',
              `${error.reason || 'A tracked version already exists.'}\n\nCurrent: ${error.existingGame?.title || 'Unknown'} (${error.existingGame?.version || 'Unknown'})\nSelected: ${error.replacement?.title || game.title} (${error.replacement?.version || 'Unknown'})`,
              { confirmText: 'Replace', cancelText: 'Cancel', type: 'warning' }
            );

            if (!confirmed) {
              return;
            }

            await handleTrackGame(game, true);
            return;
          }

          notify?.showError(error.error || 'Failed to track game');
        } else {
          const error = await response.json();
          notify?.showError(error.error || 'Failed to track game');
        }
      } catch (error) {
        console.error('Track game error:', error);
        notify?.showError('Failed to track game');
      }
    }, [status, router, notify, confirm, loadTrackedGames]);

    const handleUntrackGame = useCallback(async (game: Game) => {
      try {
        const response = await fetch(`/api/tracking?gameId=${encodeURIComponent(game.id)}`, {
          method: 'DELETE',
        });

        if (response.ok) {
          await loadTrackedGames();
          notify?.showInfo('Game removed from tracking.');
        } else {
          const error = await response.json();
          notify?.showError(error.error || 'Failed to untrack game');
        }
      } catch (error) {
        console.error('Untrack game error:', error);
        notify?.showError('Failed to untrack game');
      }
    }, [notify, loadTrackedGames]);

    return (
      <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-8">
        {/* Page Header */}
        <div className="text-center mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Game Discovery</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Search and discover games{status === 'authenticated' ? ' to track' : ''}</p>
          {status !== 'authenticated' && (
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
              <a href="/auth/signin" className="hover:underline">Sign in</a> to track games and receive update notifications
            </p>
          )}
        </div>
        {/* Add Custom Game Button - Only show for authenticated users */}
        {status === 'authenticated' && (
          <div className="mb-4">
            <AddCustomGame onGameAdded={loadTrackedGames} />
          </div>
        )}
        {/* Mobile-optimized Search */}
        <form onSubmit={searchGames} className="mb-4 sm:mb-6">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search for games..."
                className="w-full px-3 py-2 pr-10 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setRefineText('');
                    setSiteFilter('all');
                    setShowRefine(false);
                    loadRecentGames();
                    router.replace('/');
                  }}
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  ✕
                </button>
              )}
            </div>
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
          {/* Refine Search Bar - only show after search results are loaded */}
          {showRefine && (
            <div className="flex justify-center mt-3 mb-2">
              <input
                type="text"
                className="w-full sm:w-1/2 px-4 py-2 border border-blue-400 dark:border-blue-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow-sm transition-all"
                placeholder="🔎 Refine results (keyword)"
                value={refineText}
                onChange={e => setRefineText(e.target.value)}
                style={{maxWidth: '500px'}}
              />
            </div>
          )}
        </form>
        {/* Site Filter */}
        <div className="mb-4 sm:mb-6">
          <div className="flex items-center justify-between mb-2">
            <label className="block text-sm text-gray-700 dark:text-gray-300">Filter by Site</label>
            {(searchQuery || siteFilter !== 'all') && (
              <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                {searchQuery && (
                  <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-full">
                    Search: &ldquo;{searchQuery}&rdquo;
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <div className="flex-1 overflow-x-auto pb-1 scrollbar-thin">
              <div className="flex gap-1.5 min-w-max">
                {[{ value: 'all', label: 'All Sites' }, ...SITES].map(site => (
                  <button
                    key={site.value}
                    onClick={() => {
                      setSiteFilter(site.value);
                      // Auto-apply: trigger filter immediately
                      // Use site.value directly (not stale siteFilter from closure)
                      if (searchQuery.trim()) {
                        const params = new URLSearchParams({ search: searchQuery });
                        if (site.value !== 'all') params.set('site', site.value);
                        if (refineText.trim()) params.set('refine', refineText);
                        updateURL(searchQuery, site.value, refineText);
                        setLoading(true);
                        setError(null);
                        const signal = beginFetch();
                        fetch(`/api/games/search?${params}`, { cache: 'no-store', signal })
                          .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed')))
                          .then(data => {
                            if (signal.aborted) return;
                            setGames(data);
                            setShowRefine(true);
                          })
                          .catch(err => {
                            if (err?.name === 'AbortError') return;
                            setError(err.message); setGames([]);
                          })
                          .finally(() => { if (!signal.aborted) setLoading(false); });
                      } else {
                        updateURL('', site.value);
                        const signal = beginFetch();
                        setLoading(true);
                        setError(null);
                        const params = new URLSearchParams();
                        if (site.value !== 'all') params.set('site', site.value);
                        fetch(`/api/games/recent?${params}`, { cache: 'no-store', signal })
                          .then(r => r.ok ? r.json() : Promise.reject(new Error('Failed')))
                          .then(data => { if (!signal.aborted) setGames(data); })
                          .catch(err => {
                            if (err?.name === 'AbortError') return;
                            setError(err.message); setGames([]);
                          })
                          .finally(() => { if (!signal.aborted) setLoading(false); });
                      }
                    }}
                    className={`px-3 py-1.5 text-sm font-medium rounded-full whitespace-nowrap transition-all duration-150 border ${
                      siteFilter === site.value
                        ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                        : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
                    }`}
                  >
                    {site.label}
                  </button>
                ))}
              </div>
            </div>
            {(searchQuery || siteFilter !== 'all' || refineText) && (
              <button
                onClick={(e) => {
                  e.preventDefault();
                  setSearchQuery('');
                  setSiteFilter('all');
                  setRefineText('');
                  setShowRefine(false);
                  loadRecentGames();
                  router.replace('/');
                }}
                className="shrink-0 px-3 py-1.5 text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                title="Clear all filters"
              >
                ✕ Clear
              </button>
            )}
          </div>
        </div>
        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded text-sm">
            {error}
          </div>
        )}
        
        {/* Cache Status Indicator + Result Count */}
        {games.length > 0 && (
          <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 rounded text-xs flex items-center justify-between">
            <span>
              🎮 {searchQuery
                ? `${displayGames.length} results for "${searchQuery}"`
                : showAllGames
                  ? `${displayGames.length} games`
                  : `${displayGames.filter(g => extractAppId(g) || typeof resolvedAppIds[g.displayKey] === 'string').length} verified games`
              }
            </span>
            <div className="flex items-center gap-3">
              {!searchQuery && (
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <span className="text-xs text-blue-600 dark:text-blue-400 font-medium">Show Unverified Results</span>
                  <button
                    role="switch"
                    aria-checked={showAllGames}
                    onClick={() => setShowAllGames(prev => !prev)}
                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 dark:focus:ring-offset-gray-900 ${
                      showAllGames
                        ? 'bg-blue-500'
                        : 'bg-gray-300 dark:bg-gray-600'
                    }`}
                  >
                    <span
                      className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                        showAllGames ? 'translate-x-[18px]' : 'translate-x-[3px]'
                      }`}
                    />
                  </button>
                </label>
              )}
              {!searchQuery && (
                <button
                  onClick={() => loadRecentGames(true)}
                  disabled={loading}
                  className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 font-medium disabled:opacity-50"
                >
                  {loading ? '⏳ Refreshing...' : '🔄 Refresh'}
                </button>
              )}
            </div>
          </div>
        )}
        
        {/* Show Recent Uploads Button - only show if we have recent games but they're hidden */}
        {!showRecentGames && games.length > 0 && searchQuery === '' && (
          <div className="text-center mb-6">
            <button
              onClick={() => setRecentGamesCookie(true)}
              className="px-6 py-3 bg-gradient-to-r from-blue-500 to-cyan-500 text-white rounded-lg hover:from-blue-600 hover:to-cyan-600 transition-all duration-200 font-medium shadow-lg hover:shadow-xl transform hover:scale-105"
            >
              Show Recent Uploads
            </button>
          </div>
        )}

        {/* Mobile-optimized Games Grid */}
        {(showRecentGames || searchQuery !== '') && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 sm:gap-6">
            {loading ? (
              <div className="col-span-full flex flex-col items-center justify-center py-12 space-y-4">
                <div className="relative">
                  <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 dark:border-gray-700 border-t-blue-500 dark:border-t-blue-400"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl">🔍</span>
                  </div>
                </div>
                <p className="text-gray-600 dark:text-gray-400 font-medium">
                  {searchQuery ? `Searching for "${searchQuery}"...` : 'Loading games...'}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-500">
                  Please wait while we fetch the results
                </p>
              </div>
            ) : displayGames.length === 0 ? (
              <div className="col-span-full text-center py-8 text-gray-500 dark:text-gray-400">
                {error ? 'Failed to load games' : 'No games found'}
              </div>
            ) : (
              displayGames
                .filter((game: DisplayGame) => {
                  if (searchQuery.trim()) return true;
                  if (showAllGames) return true;
                  const inlineAppId = extractAppId(game);
                  if (inlineAppId) return true;
                  const resolved = resolvedAppIds[game.displayKey];
                  return typeof resolved === 'string';
                })
                .map((game: DisplayGame) => {
                  const trackState = getTrackState(game);
                  const resolvedAppId = extractAppId(game) || resolvedAppIds[game.displayKey] || undefined;
                  const cardLink = resolvedAppId ? `/appid/${resolvedAppId}` : game.link;
                  return (
                    <GamePosterCard
                      key={game.displayKey}
                      postId={game.originalId?.toString()}
                      siteType={game.siteType}
                      embeddedDownloadLinks={game.downloadLinks}
                      link={cardLink}
                      sourceLink={game.link}
                      title={game.originalTitle || game.title}
                      image={game.image}
                      badge={game.source}
                      badgeColor={trackState.isExactTracked ? 'green' : trackState.hasTrackedVariant ? 'yellow' : 'blue'}
                      hasUpdate={false}
                      isTracked={trackState.isExactTracked}
                      hasTrackedVariant={trackState.hasTrackedVariant}
                      trackedVersion={trackState.trackedVersion}
                      trackedLabel={trackState.trackedLabel}
                      onTrack={status === 'authenticated' && !trackState.isExactTracked ? () => handleTrackGame(game) : undefined}
                      onUntrack={status === 'authenticated' && trackState.isExactTracked ? () => handleUntrackGame(game) : undefined}
                      trackButtonText={trackState.hasTrackedVariant ? '↻ Track This Version' : '➕ Track Game'}
                      className=""
                    />
                  );
                })
            )}
          </div>
        )}
      </div>
    );
  }

export default function Page() {
  return (
    <Suspense>
      <DashboardInner />
    </Suspense>
  );
}