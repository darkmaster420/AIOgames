'use client';

import { useState, useEffect, useCallback } from 'react';
import { cleanGameTitle, searchSteamGames } from '@/utils/steamApi';

interface SteamGameResult {
  appid: string; // Changed from number to string to match API
  name: string;
  developer?: string;
  publisher?: string;
  score_rank?: string;
  positive?: number;
  negative?: number;
  userscore?: number;
  price?: string;
  initialprice?: string;
  discount?: string;
  tags?: Record<string, number>;
}

interface SteamSuggestionModalProps {
  isOpen: boolean;
  gameTitle: string;
  onClose: () => void;
  onConfirm: (steamAppId?: number, steamName?: string) => void;
}

export function SteamSuggestionModal({ 
  isOpen, 
  gameTitle, 
  onClose, 
  onConfirm 
}: SteamSuggestionModalProps) {
  const [searchResults, setSearchResults] = useState<SteamGameResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedGame, setSelectedGame] = useState<SteamGameResult | null>(null);

  const cleanedTitle = cleanGameTitle(gameTitle);

  const performSearch = useCallback(async () => {
    setIsSearching(true);
    try {
      const results = await searchSteamGames(cleanedTitle, 5);
      setSearchResults(results.results);
    } catch (error) {
      console.error('Steam search error:', error);
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [cleanedTitle]);

  useEffect(() => {
    if (isOpen && gameTitle) {
      performSearch();
    }
  }, [isOpen, gameTitle, performSearch]);

  const handleConfirm = () => {
    onConfirm(selectedGame ? parseInt(selectedGame.appid) : undefined, selectedGame?.name);
    handleClose();
  };

  const handleSkip = () => {
    onConfirm(); // No Steam data
    handleClose();
  };

  const handleClose = () => {
    setSelectedGame(null);
    setSearchResults([]);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Steam Verification
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            We found potential Steam matches for &quot;{gameTitle}&quot;
          </p>
          <p className="text-xs text-blue-600 dark:text-blue-400 mt-1">
            Cleaned search: &quot;{cleanedTitle}&quot;
          </p>
        </div>

        {/* Content */}
        <div className="p-4 max-h-96 overflow-y-auto">
          {isSearching ? (
            <div className="flex items-center justify-center py-8">
              <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
              <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">Searching Steam...</span>
            </div>
          ) : searchResults.length > 0 ? (
            <div className="space-y-3">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Select the matching Steam game:
              </p>
              {searchResults.map((result) => (
                <label
                  key={result.appid}
                  className={`block p-3 border rounded-lg cursor-pointer transition-colors ${
                    selectedGame?.appid === result.appid
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <input
                    type="radio"
                    name="steamGame"
                    value={result.appid}
                    checked={selectedGame?.appid === result.appid}
                    onChange={() => setSelectedGame(result)}
                    className="sr-only"
                  />
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 dark:text-white">
                        {result.name}
                      </p>
                      <p className="text-sm text-gray-500 dark:text-gray-400">
                        App ID: {result.appid}
                      </p>
                      {result.developer && (
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Developer: {result.developer}
                        </p>
                      )}
                      {result.positive && result.negative && (
                        <p className="text-sm text-green-600 dark:text-green-400">
                          {Math.round((result.positive / (result.positive + result.negative)) * 100)}% positive reviews
                        </p>
                      )}
                    </div>
                    {result.score_rank && (
                      <div className="ml-3 text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-1 rounded">
                        Rank #{result.score_rank}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-gray-500 dark:text-gray-400">
                No Steam matches found for this game.
              </p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                This might be an indie game or exclusive to other platforms.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-between">
          <button
            onClick={handleSkip}
            className="px-4 py-2 text-sm text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
          >
            Skip Steam Verification
          </button>
          <div className="flex gap-2">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-50 dark:hover:bg-gray-700"
            >
              Close
            </button>
            <button
              onClick={handleConfirm}
              disabled={!selectedGame && searchResults.length > 0}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {selectedGame ? 'Link Selected Game' : 'Continue Without Steam'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}