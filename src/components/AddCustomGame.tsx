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
        className="inline-flex items-center gap-2 px-6 py-3 text-sm btn-primary transition-all min-h-[48px] shadow-glow"
      >
        <span>✨</span>
        <span>Add Custom Game</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="card-gradient backdrop-blur-md border border-white/20 dark:border-white/10 rounded-2xl shadow-2xl w-full max-w-md animate-slide-up">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/20 dark:border-white/10">
              <h3 className="text-lg font-semibold text-gradient">
                🎮 Add Game to Tracking
              </h3>
              <button
                onClick={handleClose}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:scale-110 transition-all duration-200"
              >
                <span className="text-xl">✕</span>
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label 
                    htmlFor="gameName" 
                    className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
                  >
                    🎯 Game Name
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      id="gameName"
                      value={gameName}
                      onChange={(e) => setGameName(e.target.value)}
                      placeholder="Enter game name (e.g., 'Cyberpunk 2077', 'Baldur's Gate 3')"
                      className="w-full px-4 py-3 pr-12 input-glass text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder-slate-400 shadow-lg"
                      disabled={loading}
                    />
                    <span className="absolute right-4 top-3.5 text-slate-400 text-lg">🔍</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-800/50 p-2 rounded-lg">
                    ✨ We&apos;ll search for the game and add the best match to your tracking list
                  </p>
                </div>

                {/* Error Message */}
                {error && (
                  <div className="p-4 bg-gradient-to-r from-red-500/10 to-pink-500/10 border border-red-300/30 dark:border-red-600/30 rounded-xl backdrop-blur-sm animate-slide-up">
                    <div className="flex items-center gap-2">
                      <span className="text-red-500 text-lg">⚠️</span>
                      <p className="text-sm text-red-700 dark:text-red-300 font-medium">{error}</p>
                    </div>
                  </div>
                )}

                {/* Success Message */}
                {success && (
                  <div className="p-4 bg-gradient-to-r from-success-500/10 to-accent-500/10 border border-success-300/30 dark:border-success-600/30 rounded-xl backdrop-blur-sm animate-slide-up">
                    <div className="flex items-center gap-2">
                      <span className="text-success-600 dark:text-success-400 text-lg">🎉</span>
                      <p className="text-sm text-success-700 dark:text-success-300 font-medium">{success}</p>
                    </div>
                  </div>
                )}

                {/* Search Results Preview */}
                {searchResults.length > 0 && (
                  <div className="space-y-3 animate-slide-up">
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-2">
                      🎯 <span>Search Results:</span>
                    </p>
                    <div className="max-h-36 overflow-y-auto space-y-2 custom-scrollbar">
                      {searchResults.map((result) => (
                        <div 
                          key={result.id}
                          className={`flex items-center gap-3 p-3 rounded-lg text-sm transition-all duration-200 ${
                            result.isSelected 
                              ? 'bg-gradient-to-r from-success-500/20 to-accent-500/20 text-success-700 dark:text-success-300 border border-success-300/30 shadow-lg' 
                              : 'bg-white/50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-400 border border-white/30 dark:border-white/20'
                          }`}
                        >
                          {result.isSelected && <span className="text-lg">🎯</span>}
                          <div className="flex-1">
                            <span className="font-semibold">{result.title}</span>
                            <span className="ml-2 text-xs opacity-75">({result.source})</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Buttons */}
                <div className="flex gap-3 pt-3">
                  <button
                    type="submit"
                    disabled={loading || !gameName.trim()}
                    className="flex-1 px-5 py-3 btn-primary disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 shadow-lg"
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white/30 border-t-white"></div>
                        <span>Searching...</span>
                      </>
                    ) : (
                      <>
                        <span>�</span>
                        <span>Add Game</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="px-5 py-3 btn-glass transition-all"
                  >
                    Close
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