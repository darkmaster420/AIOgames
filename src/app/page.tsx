'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { Navigation } from '../components/Navigation';
import { GameDownloadLinks } from '../components/GameDownloadLinks';
import { AddCustomGame } from '../components/AddCustomGame';

interface Game {
  id: string;
  originalId: number;
  title: string;
  image: string;
  description: string;
  source: string;
  siteType: string;
  link: string;
}

export default function Dashboard() {
  const { status } = useSession();
  const [games, setGames] = useState<Game[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [trackedGames, setTrackedGames] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (status === 'authenticated') {
      loadRecentGames();
      loadTrackedGames();
    }
  }, [status]);

  const loadTrackedGames = async () => {
    try {
      const response = await fetch('/api/tracking');
      if (response.ok) {
        const data = await response.json();
        const trackedIds = new Set(data.games?.map((game: { gameId: string }) => game.gameId) || []);
        setTrackedGames(trackedIds as Set<string>);
      }
    } catch (err) {
      console.error('Failed to load tracked games:', err);
    }
  };

  const loadRecentGames = async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/games/recent');
      if (!response.ok) throw new Error('Failed to load games');
      const data = await response.json();
      
      // Ensure data is an array before setting it
      if (Array.isArray(data)) {
        setGames(data);
      } else {
        console.error('API returned non-array data:', data);
        setError('Invalid data format received from API');
        setGames([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      setGames([]); // Set to empty array on error
    } finally {
      setLoading(false);
    }
  };

  const searchGames = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    try {
      setLoading(true);
      setError('');
      const response = await fetch(`/api/games/search?search=${encodeURIComponent(searchQuery)}`);
      if (!response.ok) throw new Error('Search failed');
      const data = await response.json();
      
      // Ensure data is an array before setting it
      if (Array.isArray(data)) {
        setGames(data);
      } else {
        console.error('Search API returned non-array data:', data);
        setError('Invalid search results format');
        setGames([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
      setGames([]); // Set to empty array on error
    } finally {
      setLoading(false);
    }
  };

  const handleTrackGame = async (game: Game) => {
    try {
      const response = await fetch('/api/tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gameId: game.id,
          title: game.title,
          source: game.source,
          image: game.image,
          description: game.description,
          gameLink: game.link
        })
      });

      if (response.ok) {
        setTrackedGames(prev => new Set(prev).add(game.id));
        alert('Game added to tracking!');
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to track game');
      }
    } catch {
      alert('Failed to track game');
    }
  };

  const handleUntrackGame = async (game: Game) => {
    try {
      const response = await fetch(`/api/tracking?gameId=${game.id}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setTrackedGames(prev => {
          const newSet = new Set(prev);
          newSet.delete(game.id);
          return newSet;
        });
        alert('Game removed from tracking!');
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to untrack game');
      }
    } catch {
      alert('Failed to untrack game');
    }
  };

  // Show loading spinner while checking auth
  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <p className="mt-2 text-gray-600 dark:text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Navigation />
      <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-2 sm:p-4">
        <div className="max-w-7xl mx-auto">
          {/* Page Header */}
          <div className="text-center sm:text-left mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white">Game Discovery</h1>
            <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1">Search and discover games to track</p>
          </div>
          
          {/* Add Custom Game Button */}
          <div className="mb-4">
            <AddCustomGame onGameAdded={loadTrackedGames} />
          </div>
        
        {/* Mobile-optimized Search */}
        <form onSubmit={searchGames} className="mb-6 sm:mb-8">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search for games..."
              className="flex-1 px-3 py-2 sm:px-4 text-sm sm:text-base border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-4 py-2 sm:px-6 text-sm sm:text-base bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>
        </form>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 sm:p-4 bg-red-100 dark:bg-red-900 border border-red-400 dark:border-red-600 text-red-700 dark:text-red-300 rounded text-sm">
            {error}
          </div>
        )}

        {/* Mobile-optimized Games Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 sm:gap-6">
          {games.length === 0 && !loading ? (
            <div className="col-span-full text-center py-8 text-gray-500 dark:text-gray-400">
              {error ? 'Failed to load games' : 'No games found'}
            </div>
          ) : (
            games.map((game: Game) => (
            <div key={game.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden">
              <Image
                src={game.image || 'https://via.placeholder.com/300x400?text=No+Image'}
                alt={game.title}
                width={300}
                height={192}
                className="w-full h-36 sm:h-48 object-cover"
                unoptimized
              />
              <div className="p-3 sm:p-4">
                <h3 className="font-semibold text-base sm:text-lg mb-2 text-gray-900 dark:text-white line-clamp-2">{game.title}</h3>
                <p className="text-gray-600 dark:text-gray-300 text-xs sm:text-sm mb-3 sm:mb-4 line-clamp-3">
                  {game.description}
                </p>
                
                {/* Mobile-optimized Game Actions */}
                <div className="space-y-2">
                  {/* Download Links */}
                  {status === 'authenticated' && (
                    <GameDownloadLinks
                      postId={game.originalId.toString()}
                      siteType={game.siteType}
                      gameTitle={game.title}
                      className="w-full"
                    />
                  )}
                  
                  {/* View Original Post Link */}
                  <a
                    href={game.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full px-2 py-2 sm:px-3 text-center bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs sm:text-sm rounded hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                  >
                    📖 View Post on {game.source}
                  </a>
                  
                  {/* Track/Untrack Button */}
                  {trackedGames.has(game.id) ? (
                    <button
                      onClick={() => handleUntrackGame(game)}
                      className="block w-full px-2 py-2 sm:px-3 text-center bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 text-xs sm:text-sm rounded hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                    >
                      🔔 Stop Tracking Updates
                    </button>
                  ) : (
                    <button
                      onClick={() => handleTrackGame(game)}
                      className="block w-full px-2 py-2 sm:px-3 text-center bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300 text-xs sm:text-sm rounded hover:bg-green-200 dark:hover:bg-green-800 transition-colors"
                    >
                      🔔 Track for Updates
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
          )}
        </div>

        {loading && (
          <div className="text-center py-8">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        )}
        </div>
      </div>
    </>
  );
}