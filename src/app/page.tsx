'use client';

import { useState, useCallback, useEffect, Suspense } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { ImageWithFallback } from '../utils/imageProxy';
import { GameDownloadLinks } from '../components/GameDownloadLinks';
import { AddCustomGame } from '../components/AddCustomGame';
import { TelegramSendButton } from '../components/TelegramSendButton';
import { useNotification } from '../contexts/NotificationContext';
import { SITES } from '../lib/sites';
import { decodeHtmlEntities } from '../utils/steamApi';

type Game = {
  id: string;
  originalId: string | number;
  title: string;
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
  const [refineText, setRefineText] = useState('');
  const [showRefine, setShowRefine] = useState(false);
  const [showRecentGames, setShowRecentGames] = useState(false);

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

  // Load recent games (default view)
  const loadRecentGames = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/games/recent');
      if (!response.ok) {
        throw new Error('Failed to fetch recent games');
      }
      const data = await response.json();
      setGames(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch recent games');
      setGames([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Search games handler
  const searchGames = useCallback(async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim()) {
      setRecentGamesCookie(false);
      loadRecentGames();
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ search: searchQuery });
      if (siteFilter !== 'all') {
        params.set('site', siteFilter);
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
  }, [searchQuery, siteFilter, loadRecentGames]);

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

    // Apply current filter
    const applyCurrentFilter = useCallback(async () => {
      if (searchQuery.trim()) {
        await searchGames();
      } else {
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
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to fetch filtered games');
          setGames([]);
        } finally {
          setLoading(false);
        }
      }
    }, [searchQuery, siteFilter, searchGames]);

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
            title: game.title,
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
            <button
              onClick={(e) => { e.preventDefault(); applyCurrentFilter(); }}
              className="px-4 py-2 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 rounded-lg hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors text-sm font-medium"
            >
              Apply Filter
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
        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded text-sm">
            {error}
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
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 sm:gap-4 lg:gap-6">
            {games.length === 0 && !loading ? (
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
                .map((game: Game) => {
              return (
                <div key={game.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-all duration-200 overflow-hidden border border-gray-200 dark:border-gray-700 flex flex-col h-full">
                  <ImageWithFallback
                    src={game.image}
                    alt={game.title}
                    width={300}
                    height={180}
                    className="w-full h-32 sm:h-40 object-cover"
                  />
                  <div className="p-3 flex flex-col flex-grow">
                    <h3 className="font-semibold text-sm sm:text-base mb-2 text-gray-900 dark:text-white line-clamp-2 leading-tight">{game.title}</h3>
                    <p className="text-gray-600 dark:text-gray-300 text-xs mb-3 line-clamp-2 leading-relaxed flex-grow">
                      {decodeHtmlEntities(game.description)}
                    </p>
                    {/* Mobile-optimized Game Actions - Always at bottom */}
                    <div className="mt-auto space-y-2">
                      {/* Download Links */}
                      {status === 'authenticated' && (
                        <GameDownloadLinks
                          postId={game.originalId.toString()}
                          siteType={game.siteType}
                          gameTitle={game.title}
                          className="w-full"
                        />
                      )}
                      {/* Action Buttons */}
                      <div className="flex flex-col gap-1.5">
                        <a
                          href={game.link}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block w-full px-4 py-2 text-center bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-sm font-medium rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors min-h-[40px] flex items-center justify-center"
                        >
                          <span className="flex items-center gap-2">
                            📖 <span>View on {game.source}</span>
                          </span>
                        </a>
                        {/* Track/Untrack Button */}
                        <div className="flex gap-1.5">
                          {trackedGames.has(game.id) ? (
                            <button
                              onClick={() => handleUntrackGame(game)}
                              className="flex-1 px-4 py-2 text-center bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 text-sm font-medium rounded-lg hover:bg-red-200 dark:hover:bg-red-800 transition-colors min-h-[40px] flex items-center justify-center"
                            >
                              <span className="flex items-center gap-2">
                                🔔 <span>Stop Tracking</span>
                              </span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleTrackGame(game)}
                              className="flex-1 px-4 py-2 text-center bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 text-sm font-medium rounded-lg hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors min-h-[40px] flex items-center justify-center"
                            >
                              <span className="flex items-center gap-2">
                                ⏰ <span>Track Updates</span>
                              </span>
                            </button>
                          )}
                          {/* Telegram Send Button */}
                          <TelegramSendButton 
                            game={{
                              id: game.id,
                              title: game.title,
                              description: game.description,
                              link: game.link,
                              image: game.image,
                              source: game.source,
                              siteType: game.siteType
                            }}
                            className="bg-blue-500 hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-700 text-white min-h-[40px] w-12 flex items-center justify-center"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          </div>
        )}
        {loading && (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        )}
      </div>
    );
  }
// Remove duplicate/erroneous code at the end

export default function Page() {
  return (
    <Suspense>
      <DashboardInner />
    </Suspense>
  );
}