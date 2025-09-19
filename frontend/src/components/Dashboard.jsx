import React, { useState, useEffect } from 'react';
import { fetchGames, checkSupportedDownloaders, addDownload, searchGames, getRecentGames, processGameDownload, trackGame, untrackGame, getTrackedGames } from '../api';
import { ProxiedImage } from '../utils/imageProxy.jsx';

const Dashboard = () => {
    const [games, setGames] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedGame, setSelectedGame] = useState(null);
    const [supportedDownloaders, setSupportedDownloaders] = useState([]);
    const [trackedGames, setTrackedGames] = useState([]);
    const [filteredTrackedGames, setFilteredTrackedGames] = useState([]);
    const [showTracked, setShowTracked] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [trackedSearchQuery, setTrackedSearchQuery] = useState('');
    const [selectedSite, setSelectedSite] = useState('all');
    const [selectedGames, setSelectedGames] = useState(new Set());
    const [selectAll, setSelectAll] = useState(false);
    const [sortBy, setSortBy] = useState('date'); // date, title, source
    const [filterBy, setFilterBy] = useState('all'); // all, recent, older
    const [searchDebounceTimer, setSearchDebounceTimer] = useState(null);

    // Helper function to determine game status
    const getGameStatus = (game) => {
        if (!game.trackedSince) return null;
        
        const now = new Date();
        const trackedDate = new Date(game.trackedSince);
        const gameDate = game.date ? new Date(game.date) : null;
        const lastChecked = game.lastChecked ? new Date(game.lastChecked) : trackedDate;
        
        // Calculate time differences
        const daysSinceTracked = Math.floor((now - trackedDate) / (1000 * 60 * 60 * 24));
        const daysSinceRelease = gameDate ? Math.floor((now - gameDate) / (1000 * 60 * 60 * 24)) : null;
        const hoursSinceLastCheck = Math.floor((now - lastChecked) / (1000 * 60 * 60));
        
        // Priority statuses (most important first)
        if (hoursSinceLastCheck > 48) {
            return { type: 'needs-check', label: '⚠️ Needs Update Check', color: 'bg-yellow-100 text-yellow-800' };
        } else if (game.hasUpdate) {
            return { type: 'update-available', label: '� Update Available', color: 'bg-red-100 text-red-800' };
        } else if (daysSinceTracked < 1) {
            return { type: 'new', label: '🆕 Just Tracked', color: 'bg-blue-100 text-blue-800' };
        } else if (daysSinceRelease && daysSinceRelease < 7) {
            return { type: 'fresh', label: '🔥 Hot Release', color: 'bg-orange-100 text-orange-800' };
        } else if (daysSinceTracked < 7) {
            return { type: 'recent', label: '📅 Recently Added', color: 'bg-green-100 text-green-800' };
        } else if (daysSinceTracked < 30) {
            return { type: 'stable', label: '📌 Active Tracking', color: 'bg-gray-100 text-gray-700' };
        } else {
            return { type: 'old', label: '📜 Long-term Watch', color: 'bg-purple-100 text-purple-700' };
        }
    };

    // Helper function to format last checked time
    const getLastCheckedInfo = (game) => {
        if (!game.trackedSince) return null;
        
        const trackedDate = new Date(game.trackedSince);
        const now = new Date();
        const diffInHours = Math.floor((now - trackedDate) / (1000 * 60 * 60));
        const diffInDays = Math.floor(diffInHours / 24);
        
        if (diffInHours < 1) {
            return 'Just tracked';
        } else if (diffInHours < 24) {
            return `${diffInHours}h ago`;
        } else if (diffInDays < 7) {
            return `${diffInDays}d ago`;
        } else {
            return trackedDate.toLocaleDateString();
        }
    };

    useEffect(() => {
        loadGames();
        loadTrackedGames();
    }, []);

    // Cleanup effect for debounce timer
    useEffect(() => {
        return () => {
            if (searchDebounceTimer) {
                clearTimeout(searchDebounceTimer);
            }
        };
    }, [searchDebounceTimer]);

    const loadGames = async () => {
        try {
            console.log('Loading games with query:', searchQuery, 'site:', selectedSite);
            const data = searchQuery 
                ? await searchGames(searchQuery, selectedSite)
                : await getRecentGames();
            
            console.log('Received data:', data);
            
            if (!data.success) {
                throw new Error(data.error || 'Failed to load games');
            }
            
            // Map the game data to match the worker API response format
            const formattedGames = (data.results || []).map(game => ({
                ...game,
                id: game.id || game.originalId,
                title: game.title,
                date: game.date,
                image: game.image,
                excerpt: game.excerpt,
                source: game.source,
                siteType: game.siteType,
                downloadLinks: game.downloadLinks || []
            }));
            
            setGames(formattedGames);
            console.log('Updated games state:', formattedGames);
        } catch (err) {
            console.error('Error loading games:', err);
            setError(err.message || 'Failed to load games');
        } finally {
            setLoading(false);
        }
    };

    const loadTrackedGames = async () => {
        try {
            const tracked = await getTrackedGames();
            setTrackedGames(tracked);
            // Reapply current filters after loading
            setTimeout(() => filterTrackedGames(trackedSearchQuery), 0);
        } catch (err) {
            console.error('Failed to load tracked games:', err);
            setTrackedGames([]);
            setFilteredTrackedGames([]);
        }
    };

    const filterTrackedGames = (query) => {
        setTrackedSearchQuery(query);
        
        // Clear previous timer
        if (searchDebounceTimer) {
            clearTimeout(searchDebounceTimer);
        }
        
        // Set new timer for debounced search
        const timer = setTimeout(() => {
            let filtered = trackedGames;
            
            if (query.trim()) {
                const searchTerm = query.toLowerCase();
                filtered = trackedGames.filter(game =>
                    game.title.toLowerCase().includes(searchTerm) ||
                    (game.source && game.source.toLowerCase().includes(searchTerm)) ||
                    (game.excerpt && game.excerpt.toLowerCase().includes(searchTerm))
                );
            }
            
            // Apply additional filters
            if (filterBy !== 'all') {
                const now = new Date();
                const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                
                if (filterBy === 'recent') {
                    filtered = filtered.filter(game => 
                        game.trackedSince && new Date(game.trackedSince) >= oneWeekAgo
                    );
                } else if (filterBy === 'older') {
                    filtered = filtered.filter(game => 
                        game.trackedSince && new Date(game.trackedSince) < oneWeekAgo
                    );
                }
            }
            
            // Apply sorting
            filtered = filtered.sort((a, b) => {
                switch (sortBy) {
                    case 'title':
                        return a.title.localeCompare(b.title);
                    case 'source':
                        return (a.source || '').localeCompare(b.source || '');
                    case 'date':
                    default:
                        return new Date(b.date || 0) - new Date(a.date || 0);
                }
            });
            
            setFilteredTrackedGames(filtered);
            
            // Clear selections when filter changes
            setSelectedGames(new Set());
            setSelectAll(false);
        }, 300); // 300ms debounce
        
        setSearchDebounceTimer(timer);
    };    const handleTrackGame = async (game) => {
        try {
            await trackGame(game.id, game.title);
            await loadTrackedGames();
            alert('Game tracked successfully!');
        } catch (err) {
            if (err.response?.status === 409) {
                alert('This game is already being tracked');
            } else {
                alert('Failed to track game');
            }
        }
    };

    const handleUntrackGame = async (gameId) => {
        try {
            await untrackGame(gameId);
            await loadTrackedGames();
            setSelectedGames(prev => {
                const newSet = new Set(prev);
                newSet.delete(gameId);
                return newSet;
            });
            alert('Game untracked successfully!');
        } catch (err) {
            alert('Failed to untrack game');
        }
    };

    // Bulk operations functions
    const handleSelectGame = (gameId) => {
        setSelectedGames(prev => {
            const newSet = new Set(prev);
            if (newSet.has(gameId)) {
                newSet.delete(gameId);
            } else {
                newSet.add(gameId);
            }
            return newSet;
        });
    };

    const handleSelectAll = () => {
        if (selectAll) {
            setSelectedGames(new Set());
        } else {
            const allIds = new Set(filteredTrackedGames.map(game => game.id));
            setSelectedGames(allIds);
        }
        setSelectAll(!selectAll);
    };

    const handleBulkUntrack = async () => {
        if (selectedGames.size === 0) {
            alert('Please select games to untrack');
            return;
        }

        if (confirm(`Are you sure you want to untrack ${selectedGames.size} games?`)) {
            try {
                const promises = Array.from(selectedGames).map(gameId => untrackGame(gameId));
                await Promise.all(promises);
                await loadTrackedGames();
                setSelectedGames(new Set());
                setSelectAll(false);
                alert(`Successfully untracked ${selectedGames.size} games!`);
            } catch (err) {
                alert('Failed to untrack some games');
            }
        }
    };

    // Update selectAll state based on selected games
    useEffect(() => {
        if (filteredTrackedGames.length > 0) {
            const allSelected = filteredTrackedGames.every(game => selectedGames.has(game.id));
            setSelectAll(allSelected && filteredTrackedGames.length > 0);
        }
    }, [selectedGames, filteredTrackedGames]);

    const handleGameSelect = async (game) => {
        setSelectedGame(game);
        try {
            const supported = await checkSupportedDownloaders(game.id);
            setSupportedDownloaders(supported);
        } catch (err) {
            setError('Failed to check supported downloaders');
        }
    };

    const handleDownload = async (game, downloadLink, downloader) => {
        try {
            await addDownload(game.id, {
                url: downloadLink.url,
                service: downloadLink.service,
                downloader: downloader
            });
            alert('Download added successfully!');
        } catch (err) {
            setError('Failed to add download');
        }
    };

    if (loading) return <div className="p-4 text-gray-900 dark:text-gray-100">Loading...</div>;
    if (error) return <div className="p-4 text-red-500">{error}</div>;

    const displayedGames = showTracked ? filteredTrackedGames : games;

    return (
        <>
            <div className="container mx-auto p-4">
                {/* Enhanced Header Section */}
                <div className="mb-8 bg-white dark:bg-gray-800 rounded-lg shadow-sm border dark:border-gray-700">
                    <div className="p-6">
                        <h1 className="text-xl sm:text-2xl font-bold text-gray-800 dark:text-gray-100 mb-3 sm:mb-4 flex items-center gap-2">
                            {showTracked ? '📚 Your Tracked Games' : '🎮 Game Library'}
                        </h1>
                        
                        {/* Search and Controls */}
                        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 mb-4">
                            {!showTracked ? (
                                <>
                                    <input 
                                        type="text"
                                        placeholder="Search games..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        onKeyPress={(e) => e.key === 'Enter' && loadGames()}
                                        className="flex-1 min-w-0 p-2 sm:p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-gray-100 text-sm sm:text-base"
                                    />
                                    <div className="flex gap-2 sm:gap-3">
                                        <select 
                                            value={selectedSite}
                                            onChange={(e) => setSelectedSite(e.target.value)}
                                            className="flex-1 sm:flex-initial p-2 sm:p-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-100 text-sm sm:text-base"
                                        >
                                            <option value="all">All Sites</option>
                                            <option value="skidrow">SkidrowReloaded</option>
                                            <option value="freegog">FreeGOGPCGames</option>
                                            <option value="gamedrive">GameDrive</option>
                                            <option value="steamrip">SteamRip</option>
                                        </select>
                                        <button 
                                            onClick={loadGames}
                                            className="bg-blue-500 dark:bg-blue-600 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg hover:bg-blue-600 dark:hover:bg-blue-700 transition-colors font-medium text-sm sm:text-base"
                                        >
                                            Search
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <input 
                                            type="text"
                                            placeholder="Search tracked games..."
                                            value={trackedSearchQuery}
                                            onChange={(e) => filterTrackedGames(e.target.value)}
                                            className="flex-1 p-2 sm:p-3 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm sm:text-base"
                                        />
                                    </div>
                                    <div className="flex gap-2 sm:gap-3">
                                        <select 
                                            value={sortBy}
                                            onChange={(e) => {
                                                setSortBy(e.target.value);
                                                setTimeout(() => filterTrackedGames(trackedSearchQuery), 0);
                                            }}
                                            className="flex-1 sm:flex-initial p-2 sm:p-3 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 text-sm sm:text-base"
                                        >
                                            <option value="date">📅 Sort by Date</option>
                                            <option value="title">🔤 Sort by Title</option>
                                            <option value="source">🌐 Sort by Source</option>
                                        </select>
                                        <select 
                                            value={filterBy}
                                            onChange={(e) => {
                                                setFilterBy(e.target.value);
                                                setTimeout(() => filterTrackedGames(trackedSearchQuery), 0);
                                            }}
                                            className="flex-1 sm:flex-initial p-2 sm:p-3 border border-green-300 rounded-lg focus:ring-2 focus:ring-green-500 text-sm sm:text-base"
                                        >
                                            <option value="all">📚 All Games</option>
                                            <option value="recent">🆕 Recently Tracked</option>
                                            <option value="older">📜 Older Games</option>
                                        </select>
                                    </div>
                                    <button
                                        onClick={loadTrackedGames}
                                        className="w-full sm:w-auto bg-green-500 text-white px-4 sm:px-6 py-2 sm:py-3 rounded-lg hover:bg-green-600 transition-colors font-medium flex items-center justify-center gap-2 text-sm sm:text-base"
                                    >
                                        🔄 Refresh
                                    </button>
                                </>
                            )}
                            {localStorage.getItem('token') && (
                                <button
                                    onClick={() => {
                                        setShowTracked(!showTracked);
                                        setSelectedGames(new Set()); // Clear selections when switching views
                                        setSelectAll(false);
                                        if (!showTracked) {
                                            loadTrackedGames();
                                        }
                                    }}
                                    className={`w-full sm:w-auto px-4 sm:px-6 py-2 sm:py-3 rounded-lg font-medium transition-colors whitespace-nowrap text-sm sm:text-base ${
                                        showTracked 
                                            ? 'bg-gray-500 text-white hover:bg-gray-600' 
                                            : 'bg-green-500 text-white hover:bg-green-600'
                                    }`}
                                >
                                    {showTracked ? '← Browse Games' : `📚 Tracked (${trackedGames.length})`}
                                </button>
                            )}
                        </div>
                        
                        {/* Enhanced Status Info */}
                        {showTracked && (
                            <>
                                <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="text-green-800 font-medium">
                                                📚 {filteredTrackedGames.length} of {trackedGames.length} tracked games
                                            </div>
                                            <div className="text-green-600 text-sm mt-1 flex items-center gap-4">
                                                <span>
                                                    {trackedSearchQuery 
                                                        ? `🔍 Search: "${trackedSearchQuery}"` 
                                                        : filterBy === 'recent' ? '🆕 Recent games'
                                                        : filterBy === 'older' ? '📜 Older games'
                                                        : '📚 All games'}
                                                </span>
                                                <span>
                                                    {sortBy === 'title' ? '🔤 Sorted by title'
                                                    : sortBy === 'source' ? '🌐 Sorted by source'
                                                    : '📅 Sorted by date'}
                                                </span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {(trackedSearchQuery || filterBy !== 'all' || sortBy !== 'date') && (
                                                <button
                                                    onClick={() => {
                                                        filterTrackedGames('');
                                                        setFilterBy('all');
                                                        setSortBy('date');
                                                    }}
                                                    className="text-green-600 hover:text-green-800 text-sm underline"
                                                >
                                                    🧹 Clear all filters
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* Bulk Actions */}
                                {filteredTrackedGames.length > 0 && (
                                    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 mb-6">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-4">
                                                <label className="flex items-center gap-2 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={selectAll}
                                                        onChange={handleSelectAll}
                                                        className="w-4 h-4 text-green-600 border-gray-300 rounded focus:ring-green-500"
                                                    />
                                                    <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                                                        Select all ({filteredTrackedGames.length})
                                                    </span>
                                                </label>
                                                {selectedGames.size > 0 && (
                                                    <span className="text-sm text-blue-600 bg-blue-100 px-2 py-1 rounded">
                                                        {selectedGames.size} selected
                                                    </span>
                                                )}
                                            </div>
                                            
                                            {selectedGames.size > 0 && (
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={handleBulkUntrack}
                                                        className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-600 transition-colors flex items-center gap-2"
                                                    >
                                                        🗑️ Untrack {selectedGames.size} game{selectedGames.size !== 1 ? 's' : ''}
                                                    </button>
                                                    <button
                                                        onClick={() => setSelectedGames(new Set())}
                                                        className="bg-gray-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-600 transition-colors"
                                                    >
                                                        Clear selection
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}

                        {/* Status Legend for Tracked Games */}
                        {showTracked && filteredTrackedGames.length > 0 && (
                            <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-4 mb-6">
                                <h3 className="text-sm font-medium text-gray-800 dark:text-gray-100 mb-3">📊 Status Indicators</h3>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 text-xs">
                                    <div className="flex items-center gap-1">
                                        <span className="bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300 px-2 py-1 rounded-full">⚠️</span>
                                        <span className="text-gray-600 dark:text-gray-300">Needs Check</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span className="bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300 px-2 py-1 rounded-full">🆙</span>
                                        <span className="text-gray-600 dark:text-gray-300">Update Available</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-800 dark:text-blue-300 px-2 py-1 rounded-full">🆕</span>
                                        <span className="text-gray-600 dark:text-gray-300">Just Tracked</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span className="bg-orange-100 dark:bg-orange-900/30 text-orange-800 dark:text-orange-300 px-2 py-1 rounded-full">🔥</span>
                                        <span className="text-gray-600 dark:text-gray-300">Hot Release</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300 px-2 py-1 rounded-full">📅</span>
                                        <span className="text-gray-600 dark:text-gray-300">Recently Added</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-1 rounded-full">📌</span>
                                        <span className="text-gray-600 dark:text-gray-300">Active Tracking</span>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <span className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 px-2 py-1 rounded-full">📜</span>
                                        <span className="text-gray-600 dark:text-gray-300">Long-term Watch</span>
                                    </div>
                                </div>
                            </div>
                        )}
                        
                        {!showTracked && games.length > 0 && (
                            <div className="text-sm text-gray-600 dark:text-gray-300 bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
                                🎮 Found {games.length} games • {searchQuery ? `Search: "${searchQuery}"` : 'Recent releases'} • Source: {selectedSite === 'all' ? 'All sites' : selectedSite}
                            </div>
                        )}
                    </div>
                </div>
                
                {/* Enhanced Game Cards Grid */}
                {displayedGames.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4 lg:gap-6">
                        {displayedGames.map(game => (
                            <div key={game.id} className={`bg-white dark:bg-gray-800 rounded-xl shadow-md hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1 overflow-hidden dark:border dark:border-gray-700 ${
                                showTracked ? 'ring-2 ring-green-200 border-green-300' : 'border border-gray-200'
                            }`}>
                                <div className="flex flex-col h-full">
                                    {/* Game Image */}
                                    {game.image && (
                                        <div className="relative">
                                            <ProxiedImage
                                                src={game.image}
                                                alt={game.title}
                                                className="w-full h-48 object-cover"
                                            />
                                            {showTracked && (
                                                <>
                                                    <div className="absolute top-3 left-3">
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedGames.has(game.id)}
                                                            onChange={() => handleSelectGame(game.id)}
                                                            className="w-5 h-5 text-green-600 border-2 border-white rounded focus:ring-green-500 shadow-lg cursor-pointer"
                                                        />
                                                    </div>
                                                    <div className="absolute top-3 right-3 flex flex-col gap-1 items-end">
                                                        {(() => {
                                                            const status = getGameStatus(game);
                                                            return status ? (
                                                                <span className={`text-xs px-2 py-1 rounded-full font-medium shadow-lg ${status.color}`}>
                                                                    {status.label}
                                                                </span>
                                                            ) : null;
                                                        })()}
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    )}
                                    
                                    {/* Card Content */}
                                    <div className="p-4 flex-1 flex flex-col">
                                        {/* Title and Source */}
                                        <div className="mb-3">
                                            <div className="flex items-start justify-between gap-2 mb-2">
                                                <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100 line-clamp-2 flex-1">
                                                    {game.title}
                                                </h3>
                                                {showTracked && !game.image && (
                                                    <input
                                                        type="checkbox"
                                                        checked={selectedGames.has(game.id)}
                                                        onChange={() => handleSelectGame(game.id)}
                                                        className="w-5 h-5 text-green-600 border-gray-300 rounded focus:ring-green-500 cursor-pointer mt-1"
                                                    />
                                                )}
                                            </div>
                                            {game.source && (
                                                <div className="flex items-center gap-2">
                                                    <span className="bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-2 py-1 rounded-full">
                                                        🌐 {game.source}
                                                    </span>
                                                    {game.date && (
                                                        <span className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs px-2 py-1 rounded-full">
                                                            📅 {new Date(game.date).toLocaleDateString()}
                                                        </span>
                                                    )}
                                                </div>
                                            )}
                                            {showTracked && game.trackedSince && (
                                                <div className="mt-2 space-y-2">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-xs px-2 py-1 rounded-full">
                                                            📌 Tracked {getLastCheckedInfo(game)}
                                                        </span>
                                                        {(() => {
                                                            const status = getGameStatus(game);
                                                            if (status && status.type !== 'new') {
                                                                return (
                                                                    <span className={`text-xs px-2 py-1 rounded-full ${status.color}`}>
                                                                        {status.label}
                                                                    </span>
                                                                );
                                                            }
                                                            return null;
                                                        })()}
                                                    </div>
                                                    {game.lastChecked && (
                                                        <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
                                                            🔄 Last check: {new Date(game.lastChecked).toLocaleString()}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                        
                                        {/* Description */}
                                        {game.excerpt && (
                                            <p className="text-gray-600 dark:text-gray-300 text-sm line-clamp-3 mb-4 flex-1">
                                                {game.excerpt}
                                            </p>
                                        )}
                                        
                                        {/* Action Buttons */}
                                        <div className="flex gap-2 mt-auto">
                                            {!showTracked && (
                                                <button 
                                                    onClick={() => {
                                                        if (!localStorage.getItem('token')) {
                                                            alert('Please log in to track games');
                                                            return;
                                                        }
                                                        handleTrackGame(game);
                                                    }}
                                                    className="bg-green-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-600 transition-colors flex items-center gap-2 flex-1"
                                                >
                                                    📌 Track
                                                </button>
                                            )}
                                            {showTracked && (
                                                <button 
                                                    onClick={() => handleUntrackGame(game.id)}
                                                    className="bg-red-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-600 transition-colors flex items-center gap-2 flex-1"
                                                >
                                                    🗑️ Untrack
                                                </button>
                                            )}
                                            <button 
                                                onClick={() => {
                                                    if (!localStorage.getItem('token')) {
                                                        alert('Please log in to access download features');
                                                        return;
                                                    }
                                                    handleGameSelect(game);
                                                }}
                                                className="bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-600 transition-colors flex items-center gap-2 flex-1"
                                            >
                                                💾 Download
                                            </button>
                                        </div>
                                        
                                        {/* Download Options */}
                                        {selectedGame?.id === game.id && supportedDownloaders.length > 0 && game.downloadLinks && game.downloadLinks.length > 0 && (
                                            <div className="mt-4 pt-4 border-t border-gray-200">
                                                <h4 className="font-semibold text-gray-800 dark:text-gray-100 mb-3 flex items-center gap-2">
                                                    ⚡ Download Options
                                                </h4>
                                                {supportedDownloaders.map((downloader, index) => (
                                                    <div key={index} className="mb-3">
                                                        <label className="block text-xs text-gray-600 dark:text-gray-300 mb-1 font-medium">
                                                            Via {downloader}
                                                        </label>
                                                        <select 
                                                            className="w-full p-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                                                            onChange={(e) => {
                                                                const link = game.downloadLinks?.find(dl => dl.url === e.target.value);
                                                                if (link) {
                                                                    handleDownload(game, link, downloader);
                                                                    e.target.value = ''; // Reset selection
                                                                }
                                                            }}
                                                        >
                                                            <option value="">Choose source...</option>
                                                            {game.downloadLinks?.map((dl, i) => (
                                                                <option key={i} value={dl.url}>
                                                                    {dl.service || dl.type} - {dl.text || 'Download'}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-16 bg-gray-50 rounded-xl border-2 border-dashed border-gray-300">
                        <div className="text-6xl mb-4">
                            {showTracked ? '📚' : '🎮'}
                        </div>
                        <h3 className="text-xl font-semibold text-gray-600 dark:text-gray-300 mb-2">
                            {showTracked ? 'No tracked games yet' : 'No games found'}
                        </h3>
                        <p className="text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                            {showTracked ? (
                                <>
                                    Start tracking games to monitor updates and new releases. 
                                    <button 
                                        onClick={() => setShowTracked(false)} 
                                        className="text-blue-500 hover:text-blue-700 underline ml-1"
                                    >
                                        Browse games
                                    </button>
                                </>
                            ) : (
                                searchQuery 
                                    ? 'Try adjusting your search terms or selecting a different site.'
                                    : 'Search for games above or refresh to see the latest releases.'
                            )}
                        </p>
                    </div>
                )}
            </div>
        </>
    );
};

export default Dashboard;