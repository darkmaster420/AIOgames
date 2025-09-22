'use client';

import { useState } from 'react';

interface SearchResult {
  id: string;
  title: string;
  source: string;
  image?: string;
  isSelected: boolean;
}

interface AddCustomGameProps {
  onGameAdded?: (game: {
    id: string;
    gameId: string;
    title: string;
    source: string;
    image?: string;
    description: string;
    dateAdded: Date;
  }) => void;
  className?: string;
}

export function AddCustomGame({ onGameAdded, className = '' }: AddCustomGameProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [gameName, setGameName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!gameName.trim()) {
      setError('Please enter a game name');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');
    setSearchResults([]);

    try {
      const response = await fetch('/api/tracking/custom', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ gameName: gameName.trim() }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 409) {
          setError(data.error || 'Game is already being tracked');
        } else if (response.status === 404) {
          setError(data.error || 'No games found with that name');
        } else {
          setError(data.error || 'Failed to add game');
        }
        return;
      }

      setSuccess(data.message || 'Game added successfully!');
      setSearchResults(data.searchResults || []);
      setGameName('');
      
      // Call the callback if provided
      if (onGameAdded && data.game) {
        onGameAdded(data.game);
      }

      // Auto-close after success
      setTimeout(() => {
        setIsOpen(false);
        setSuccess('');
        setSearchResults([]);
      }, 3000);

    } catch (err) {
      console.error('Error adding custom game:', err);
      setError('Failed to add game. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setGameName('');
    setError('');
    setSuccess('');
    setSearchResults([]);
  };

  return (
    <div className={className}>
      <button
        onClick={() => setIsOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors min-h-[40px]"
      >
        <span>➕</span>
        <span>Add Custom Game</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl w-full max-w-md">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Add Game to Tracking
              </h3>
              <button
                onClick={handleClose}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <span className="text-xl">✕</span>
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label 
                    htmlFor="gameName" 
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                  >
                    Game Name
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      id="gameName"
                      value={gameName}
                      onChange={(e) => setGameName(e.target.value)}
                      placeholder="Enter game name (e.g., 'Cyberpunk 2077', 'Baldur's Gate 3')"
                      className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      disabled={loading}
                    />
                    <span className="absolute right-3 top-2.5 text-gray-400">🔍</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    We&apos;ll search for the game and add the best match to your tracking list
                  </p>
                </div>

                {/* Error Message */}
                {error && (
                  <div className="p-3 bg-red-100 dark:bg-red-900 border border-red-300 dark:border-red-600 rounded-md">
                    <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
                  </div>
                )}

                {/* Success Message */}
                {success && (
                  <div className="p-3 bg-green-100 dark:bg-green-900 border border-green-300 dark:border-green-600 rounded-md">
                    <div className="flex items-center gap-2">
                      <span className="text-green-600 dark:text-green-400">✅</span>
                      <p className="text-sm text-green-700 dark:text-green-300">{success}</p>
                    </div>
                  </div>
                )}

                {/* Search Results Preview */}
                {searchResults.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                      Search Results:
                    </p>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {searchResults.map((result) => (
                        <div 
                          key={result.id}
                          className={`flex items-center gap-2 p-2 rounded text-xs ${
                            result.isSelected 
                              ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' 
                              : 'bg-gray-50 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                          }`}
                        >
                          {result.isSelected && <span>✅</span>}
                          <span className="font-medium">{result.title}</span>
                          <span className="text-gray-500">({result.source})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={loading || !gameName.trim()}
                    className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                        <span>Searching...</span>
                      </>
                    ) : (
                      <>
                        <span>🔍</span>
                        <span>Add Game</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-4 py-2 bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}