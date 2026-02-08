'use client';

import { useState, useCallback, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { GamePosterCard } from '../components/GamePosterCard';
import { AddCustomGame } from '../components/AddCustomGame';
import { useNotification } from '../contexts/NotificationContext';
import { SITES } from '../lib/sites';

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
};

function DashboardInner() {
  const [searchQuery, setSearchQuery] = useState('');
  const [siteFilter, setSiteFilter] = useState('all');
  const [games, setGames] = useState<Game[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trackedGames, setTrackedGames] = useState<Set<string>>(new Set());
  const { status } = useSession();
  const notify = useNotification();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [refineText, setRefineText] = useState('');
  const [showRefine, setShowRefine] = useState(false);
  const [showRecentGames, setShowRecentGames] = useState(false);
  
  // Client-side cache for recent games (10 minutes)
  const [recentGamesCache, setRecentGamesCache] = useState<{
    data: Game[];
    timestamp: number;
  } | null>(null);
  const CLIENT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

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
            const response = await fetch(`/api/games/search?${params}`);
            if (!response.ok) {
              throw new Error('Failed to search games');
            }
            const data = await response.json();
            setGames(data);
            setShowRefine(true);
            setRecentGamesCookie(true);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to search games');
            setGames([]);
          } finally {
            setLoading(false);
          }
        };
        performInitialSearch();
      }, 50);
      
      return () => clearTimeout(timer);
    }
  }, [searchParams]);

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
        }
      } catch (error) {
        console.error('Failed to load tracked games:', error);
      }
    }
  }, [status]);

  // Load recent games (default view) with client-side caching
  const loadRecentGames = useCallback(async () => {
    // Check client-side cache first
    const now = Date.now();
    if (recentGamesCache && (now - recentGamesCache.timestamp) < CLIENT_CACHE_TTL) {
      setGames(recentGamesCache.data);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/games/recent');
      if (!response.ok) {
        throw new Error('Failed to fetch recent games');
      }
      const data = await response.json();
      setGames(data);
      
      // Update client-side cache
      setRecentGamesCache({
        data,
        timestamp: now
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch recent games');
      setGames([]);
    } finally {
      setLoading(false);
    }
  }, [recentGamesCache, CLIENT_CACHE_TTL]);

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
      const response = await fetch(`/api/games/search?${params}`);
      if (!response.ok) {
        throw new Error('Failed to search games');
      }
      const data = await response.json();
      setGames(data);
      setShowRefine(true);
      setRecentGamesCookie(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to search games');
      setGames([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery, siteFilter, refineText, loadRecentGames, updateURL]);

  // Load recent games on mount and check cookie for visibility
  useEffect(() => {
    const recentGamesVisible = document.cookie
      .split('; ')
      .find(row => row.startsWith('showRecentGames='))
      ?.split('=')[1] === 'true';
    
    setShowRecentGames(recentGamesVisible);
    loadRecentGames(); // Always load games, but visibility is controlled by state
  }, [loadRecentGames]);

  // Load tracked games when authentication status changes
  useEffect(() => {
    loadTrackedGames();
  }, [loadTrackedGames]);

    // Apply current filter with caching
    const applyCurrentFilter = useCallback(async () => {
      if (searchQuery.trim()) {
        await searchGames();
      } else {
        // Update URL for site-only filtering
        updateURL('', siteFilter);
        
        // For site filtering, check if we can use cached data and filter locally
        if (siteFilter === 'all' && recentGamesCache && 
            (Date.now() - recentGamesCache.timestamp) < CLIENT_CACHE_TTL) {
          setGames(recentGamesCache.data);
          return;
        }

        setLoading(true);
        setError(null);
        try {
          const params = new URLSearchParams();
          if (siteFilter !== 'all') {
            params.set('site', siteFilter);
          }
          const response = await fetch(`/api/games/recent?${params}`);
          if (!response.ok) {
            throw new Error('Failed to fetch filtered games');
          }
          const data = await response.json();
          setGames(data);
          
          // Cache the data if it's the full recent games (no site filter)
          if (siteFilter === 'all') {
            setRecentGamesCache({
              data,
              timestamp: Date.now()
            });
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to fetch filtered games');
          setGames([]);
        } finally {
          setLoading(false);
        }
      }
    }, [searchQuery, siteFilter, searchGames, recentGamesCache, CLIENT_CACHE_TTL, updateURL]);

    // Track/untrack handlers
    const handleTrackGame = useCallback(async (game: Game) => {
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
          }),
        });

        if (response.ok) {
          setTrackedGames(prev => new Set(prev).add(game.id));
          notify?.showSuccess('Game added to tracking!');
        } else {
          const error = await response.json();
          notify?.showError(error.error || 'Failed to track game');
        }
      } catch (error) {
        console.error('Track game error:', error);
        notify?.showError('Failed to track game');
      }
    }, [status, router, notify]);

    const handleUntrackGame = useCallback(async (game: Game) => {
      try {
        const response = await fetch(`/api/tracking?gameId=${encodeURIComponent(game.id)}`, {
          method: 'DELETE',
        });

        if (response.ok) {
          setTrackedGames(prev => {
            const next = new Set(prev);
            next.delete(game.id);
            return next;
          });
          notify?.showInfo('Game removed from tracking.');
        } else {
          const error = await response.json();
          notify?.showError(error.error || 'Failed to untrack game');
        }
      } catch (error) {
        console.error('Untrack game error:', error);
        notify?.showError('Failed to untrack game');
      }
    }, [notify]);

    return (
      <div className="container mx-auto px-2 sm:px-4 py-4 sm:py-8">
        {/* Page Header */}
        <div className="text-center mb-4 sm:mb-6">
          <h1 className="text-xl sm:text-2xl md:text-3xl font-bold text-gray-900 dark:text-white">Game Discovery</h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Search and discover games to track</p>
        </div>
        {/* Add Custom Game Button */}
        <div className="mb-4">
          <AddCustomGame onGameAdded={loadTrackedGames} />
        </div>
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
                {siteFilter !== 'all' && (
                  <span className="px-2 py-1 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-full">
                    Site: {SITES.find(site => site.value === siteFilter)?.label || siteFilter}
                  </span>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={siteFilter}
                onChange={(e) => setSiteFilter(e.target.value)}
                className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
              >
                <option value="all">All Sites</option>
                {SITES.map(site => (
                  <option key={site.value} value={site.value}>{site.label}</option>
                ))}
              </select>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={(e) => { e.preventDefault(); applyCurrentFilter(); }}
                  className="px-4 py-2 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors text-sm font-medium"
                >
                  Apply Filter
                </button>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    setRecentGamesCache(null); // Clear client cache
                    loadRecentGames(); // Force fresh fetch
                  }}
                  className="px-4 py-2 bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 rounded-lg hover:bg-green-200 dark:hover:bg-green-800 transition-colors text-sm font-medium"
                  title="Refresh games data from server"
                >
                  🔄 Refresh
                </button>
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
                    className="px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors text-sm font-medium"
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded text-sm">
            {error}
          </div>
        )}
        
        {/* Cache Status Indicator */}
        {recentGamesCache && games.length > 0 && !searchQuery && (
          <div className="mb-3 p-2 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 text-blue-700 dark:text-blue-300 rounded text-xs flex items-center justify-between">
            <span>
              📦 Cached data (loaded {Math.round((Date.now() - recentGamesCache.timestamp) / 1000 / 60)} min ago)
            </span>
            <span className="text-blue-500">
              Refreshes automatically every 10 min
            </span>
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 sm:gap-6">
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
            ) : games.length === 0 ? (
              <div className="col-span-full text-center py-8 text-gray-500 dark:text-gray-400">
                {error ? 'Failed to load games' : 'No games found'}
              </div>
            ) : (
              games
                .filter(game => {
                  // Apply refine text filter if present
                  if (refineText.trim()) {
                    const searchText = refineText.toLowerCase();
                    return game.title.toLowerCase().includes(searchText) ||
                           game.description.toLowerCase().includes(searchText);
                  }
                  return true;
                })
                .map((game: Game) => (
                  <GamePosterCard
                    key={game.id}
                    postId={game.originalId?.toString()}
                    siteType={game.siteType}
                    title={game.originalTitle || game.title}
                    image={game.image}
                    badge={game.source}
                    badgeColor={trackedGames.has(game.id) ? 'green' : 'blue'}
                    hasUpdate={false}
                    isTracked={trackedGames.has(game.id)}
                    onTrack={() => handleTrackGame(game)}
                    onUntrack={() => handleUntrackGame(game)}
                    className=""
                  />
                ))
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