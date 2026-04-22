'use client';

import { useState, useCallback, useEffect, useMemo, useRef, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { GamePosterCard } from '../components/GamePosterCard';
import { AddCustomGame } from '../components/AddCustomGame';
import { useNotification } from '../contexts/NotificationContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { SITES } from '../lib/sites';
import { cleanGameTitle } from '../utils/steamApi';
import { getProxiedImageUrl } from '../utils/imageProxy';

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
  const [showAllGames, setShowAllGames] = useState(false);

  // Single AbortController tied to this component's lifetime. We abort it on
  // unmount so pending fetches (e.g. the up-to-120s /api/games/recent scrape)
  // don't keep hogging browser HTTP connection slots after the user has
  // navigated to another page. We deliberately do NOT abort between sibling
  // operations on this page — otherwise the URL-sync effect or a status
  // change could kill a search mid-flight.
  const fetchAbortRef = useRef<AbortController | null>(null);
  const enrichTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // True while the server is still enriching images/appids in the background.
  // Used to keep the loading spinner visible past the initial fetch so the
  // user doesn't see an empty "No games found" screen while verification and
  // image resolution finish.
  const [enriching, setEnriching] = useState(false);

  const getFetchSignal = useCallback(() => {
    if (!fetchAbortRef.current) {
      fetchAbortRef.current = new AbortController();
    }
    return fetchAbortRef.current.signal;
  }, []);

  // Stop any in-flight recent-uploads enrichment poll. The poll is kicked off
  // by `loadRecentGames` and calls `setGames(pollData)` every 2s; without
  // this, starting a search immediately after mount would have the next poll
  // tick overwrite the search results with fresh recent uploads — which is
  // exactly the "search results flash then jump back to recent uploads"
  // behaviour we're guarding against here. Also clears `enriching` because
  // the spinner is no longer meaningful once the user has moved on.
  const cancelRecentPoll = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    setEnriching(false);
  }, []);

  useEffect(() => {
    if (!fetchAbortRef.current) fetchAbortRef.current = new AbortController();
    return () => {
      fetchAbortRef.current?.abort();
      if (enrichTimeoutRef.current) clearTimeout(enrichTimeoutRef.current);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Warm the browser cache for every game's poster so that by the time a
  // verified card mounts its image is already cached. We throttle to a small
  // concurrency and delay the start, because otherwise these many
  // /api/proxy-image requests (some slow FlareSolverr-backed CF lookups) would
  // saturate the browser's per-origin HTTP/1.1 connection limit and starve the
  // /api/steam verification calls that gate which cards actually render.
  const prefetchedImageUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!games.length || typeof window === 'undefined') return;

    const urls: string[] = [];
    for (const g of games) {
      if (!g.image) continue;
      const url = getProxiedImageUrl(g.image);
      if (prefetchedImageUrlsRef.current.has(url)) continue;
      prefetchedImageUrlsRef.current.add(url);
      urls.push(url);
    }
    if (!urls.length) return;

    let cancelled = false;

    const loadOne = (url: string) => new Promise<void>((resolve) => {
      const img = new window.Image();
      img.decoding = 'async';
      // Low fetchpriority so browsers (that honour it) let verification
      // requests jump the queue.
      (img as HTMLImageElement & { fetchPriority?: string }).fetchPriority = 'low';
      img.onload = () => resolve();
      img.onerror = () => resolve();
      img.src = url;
    });

    const run = async () => {
      // Give verification ~400ms to fire first requests before we start
      // competing for connection slots.
      await new Promise(r => setTimeout(r, 400));
      if (cancelled) return;

      const CONCURRENCY = 2;
      let cursor = 0;
      const worker = async () => {
        while (!cancelled) {
          const i = cursor++;
          if (i >= urls.length) return;
          await loadOne(urls[i]);
        }
      };
      await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
    };
    run();

    return () => { cancelled = true; };
  }, [games]);

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
          const signal = getFetchSignal();
          cancelRecentPoll();
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
  }, [searchParams, getFetchSignal, cancelRecentPoll]);

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
  //
  // Polling strategy: the first fetch can return with background enrichment
  // (IGDB images + Steam AppID resolution) still running on the server. Rather
  // than show an empty "No games found" grid and wait for the user to reload,
  // we poll `/api/games/recent` every 2s while the server reports pending
  // work via `X-Pending-Images`/`X-Pending-AppIds`. Capped at 60s.
  const loadRecentGames = useCallback(async (forceRefresh = false) => {
    const signal = getFetchSignal();
    setLoading(true);
    setError(null);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }

    const readPendingCounts = (response: Response) => ({
      images: parseInt(response.headers.get('X-Pending-Images') || '0', 10) || 0,
      appIds: parseInt(response.headers.get('X-Pending-AppIds') || '0', 10) || 0,
    });

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

      const { images, appIds } = readPendingCounts(response);
      const hasPending = images > 0 || appIds > 0;
      setEnriching(hasPending);

      if (hasPending) {
        // Poll in the background until server reports no pending work or we
        // hit the max window. Each tick replaces `games` with fresh data so
        // newly-verified cards and newly-resolved images appear without any
        // user action.
        const MAX_POLLS = 30; // 30 * 2s = 60s
        let polls = 0;
        pollIntervalRef.current = setInterval(async () => {
          if (signal.aborted) {
            if (pollIntervalRef.current) {
              clearInterval(pollIntervalRef.current);
              pollIntervalRef.current = null;
            }
            return;
          }
          polls++;
          try {
            const pollResp = await fetch('/api/games/recent', { cache: 'no-store', signal });
            if (!pollResp.ok || signal.aborted) return;
            const pollData = await pollResp.json();
            if (signal.aborted) return;
            setGames(pollData);

            const { images: stillImages, appIds: stillAppIds } = readPendingCounts(pollResp);
            const stillPending = stillImages > 0 || stillAppIds > 0;
            if (!stillPending || polls >= MAX_POLLS) {
              setEnriching(false);
              if (pollIntervalRef.current) {
                clearInterval(pollIntervalRef.current);
                pollIntervalRef.current = null;
              }
            }
          } catch {
            /* silent — will try again on next tick or be cleared on unmount */
          }
        }, 2000);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to fetch recent games');
      setGames([]);
      setEnriching(false);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [getFetchSignal]);

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

    const signal = getFetchSignal();
    cancelRecentPoll();
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
  }, [searchQuery, siteFilter, refineText, loadRecentGames, updateURL, getFetchSignal, cancelRecentPoll]);

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
                      // Always cancel the background enrichment poll before
                      // kicking off a filter fetch. Otherwise the next poll
                      // tick (every 2s) calls `/api/games/recent` with *no*
                      // site param and overwrites the site-filtered games
                      // with the unfiltered recent grid — which is what made
                      // filter clicks appear to "bounce back" to recent
                      // uploads.
                      cancelRecentPoll();
                      // Auto-apply: trigger filter immediately
                      // Use site.value directly (not stale siteFilter from closure)
                      if (searchQuery.trim()) {
                        const params = new URLSearchParams({ search: searchQuery });
                        if (site.value !== 'all') params.set('site', site.value);
                        if (refineText.trim()) params.set('refine', refineText);
                        updateURL(searchQuery, site.value, refineText);
                        setLoading(true);
                        setError(null);
                        const signal = getFetchSignal();
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
                        const signal = getFetchSignal();
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
                  : `${displayGames.filter(g => extractAppId(g)).length} verified games`
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
        {(showRecentGames || searchQuery !== '') && (() => {
          // Keep the spinner visible while the server is still enriching
          // (background image + AppID resolution) if we don't yet have any
          // verified cards to show. Without this, the user sees an empty
          // "No games found" grid for several seconds and thinks the page
          // froze. Once at least one verified card is ready we flip to the
          // grid and new cards stream in as polling brings fresh data.
          const visibleCount = searchQuery.trim() || showAllGames
            ? displayGames.length
            : displayGames.filter(g => extractAppId(g) !== null).length;
          const showSpinner = loading || (enriching && visibleCount === 0);
          return (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 sm:gap-6">
            {showSpinner ? (
              <div className="col-span-full flex flex-col items-center justify-center py-12 space-y-4">
                <div className="relative">
                  <div className="animate-spin rounded-full h-16 w-16 border-4 border-gray-200 dark:border-gray-700 border-t-blue-500 dark:border-t-blue-400"></div>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl">🔍</span>
                  </div>
                </div>
                <p className="text-gray-600 dark:text-gray-400 font-medium">
                  {searchQuery
                    ? `Searching for "${searchQuery}"...`
                    : enriching
                      ? 'Verifying games...'
                      : 'Loading games...'}
                </p>
                <p className="text-sm text-gray-500 dark:text-gray-500">
                  {enriching ? 'Matching posts to Steam and loading images' : 'Please wait while we fetch the results'}
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
                  return extractAppId(game) !== null;
                })
                .map((game: DisplayGame) => {
                  const trackState = getTrackState(game);
                  const resolvedAppId = extractAppId(game) || undefined;
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
          );
        })()}
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
