'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import Link from 'next/link';
import { GameDownloadLinks } from '../../../components/GameDownloadLinks';

interface GameDetails {
  appid: number;
  name: string;
  type: string;
  description: string;
  short_description?: string;
  header_image?: string;
  background?: string;
  screenshots?: Array<{ path_full: string; path_thumbnail: string }>;
  developers?: string[];
  publishers?: string[];
  release_date?: {
    coming_soon: boolean;
    date: string;
  };
  platforms?: {
    windows: boolean;
    mac: boolean;
    linux: boolean;
  };
  metacritic?: {
    score: number;
    url: string;
  };
  categories?: Array<{ description: string }>;
  genres?: Array<{ description: string }>;
  price_overview?: {
    currency: string;
    initial: number;
    final: number;
    discount_percent: number;
  };
  // Tracked game info (if user is tracking)
  isTracked?: boolean;
  trackedGameId?: string;
  lastKnownVersion?: string;
  hasNewUpdate?: boolean;
  updateHistory?: Array<{
    version: string;
    dateFound: string;
    gameLink: string;
  }>;
}

export default function GameDetailPage() {
  const params = useParams();
  const { data: session, status } = useSession();
  const appid = params.appid as string;
  
  const [game, setGame] = useState<GameDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!appid) return;

    const fetchGameDetails = async () => {
      setLoading(true);
      setError('');
      
      try {
        const response = await fetch(`/api/games/${appid}`);
        
        if (!response.ok) {
          throw new Error('Failed to fetch game details');
        }
        
        const data = await response.json();
        setGame(data);
      } catch (err) {
        console.error('Error fetching game details:', err);
        setError(err instanceof Error ? err.message : 'Failed to load game details');
      } finally {
        setLoading(false);
      }
    };

    fetchGameDetails();
  }, [appid, status]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">Loading game details...</p>
        </div>
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6 text-center">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Game Not Found</h2>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {error || 'Unable to load game details. The game may not exist or there was an error fetching data.'}
          </p>
          <Link 
            href="/"
            className="inline-block px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Hero Section with Background */}
      <div className="relative h-96 bg-gray-900">
        {game.background && (
          <div className="absolute inset-0 overflow-hidden">
            <img
              src={game.background}
              alt={game.name}
              className="w-full h-full object-cover opacity-40"
            />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/70 to-transparent" />
        
        <div className="relative container mx-auto px-4 h-full flex items-end pb-8">
          <div className="flex gap-6 items-end">
            {/* Game Header Image */}
            {game.header_image && (
              <div className="hidden md:block flex-shrink-0">
                <img
                  src={game.header_image}
                  alt={game.name}
                  width={460}
                  height={215}
                  className="rounded-lg shadow-2xl"
                />
              </div>
            )}
            
            {/* Game Title and Meta */}
            <div className="flex-1 text-white pb-4">
              <h1 className="text-4xl md:text-5xl font-bold mb-3">{game.name}</h1>
              
              <div className="flex flex-wrap gap-4 text-sm mb-4">
                {game.release_date && (
                  <span className="px-3 py-1 bg-gray-800/80 rounded-full">
                    📅 {game.release_date.date}
                  </span>
                )}
                {game.metacritic && (
                  <span className="px-3 py-1 bg-green-600/80 rounded-full">
                    🎯 Metacritic: {game.metacritic.score}
                  </span>
                )}
                {game.isTracked && (
                  <span className="px-3 py-1 bg-blue-600/80 rounded-full">
                    ✓ Tracking
                  </span>
                )}
              </div>
              
              {game.developers && game.developers.length > 0 && (
                <p className="text-gray-300">
                  <span className="font-semibold">Developer:</span> {game.developers.join(', ')}
                </p>
              )}
              {game.publishers && game.publishers.length > 0 && (
                <p className="text-gray-300">
                  <span className="font-semibold">Publisher:</span> {game.publishers.join(', ')}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Description */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">About This Game</h2>
              {game.short_description && (
                <p className="text-gray-700 dark:text-gray-300 mb-4 text-lg">
                  {game.short_description}
                </p>
              )}
              <div 
                className="prose dark:prose-invert max-w-none text-gray-600 dark:text-gray-400"
                dangerouslySetInnerHTML={{ __html: game.description }}
              />
            </div>

            {/* Screenshots */}
            {game.screenshots && game.screenshots.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Screenshots</h2>
                <div className="grid grid-cols-2 gap-4">
                  {game.screenshots.map((screenshot, index) => (
                    <div key={index} className="relative aspect-video rounded-lg overflow-hidden">
                      <img
                        src={screenshot.path_full}
                        alt={`${game.name} screenshot ${index + 1}`}
                        className="w-full h-full object-cover hover:scale-105 transition-transform cursor-pointer"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Download Links (if tracked) */}
            {game.isTracked && session && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Download</h2>
                <GameDownloadLinks 
                  gameId={game.trackedGameId} 
                  className="w-full"
                />
              </div>
            )}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Game Info */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
              <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Game Info</h3>
              
              <div className="space-y-3">
                {/* Platforms */}
                {game.platforms && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Platforms</p>
                    <div className="flex gap-2">
                      {game.platforms.windows && (
                        <span className="px-2 py-1 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-sm">
                          Windows
                        </span>
                      )}
                      {game.platforms.mac && (
                        <span className="px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-sm">
                          Mac
                        </span>
                      )}
                      {game.platforms.linux && (
                        <span className="px-2 py-1 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 rounded text-sm">
                          Linux
                        </span>
                      )}
                    </div>
                  </div>
                )}

                {/* Genres */}
                {game.genres && game.genres.length > 0 && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Genres</p>
                    <div className="flex flex-wrap gap-2">
                      {game.genres.map((genre, index) => (
                        <span 
                          key={index}
                          className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-sm"
                        >
                          {genre.description}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Tracked Info */}
                {game.isTracked && game.lastKnownVersion && (
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">Current Version</p>
                    <p className="text-gray-900 dark:text-white font-mono text-sm">
                      {game.lastKnownVersion}
                    </p>
                  </div>
                )}

                {/* Steam Link */}
                <div>
                  <a
                    href={`https://store.steampowered.com/app/${appid}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block w-full px-4 py-2 bg-[#1b2838] hover:bg-[#2a475e] text-white rounded-lg text-center transition-colors"
                  >
                    View on Steam
                  </a>
                </div>

                {/* Track/Untrack Button */}
                {session && (
                  <div>
                    {game.isTracked ? (
                      <button
                        className="block w-full px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                        onClick={() => {
                          // TODO: Implement untrack functionality
                          alert('Untrack functionality coming soon!');
                        }}
                      >
                        Stop Tracking
                      </button>
                    ) : (
                      <button
                        className="block w-full px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                        onClick={() => {
                          // TODO: Implement track functionality
                          alert('Track functionality coming soon!');
                        }}
                      >
                        Track This Game
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Update History (if tracked) */}
            {game.isTracked && game.updateHistory && game.updateHistory.length > 0 && (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-6">
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">Update History</h3>
                <div className="space-y-3">
                  {game.updateHistory.slice(0, 5).map((update, index) => (
                    <div 
                      key={index}
                      className="border-l-4 border-blue-500 pl-3 py-2"
                    >
                      <p className="font-mono text-sm text-gray-900 dark:text-white">
                        {update.version}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {new Date(update.dateFound).toLocaleDateString()}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
