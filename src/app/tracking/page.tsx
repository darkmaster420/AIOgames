"use client";

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useSession } from 'next-auth/react';
import { GameDownloadLinks } from '../../components/GameDownloadLinks';
import { TrackedGamePosterCard } from '../../components/TrackedGamePosterCard';
import { SteamVerification } from '../../components/SteamVerification';
import { SmartVersionVerification } from '../../components/SmartVersionVerification';
import GOGVerification from '../../components/GOGVerification';

import { SequelNotifications } from '../../components/SequelNotifications';
import { AddCustomGame } from '../../components/AddCustomGame';
import { NotificationToggle } from '../../components/NotificationToggle';
import { SearchGameButton } from '../../components/SearchGameButton';
import { useConfirm } from '../../contexts/ConfirmContext';
import { ImageWithFallback } from '../../utils/imageProxy';
import { cleanGameTitle } from '../../utils/steamApi';

import { useNotification } from '../../contexts/NotificationContext';
import { ExternalLinkIcon } from '../../components/ExternalLinkIcon';



interface TrackedGame {
  _id: string;
  gameId: string;
  title: string;
  originalTitle: string;
  source: string;
  image?: string;
  description: string;
  gameLink: string;
  lastKnownVersion: string;
  steamAppId?: number;
  steamName?: string;
  steamVerified?: boolean;
  gogVerified?: boolean;
  gogProductId?: number;
  gogName?: string;
  gogVersion?: string;
  gogBuildId?: string;
  gogLastChecked?: Date;
  buildNumberVerified?: boolean;
  currentBuildNumber?: string;
  buildNumberSource?: string;
  versionNumberVerified?: boolean;
  currentVersionNumber?: string;
  versionNumberSource?: string;
  lastVersionDate?: string;
  dateAdded: string;
  lastChecked: string;
  notificationsEnabled: boolean;
  checkFrequency: string;
  hasNewUpdate?: boolean;
  newUpdateSeen?: boolean;
  steamdbUpdate?: {
    title: string;
    version?: string;
    buildNumber?: string;
    date: string;
    link: string;
    isOutdated?: boolean;
    outdatedReason?: string;
    suggestion?: string;
  };
  updateHistory: Array<{
    version: string;
    dateFound: string;
    gameLink: string;
    isLatest?: boolean;
    isOnlineFix?: boolean;
    downloadLinks?: Array<{
      service: string;
      url: string;
      type: string;
    }>;
  }>;
  latestApprovedUpdate?: {
    version: string;
    dateFound: string;
    gameLink: string;
    isOnlineFix?: boolean;
    downloadLinks?: Array<{
      service: string;
      url: string;
      type: string;
    }>;
  };
  pendingUpdates?: Array<{
    _id: string;
    newTitle: string;
    detectedVersion: string;
    reason: string;
    dateFound: string;
    aiDetectionConfidence?: number;
    aiDetectionReason?: string;
    detectionMethod?: string;
    downloadLinks?: Array<{
      service: string;
      url: string;
      type: string;
    }>;
  }>;
  isActive: boolean;
}

export default function TrackingDashboard() {
  const { status } = useSession();
  const { showSuccess, showError, showInfo } = useNotification();
  const { confirm } = useConfirm();
  const [trackedGames, setTrackedGames] = useState<TrackedGame[]>([]);
  const [filteredGames, setFilteredGames] = useState<TrackedGame[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checkingSingleGame, setCheckingSingleGame] = useState<string | null>(null);

  // Steam latest version/build info fetched from SteamDB RSS
  interface SteamLatestInfo {
    version?: string;
    build?: string;
    date?: string;
    link?: string;
  }
  const [steamLatest, setSteamLatest] = useState<Record<string, SteamLatestInfo>>({});

  interface GOGLatestInfo {
    version?: string;
    buildId?: string;
    date?: string;
  }
  const [gogLatest, setGogLatest] = useState<Record<string, GOGLatestInfo>>({});

  // Sort functionality
  const [sortBy, setSortBy] = useState<'title' | 'dateAdded' | 'lastChecked' | 'lastUpdated'>('dateAdded');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  
  // Advanced view for showing original titles
  const [showAdvanced, setShowAdvanced] = useState(false);
  
  // Layout mode: 'grid' (responsive), 'list' (1 column), 'horizontal' (1 row)
  const [layoutMode, setLayoutMode] = useState<'grid' | 'list' | 'horizontal'>('grid');
  
  // Layout customization state
  const [customCols, setCustomCols] = useState<number | 'auto'>('auto');
  const [customRows, setCustomRows] = useState<number | 'auto'>('auto');

  // Dropdown state for mobile layout settings
  const [showLayoutDropdown, setShowLayoutDropdown] = useState(false);

  // Compute grid style for custom layout
  const customGridStyle = layoutMode === 'grid' ? {
    display: 'grid',
    gridTemplateColumns: customCols === 'auto' ? undefined : `repeat(${customCols}, minmax(0, 1fr))`,
    gridTemplateRows: customRows === 'auto' ? undefined : `repeat(${customRows}, minmax(0, 1fr))`,
    gap: '1rem',
  } : undefined;
  
  // Title migration state
  const [migrationStatus, setMigrationStatus] = useState<{
    checking: boolean;
    migrating: boolean;
    needsMigration: number;
    total: number;
    lastCheck: number | null;
  }>({
    checking: false,
    migrating: false,
    needsMigration: 0,
    total: 0,
    lastCheck: null
  });

  // Sort games function
  // Helper function to get display title for a game
  const getDisplayTitle = useCallback((game: TrackedGame): string => {
    // If Steam verified, use Steam name
    if (game.steamVerified && game.steamName) {
      return game.steamName;
    }
    
    // If GOG verified AND not marked as "Not on GOG", use GOG name
    if (game.gogVerified && game.gogName && game.gogProductId !== -1) {
      return game.gogName;
    }
    
    // For unverified games or games marked as "Not on GOG", use cleaned title
    return cleanGameTitle(game.originalTitle || game.title);
  }, []); // No dependencies - cleanGameTitle is stable

  const sortGames = useCallback((games: TrackedGame[], sortField: string, order: string) => {
    return [...games].sort((a, b) => {
      let aValue: string | number | Date;
      let bValue: string | number | Date;

      switch (sortField) {
        case 'title':
          // Use display title (cleaned or verified name) for sorting
          aValue = getDisplayTitle(a).toLowerCase();
          bValue = getDisplayTitle(b).toLowerCase();
          break;
        case 'dateAdded':
          aValue = new Date(a.dateAdded);
          bValue = new Date(b.dateAdded);
          break;
        case 'lastChecked':
          aValue = new Date(a.lastChecked);
          bValue = new Date(b.lastChecked);
          break;
        case 'lastUpdated':
          // Use latest approved update date or fall back to last checked
          aValue = a.latestApprovedUpdate 
            ? new Date(a.latestApprovedUpdate.dateFound)
            : new Date(a.lastChecked);
          bValue = b.latestApprovedUpdate 
            ? new Date(b.latestApprovedUpdate.dateFound)
            : new Date(b.lastChecked);
          break;
        default:
          aValue = a.dateAdded;
          bValue = b.dateAdded;
      }

      if (aValue < bValue) return order === 'asc' ? -1 : 1;
      if (aValue > bValue) return order === 'asc' ? 1 : -1;
      return 0;
    });
  }, [getDisplayTitle]);

  // Handle sort change
  const handleSortChange = (newSortBy: typeof sortBy) => {
    if (newSortBy === sortBy) {
      // Toggle order if same field
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to desc for dates, asc for title
      setSortBy(newSortBy);
      setSortOrder(newSortBy === 'title' ? 'asc' : 'desc');
    }
  };

  // Handle Steam verification updates
  const handleVerificationUpdate = (gameId: string, verified: boolean, steamAppId?: number, steamName?: string) => {
    setTrackedGames(prev => prev.map(game => 
      game._id === gameId 
        ? { ...game, steamVerified: verified, steamAppId, steamName }
        : game
    ));
  };

  // Note: GOG verification updates are handled via loadTrackedGames() callback

  // Handle marking update as seen
  const handleMarkUpdateSeen = async (gameId: string) => {
    try {
      const response = await fetch('/api/games/mark-seen', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ gameId }),
      });

      if (response.ok) {
        // Update the local state
        setTrackedGames(prev => prev.map(game => 
          game._id === gameId 
            ? { ...game, hasNewUpdate: false, newUpdateSeen: true }
            : game
        ));
        showSuccess('Update marked as seen');
      } else {
        const error = await response.json();
        showError(error.error || 'Failed to mark update as seen');
      }
    } catch {
      showError('Failed to mark update as seen');
    }
  };

  // Handle single game update check
  // Helper function to check if tracked version is outdated compared to SteamDB
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const checkIfVersionOutdated = useCallback((game: TrackedGame, latestSteamUpdate: any) => {
    const result = {
      isOutdated: false,
      reason: '',
      trackedVersion: '',
      steamVersion: '',
      steamBuild: '',
      suggestion: ''
    };

    // Get Steam version/build info
    const steamVersion = latestSteamUpdate.version;
    const steamBuild = latestSteamUpdate.changeNumber;
    const steamDate = new Date(latestSteamUpdate.date);
    
    result.steamVersion = steamVersion || '';
    result.steamBuild = steamBuild || '';

    // Get tracked version info (from direct fields or GOG data)
    const trackedVersion = game.lastKnownVersion || '';
    const trackedBuildNumber = game.currentBuildNumber || game.gogBuildId || '';
    const trackedVersionNumber = game.currentVersionNumber || game.gogVersion || '';
    result.trackedVersion = trackedVersion;

    // Check build numbers first (most reliable)
    if (steamBuild && trackedBuildNumber) {
      const trackedBuildNum = parseInt(trackedBuildNumber);
      const steamBuildNum = parseInt(steamBuild);
      
      if (!isNaN(trackedBuildNum) && !isNaN(steamBuildNum) && steamBuildNum > trackedBuildNum) {
        result.isOutdated = true;
        result.reason = `Your tracked build ${trackedBuildNum} is behind Steam build ${steamBuildNum}`;
        result.suggestion = 'A newer version should be available soon!';
        return result;
      }
    }

    // Check version numbers if available
    if (steamVersion && trackedVersionNumber) {
      const comparison = compareVersions(trackedVersionNumber, steamVersion);
      if (comparison < 0) {
        result.isOutdated = true;
        result.reason = `Your tracked version ${trackedVersionNumber} is behind Steam version ${steamVersion}`;
        result.suggestion = 'A newer version should be available soon!';
        return result;
      }
    }

    // Check against last known version string
    if (steamVersion && trackedVersion) {
      // Extract version from tracked version string
      const trackedVersionMatch = trackedVersion.match(/v?(\d+\.\d+(?:\.\d+)?)/i);
      if (trackedVersionMatch) {
        const trackedVersionNum = trackedVersionMatch[1];
        const comparison = compareVersions(trackedVersionNum, steamVersion);
        if (comparison < 0) {
          result.isOutdated = true;
          result.reason = `Your tracked version ${trackedVersionNum} is behind Steam version ${steamVersion}`;
          result.suggestion = 'A newer version should be available soon!';
          return result;
        }
      }
    }

    // If Steam update is very recent (within 24 hours) and we have any version info, suggest checking
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    if (steamDate > oneDayAgo && (steamVersion || steamBuild)) {
      result.isOutdated = true;
      result.reason = 'New Steam update detected within 24 hours';
      result.suggestion = 'Check if a new version is available!';
      return result;
    }

    return result;
  }, []);

  // Helper function to compare version strings (returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2)
  const compareVersions = (v1: string, v2: string): number => {
    const clean1 = v1.replace(/^v/i, '').split('.').map(n => parseInt(n) || 0);
    const clean2 = v2.replace(/^v/i, '').split('.').map(n => parseInt(n) || 0);
    
    const maxLength = Math.max(clean1.length, clean2.length);
    
    for (let i = 0; i < maxLength; i++) {
      const num1 = clean1[i] || 0;
      const num2 = clean2[i] || 0;
      
      if (num1 < num2) return -1;
      if (num1 > num2) return 1;
    }
    
    return 0;
  };

  const handleSingleGameUpdate = async (gameId: string, gameTitle: string) => {
    try {
      setCheckingSingleGame(gameId);
      
      // Find the game to check if it's Steam-verified
      const game = trackedGames.find(g => g._id === gameId);
      
      // Check for regular updates
      const response = await fetch('/api/updates/check-single', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId })
      });
      
      let totalUpdatesFound = 0;
      let totalSequelsFound = 0;
      let steamdbUpdateFound = false;
      
      if (response.ok) {
        const result = await response.json();
        totalUpdatesFound = result.updatesFound || 0;
        totalSequelsFound = result.sequelsFound || 0;
      }
      
      // Check SteamDB for Steam-verified or GOG-verified games with a Steam App ID
      if (game?.steamAppId && (game?.steamVerified || game?.gogVerified)) {
        try {
          const steamResponse = await fetch(`/api/steamdb?action=updates&appId=${game.steamAppId}`);
          if (steamResponse.ok) {
            const steamData = await steamResponse.json();
            const steamUpdates = steamData.data?.updates || [];
            
            if (steamUpdates.length > 0) {
              const latestSteamUpdate = steamUpdates[0]; // Most recent update
              
              // If Steam has no version but GOG does, use GOG version for comparison
              if (!latestSteamUpdate.version && game?.gogVersion) {
                latestSteamUpdate.version = game.gogVersion;
              }

              // Store latest Steam info for this game card
              setSteamLatest(prev => ({
                ...prev,
                [game._id]: {
                  version: latestSteamUpdate.version,
                  build: latestSteamUpdate.changeNumber,
                  date: latestSteamUpdate.date,
                  link: latestSteamUpdate.link,
                },
              }));
              
              // Check if there are recent updates (last 7 days)
              const weekAgo = new Date();
              weekAgo.setDate(weekAgo.getDate() - 7);
              
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const recentSteamUpdates = steamUpdates.filter((update: any) => 
                new Date(update.date) > weekAgo
              );
              
              if (recentSteamUpdates.length > 0) {
                steamdbUpdateFound = true;
              }
              
              // Cross-check with current tracked version
              const isVersionOutdated = checkIfVersionOutdated(game, latestSteamUpdate);
              if (isVersionOutdated.isOutdated) {
                steamdbUpdateFound = true; // Mark as update found even if not recent
                // Store the version comparison info for display
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                (window as any).steamVersionComparison = isVersionOutdated;
              }
            }
          }
        } catch (steamError) {
          console.warn('Failed to check SteamDB updates:', steamError);
        }
      }
      
      // Show appropriate success message
      if (totalUpdatesFound > 0 || totalSequelsFound > 0 || steamdbUpdateFound) {
        let message = `🎮 ${gameTitle}\n📊 Updates found: ${totalUpdatesFound}\n🎬 Sequels found: ${totalSequelsFound}`;
        
        if (steamdbUpdateFound) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const versionComparison = (window as any).steamVersionComparison;
          if (versionComparison?.isOutdated) {
            message += `\n⚠️ Version Check: ${versionComparison.reason}`;
            message += `\n💡 ${versionComparison.suggestion}`;
          } else {
            message += `\n⚡ SteamDB updates: Found recent updates!`;
          }
          // Clean up temporary storage
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          delete (window as any).steamVersionComparison;
        }
        
        showSuccess('Update Check Complete', message);
      } else {
        let message = `No new updates found for "${gameTitle}"`;
        if (game?.steamAppId && game?.steamVerified) {
          message += `\n✅ Checked SteamDB for Steam updates`;
          message += `\n✅ Your version appears up to date`;
        }
        showInfo('No Updates Found', message);
      }
      
      // Refresh the game data to show updated information
      loadTrackedGames();
    } catch (error) {
      console.error('Failed to check single game updates:', error);
      showError('Update Check Failed', `Failed to check updates for "${gameTitle}". Please try again.`);
    } finally {
      setCheckingSingleGame(null);
    }
  };

  const [checkingUpdates, setCheckingUpdates] = useState(false);

  // Filter and sort games based on search query and sort settings
  useEffect(() => {
    let games = trackedGames;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      games = trackedGames.filter(game => 
        getDisplayTitle(game).toLowerCase().includes(query) ||
        game.title.toLowerCase().includes(query) ||
        game.originalTitle.toLowerCase().includes(query) ||
        game.source.toLowerCase().includes(query) ||
        (game.steamName && game.steamName.toLowerCase().includes(query))
      );
    }

    // Apply sorting
    const sortedGames = sortGames(games, sortBy, sortOrder);
    setFilteredGames(sortedGames);
  }, [trackedGames, searchQuery, sortBy, sortOrder, sortGames, getDisplayTitle]);

  // After loading tracked games, fetch latest Steam info for Steam-verified ones
  useEffect(() => {
    const fetchSteamLatestForGames = async () => {
      const toFetch = trackedGames.filter(g => (g.steamVerified || g.gogVerified) && g.steamAppId && !steamLatest[g._id]);
      // Fetch sequentially with a small delay to be polite
      for (const g of toFetch) {
        try {
          const res = await fetch(`/api/steamdb?action=updates&appId=${g.steamAppId}&limit=1`, {
            // Leverage route cache headers via Next fetch cache
            cache: 'force-cache',
          });
          if (res.ok) {
            const data = await res.json();
            const latest = data.data?.updates?.[0];
            if (latest) {
              setSteamLatest(prev => ({
                ...prev,
                [g._id]: {
                  version: latest.version,
                  build: latest.changeNumber,
                  date: latest.date,
                  link: latest.link,
                },
              }));
            }
          }
        } catch {
          // Ignore per-game errors
        }
        // Throttle a bit between requests to avoid bursts
        await new Promise(r => setTimeout(r, 350));
      }
    };

    if (trackedGames.length) {
      fetchSteamLatestForGames();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedGames]);

  // Fetch latest GOG info for GOG-verified games
  useEffect(() => {
    const fetchGOGLatestForGames = async () => {
      const toFetch = trackedGames.filter(g => g.gogVerified && g.gogProductId && g.gogProductId !== -1 && !gogLatest[g._id]);
      // Fetch sequentially with a small delay
      for (const g of toFetch) {
        try {
          const res = await fetch(`/api/gogdb?action=version&productId=${g.gogProductId}&os=windows`, {
            cache: 'default', // Changed from 'force-cache' to avoid caching 404s
            next: { revalidate: 3600 } // Cache successful responses for 1 hour
          });
          if (res.ok) {
            const data = await res.json();
            if (data.success && (data.version || data.buildId)) {
              setGogLatest(prev => ({
                ...prev,
                [g._id]: {
                  version: data.version,
                  buildId: data.buildId,
                  date: data.date,
                },
              }));
            }
          }
        } catch {
          // Ignore per-game errors
        }
        // Throttle between requests
        await new Promise(r => setTimeout(r, 350));
      }
    };

    if (trackedGames.length) {
      fetchGOGLatestForGames();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trackedGames]);

  const loadTrackedGames = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/tracking');
      if (!response.ok) throw new Error('Failed to load tracked games');
      const data = await response.json();
      
      let games = data.games || [];
      
      // Fetch SteamDB updates for Steam-verified or GOG-verified games individually
      if (games.length > 0) {
        const steamVerifiedGames = games.filter((game: TrackedGame) => 
          game.steamAppId && (game.steamVerified || game.gogVerified)
        );
        
        if (steamVerifiedGames.length > 0) {
          // Fetch SteamDB data for each game in parallel
          const steamUpdatePromises = steamVerifiedGames.map(async (game: TrackedGame) => {
            try {
              const steamResponse = await fetch(`/api/steamdb?action=updates&appId=${game.steamAppId}`);
              if (steamResponse.ok) {
                const steamData = await steamResponse.json();
                const updates = steamData.data?.updates || [];
                if (updates.length > 0) {
                  const latestUpdate = updates[0]; // Most recent update
                  return {
                    appId: game.steamAppId?.toString(),
                    update: latestUpdate
                  };
                }
              }
            } catch (error) {
              console.warn(`Failed to fetch SteamDB for app ${game.steamAppId}:`, error);
            }
            return null;
          });
          
          const steamUpdates = (await Promise.all(steamUpdatePromises)).filter(Boolean);
          
          // Map SteamDB updates to games
          games = games.map((game: TrackedGame) => {
            if (game.steamAppId && (game.steamVerified || game.gogVerified)) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const steamData = steamUpdates.find((s: any) => 
                s?.appId === game.steamAppId?.toString()
              );
              
              if (steamData?.update) {
                const steamUpdate = steamData.update;
                
                // If Steam has no version but GOG does, use GOG version for comparison
                if (!steamUpdate.version && game.gogVersion) {
                  steamUpdate.version = game.gogVersion;
                }
                
                // Check if version is outdated
                const versionCheck = checkIfVersionOutdated(game, steamUpdate);
                
                return {
                  ...game,
                  steamdbUpdate: {
                    title: steamUpdate.description || steamUpdate.gameTitle,
                    version: steamUpdate.version,
                    buildNumber: steamUpdate.changeNumber,
                    date: steamUpdate.date,
                    link: steamUpdate.link,
                    isOutdated: versionCheck.isOutdated,
                    outdatedReason: versionCheck.reason,
                    suggestion: versionCheck.suggestion,
                  }
                };
              }
            }
            return game;
          });
        }
      }
      
      setTrackedGames(games);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setLoading(false);
    }
  }, [checkIfVersionOutdated]);

  useEffect(() => {
    if (status === 'authenticated') {
      loadTrackedGames();
    }
  }, [status, loadTrackedGames]);

  // Load layout and custom grid preferences from localStorage (client-only)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const savedLayout = localStorage.getItem('trackingLayoutMode');
      if (savedLayout && (savedLayout === 'grid' || savedLayout === 'list' || savedLayout === 'horizontal')) {
        setLayoutMode(savedLayout);
      }
      const savedCols = localStorage.getItem('trackingCustomCols');
      if (savedCols !== null) {
        setCustomCols(savedCols === 'auto' ? 'auto' : (Number(savedCols) || 'auto'));
      }
      const savedRows = localStorage.getItem('trackingCustomRows');
      if (savedRows !== null) {
        setCustomRows(savedRows === 'auto' ? 'auto' : (Number(savedRows) || 'auto'));
      }
    }
  }, []);

  // Save layout and custom grid preferences to localStorage (client-only)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('trackingLayoutMode', layoutMode);
    }
  }, [layoutMode]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (customCols === 'auto') {
        localStorage.setItem('trackingCustomCols', 'auto');
      } else {
        localStorage.setItem('trackingCustomCols', String(customCols));
      }
      
      if (customRows === 'auto') {
        localStorage.setItem('trackingCustomRows', 'auto');
      } else {
        localStorage.setItem('trackingCustomRows', String(customRows));
      }
    }
  }, [customCols, customRows]);

  const handleUntrack = async (gameId: string) => {
    try {
      const response = await fetch(`/api/tracking?gameId=${gameId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        const gameTitle = trackedGames.find(g => g.gameId === gameId)?.title || 'Game';
        setTrackedGames(prev => prev.filter(game => game.gameId !== gameId));
        showSuccess('Game Removed!', `${gameTitle} has been removed from tracking.`);
      } else {
        const error = await response.json();
        showError('Failed to Remove Game', error.error || 'An unexpected error occurred.');
      }
    } catch {
      showError('Network Error', 'Unable to connect to the server. Please try again.');
    }
  };

  const handleCheckForUpdates = async () => {
    try {
      setCheckingUpdates(true);
      const response = await fetch('/api/updates/check', {
        method: 'POST'
      });

      if (!response.ok) throw new Error('Failed to check for updates');
      
      const result = await response.json();
      showInfo('Update Check Complete!', `Checked ${result.checked} games and found ${result.updatesFound} updates.`);
      
      // Reload tracked games to show any updates
      loadTrackedGames();
    } catch (err) {
      showError('Update Check Failed', err instanceof Error ? err.message : 'Unable to check for updates.');
    } finally {
      setCheckingUpdates(false);
    }
  };

  // Check migration status
  const checkMigrationStatus = useCallback(async () => {
    setMigrationStatus(prev => ({ ...prev, checking: true }));
    try {
      const response = await fetch('/api/admin/migrate-titles');
      if (response.ok) {
        const data = await response.json();
        setMigrationStatus(prev => ({
          ...prev,
          checking: false,
          needsMigration: data.needsMigration,
          total: data.totalGames,
          lastCheck: Date.now()
        }));
      } else {
        // Silently fail - migration check is non-critical
        setMigrationStatus(prev => ({ ...prev, checking: false, lastCheck: Date.now() }));
      }
    } catch (error) {
      console.error('Migration check error:', error);
      setMigrationStatus(prev => ({ ...prev, checking: false, lastCheck: Date.now() }));
    }
  }, []);

  // Check migration status when games are loaded
  useEffect(() => {
    if (trackedGames.length > 0 && !migrationStatus.lastCheck) {
      checkMigrationStatus();
    }
  }, [trackedGames, migrationStatus.lastCheck, checkMigrationStatus]);

  // Perform title migration
  const performMigration = async () => {
    const confirmed = await confirm(
      'Migrate Game Titles',
      'This will update the titles of your tracked games to show cleaned versions by default, with original titles available in Advanced mode. Continue?',
      { confirmText: 'Migrate', cancelText: 'Cancel', type: 'warning' }
    );
    
    if (!confirmed) return;

    setMigrationStatus(prev => ({ ...prev, migrating: true }));
    try {
      const response = await fetch('/api/admin/migrate-titles', {
        method: 'POST'
      });
      
      if (response.ok) {
        const data = await response.json();
        showSuccess(`Successfully migrated ${data.migratedCount} games!`);
        // Refresh the games list
        loadTrackedGames();
        // Reset migration status
        setMigrationStatus(prev => ({
          ...prev,
          migrating: false,
          needsMigration: 0,
          lastCheck: Date.now()
        }));
      } else {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Migration failed');
      }
    } catch (error) {
      console.error('Migration error:', error);
      setMigrationStatus(prev => ({ ...prev, migrating: false }));
      showError(error instanceof Error ? error.message : 'Migration failed');
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString();
  };

  const getTimeSince = (dateString: string) => {
    const now = new Date();
    const then = new Date(dateString);
    const diffTime = Math.abs(now.getTime() - then.getTime());
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    return `${Math.floor(diffDays / 30)} months ago`;
  };

  // Show loading spinner while checking auth

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-hero flex items-center justify-center">
        <div className="text-center card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-xl p-8">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 mb-4"></div>
          <p className="text-slate-600 dark:text-slate-400 font-medium">Loading your games...</p>
        </div>
      </div>
    );
  }

  // If not authenticated, redirect to sign in
  if (status === 'unauthenticated') {
    if (typeof window !== 'undefined') {
      window.location.href = `/auth/signin?callbackUrl=/tracking`;
    }
    return null;
  }

    return (
    <>
      <div className="min-h-screen p-2 sm:p-4">
        <div className="max-w-7xl mx-auto">
          {/* Page Header with enhanced styling */}
          <div className="text-center sm:text-left mb-6 sm:mb-8">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold text-gradient mb-2">🎮 Your Tracked Games</h1>
            <p className="text-sm sm:text-base text-slate-600 dark:text-slate-400">Manage your game collection and check for updates</p>
            <div className="w-24 h-1 bg-gradient-to-r from-primary-500 to-accent-500 mx-auto sm:mx-0 mt-3 rounded-full"></div>
          </div>
          
          {/* Enhanced Action Buttons */}
          <div className="flex flex-wrap justify-center sm:justify-start items-center gap-3 mb-6">
            <AddCustomGame onGameAdded={loadTrackedGames} />
            <button
              onClick={handleCheckForUpdates}
              disabled={checkingUpdates || trackedGames.length === 0}
              className="px-6 py-3 btn-success disabled:opacity-50 disabled:cursor-not-allowed transition-all text-sm font-medium shadow-lg min-h-[48px]"
            >
              {checkingUpdates ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Checking...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  🔄 <span>Check Updates</span>
                </span>
              )}
            </button>
            <SequelNotifications />
          </div>

          {/* Search/Filter Bar */}
          {trackedGames.length > 0 && (
            <div className="mb-6">
              <div className="flex flex-col gap-4">
                {/* Search Bar */}
                <div className="flex flex-col gap-4">
                  {/* Mobile search - shown above stats, centered */}
                  <div className="relative max-w-md w-full sm:hidden mx-auto">
                    <input
                      type="text"
                      placeholder="Search tracked games..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full px-4 py-3 pl-10 card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                    />
                    <div className="absolute inset-y-0 left-0 flex items-center pl-3">
                      <span className="text-gray-500 dark:text-gray-400">🔍</span>
                    </div>
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Desktop: Stats and Controls Row */}
                  <div className="hidden sm:flex items-center justify-between gap-3">
                    {/* Left: Stats and Controls */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                      {/* Tracking Stats */}
                      <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 px-6 py-3 rounded-xl shadow-lg">
                        <span className="text-sm font-medium text-slate-500 dark:text-slate-400">📊 Tracking: </span>
                        <span className="text-lg font-bold text-gradient">{trackedGames.length} games</span>
                      </div>

                      {/* Layout Controls */}
                      <div className="flex items-center gap-2 card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 px-3 py-2 rounded-xl shadow-lg">
                        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Layout:</span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setLayoutMode('grid')}
                            className={`p-2 rounded-lg transition-all duration-200 text-lg ${
                              layoutMode === 'grid'
                                ? 'bg-primary-500 text-white shadow-md transform scale-105'
                                : 'hover:bg-white/50 dark:hover:bg-gray-700/50 text-slate-600 dark:text-slate-400'
                            }`}
                            title="Grid View"
                          >
                            🔲
                          </button>
                          <button
                            onClick={() => setLayoutMode('list')}
                            className={`p-2 rounded-lg transition-all duration-200 text-lg ${
                              layoutMode === 'list'
                                ? 'bg-primary-500 text-white shadow-md transform scale-105'
                                : 'hover:bg-white/50 dark:hover:bg-gray-700/50 text-slate-600 dark:text-slate-400'
                            }`}
                            title="List View"
                          >
                            📋
                          </button>
                          <button
                            onClick={() => setLayoutMode('horizontal')}
                            className={`p-2 rounded-lg transition-all duration-200 text-lg ${
                              layoutMode === 'horizontal'
                                ? 'bg-primary-500 text-white shadow-md transform scale-105'
                                : 'hover:bg-white/50 dark:hover:bg-gray-700/50 text-slate-600 dark:text-slate-400'
                            }`}
                            title="Horizontal Scroll"
                          >
                            ⬅️➡️
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Right: Advanced Toggle */}
                    <button
                      onClick={() => setShowAdvanced(!showAdvanced)}
                      className={`
                        px-4 py-3 rounded-xl font-medium text-sm transition-all duration-200 shadow-lg flex-shrink-0
                        ${showAdvanced 
                          ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white transform scale-105' 
                          : 'card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 text-slate-600 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                        }
                      `}
                      title={showAdvanced ? 'Hide original post titles' : 'Show original post titles'}
                    >
                      <span className="flex items-center gap-2">
                        <span>🔧</span>
                        <span>{showAdvanced ? 'Hide Advanced' : 'Advanced'}</span>
                      </span>
                    </button>
                  </div>

                  {/* Mobile: Tracking Stats Centered */}
                  <div className="sm:hidden flex flex-col gap-3 items-center">
                    {/* Tracking Stats */}
                    <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 px-6 py-3 rounded-xl shadow-lg">
                      <span className="text-sm font-medium text-slate-500 dark:text-slate-400">📊 Tracking: </span>
                      <span className="text-lg font-bold text-gradient">{trackedGames.length} games</span>
                    </div>
                  </div>
                  
                  {/* Title Migration Button */}
                  {migrationStatus.needsMigration > 0 && (
                    <button
                      onClick={performMigration}
                      disabled={migrationStatus.migrating}
                      className="px-4 py-3 rounded-xl font-medium text-sm transition-all duration-200 shadow-lg bg-gradient-to-r from-blue-500 to-purple-500 text-white hover:from-blue-600 hover:to-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
                      title={`Fix ${migrationStatus.needsMigration} games with uncleaned titles`}
                    >
                      <span className="flex items-center gap-2">
                        <span>🔄</span>
                        <span className="hidden sm:inline">
                          {migrationStatus.migrating ? 'Fixing...' : `Fix Titles (${migrationStatus.needsMigration})`}
                        </span>
                        <span className="sm:hidden">
                          {migrationStatus.migrating ? '...' : migrationStatus.needsMigration}
                        </span>
                      </span>
                    </button>
                  )}
                </div>

                {/* Sort Controls */}
                <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 px-4 py-3 rounded-xl shadow-lg">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <span className="text-sm font-medium text-slate-500 dark:text-slate-400">Sort by:</span>
                    <div className="flex flex-wrap items-center gap-2 flex-1">
                      {[
                        { key: 'title', label: 'Title', icon: '📝' },
                        { key: 'dateAdded', label: 'Added', icon: '📅' },
                        { key: 'lastChecked', label: 'Checked', icon: '🔍' },
                        { key: 'lastUpdated', label: 'Updated', icon: '⚡' }
                      ].map((option) => (
                        <button
                          key={option.key}
                          onClick={() => handleSortChange(option.key as typeof sortBy)}
                          className={`
                            px-3 py-1.5 text-xs rounded-lg transition-all duration-200 flex items-center gap-1.5 font-medium
                            ${sortBy === option.key
                              ? 'bg-primary-500 text-white shadow-md transform scale-105'
                              : 'bg-white/50 dark:bg-gray-700/50 text-gray-700 dark:text-gray-300 hover:bg-white/70 dark:hover:bg-gray-700/70 hover:scale-105'
                            }
                          `}
                          title={`Sort by ${option.label} ${sortBy === option.key ? (sortOrder === 'asc' ? '(A-Z)' : '(Z-A)') : ''}`}
                        >
                          <span>{option.icon}</span>
                          <span>{option.label}</span>
                          {sortBy === option.key && (
                            <span className="text-xs font-bold">
                              {sortOrder === 'asc' ? '↑' : '↓'}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                    {/* Desktop: Search input inside same flex container - right side */}
                    <div className="hidden sm:flex items-center max-w-xs">
                      <input
                        type="text"
                        placeholder="Search tracked games..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full px-4 py-2 card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-xl text-gray-900 dark:text-white placeholder-gray-500 dark:placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all"
                      />
                    </div>
                  </div>
                  {/* Mobile: Layout settings dropdown */}
                  <div className="sm:hidden ml-auto relative">
                    <button
                      className="px-3 py-2 rounded-lg bg-gradient-to-r from-blue-500 to-cyan-500 text-white text-xs font-medium shadow"
                      onClick={() => setShowLayoutDropdown(v => !v)}
                    >
                      ⚙️ Layout
                    </button>
                  </div>
                </div>
              </div>

              {/* Mobile Layout Dropdown - Rendered outside container with backdrop */}
              {showLayoutDropdown && (
                <>
                  {/* Backdrop */}
                  <div 
                    className="sm:hidden fixed inset-0 bg-black/50 z-[9998] backdrop-blur-sm"
                    onClick={() => setShowLayoutDropdown(false)}
                  />
                  {/* Dropdown */}
                  <div className="sm:hidden fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[9999] bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-2xl p-4 w-[90vw] max-w-sm max-h-[80vh] overflow-y-auto">
                    <div className="flex flex-col gap-3">
                      {/* Close button */}
                      <div className="flex items-center justify-between mb-2">
                        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">Layout Settings</h3>
                        <button
                          onClick={() => setShowLayoutDropdown(false)}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
                        >
                          <span className="text-lg">✕</span>
                        </button>
                      </div>
                      {/* Layout Mode Buttons */}
                      <div>
                        <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2 block">Layout Mode:</label>
                        <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setLayoutMode('grid');
                                  setShowLayoutDropdown(false);
                                }}
                                className={`flex-1 p-2 rounded-lg text-lg ${
                                  layoutMode === 'grid'
                                    ? 'bg-primary-500 text-white shadow-md'
                                    : 'bg-gray-100 dark:bg-gray-800 text-slate-600 dark:text-slate-400'
                                }`}
                                title="Grid View"
                              >
                                🔲
                              </button>
                              <button
                                onClick={() => {
                                  setLayoutMode('list');
                                  setShowLayoutDropdown(false);
                                }}
                                className={`flex-1 p-2 rounded-lg text-lg ${
                                  layoutMode === 'list'
                                    ? 'bg-primary-500 text-white shadow-md'
                                    : 'bg-gray-100 dark:bg-gray-800 text-slate-600 dark:text-slate-400'
                                }`}
                                title="List View"
                              >
                                📋
                              </button>
                              <button
                                onClick={() => {
                                  setLayoutMode('horizontal');
                                  setShowLayoutDropdown(false);
                                }}
                                className={`flex-1 p-2 rounded-lg text-lg ${
                                  layoutMode === 'horizontal'
                                    ? 'bg-primary-500 text-white shadow-md'
                                    : 'bg-gray-100 dark:bg-gray-800 text-slate-600 dark:text-slate-400'
                                }`}
                                title="Horizontal Scroll"
                              >
                                ⬅️➡️
                              </button>
                            </div>
                          </div>
                          {/* Grid Customization - Always show for mobile when grid mode is active */}
                          {layoutMode === 'grid' && (
                            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
                              <label className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2 block">🎛️ Grid Size:</label>
                              <div className="flex flex-col gap-2">
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-slate-500 dark:text-slate-400 w-16">Columns:</label>
                                  <input
                                    type="number"
                                    min={1}
                                    max={12}
                                    value={customCols === 'auto' ? '' : customCols}
                                    onChange={e => setCustomCols(e.target.value === '' ? 'auto' : Math.max(1, Math.min(12, Number(e.target.value))))}
                                    className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                    placeholder="auto"
                                  />
                                  <button
                                    type="button"
                                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${customCols === 'auto' ? 'bg-primary-500 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700'}`}
                                    onClick={() => setCustomCols('auto')}
                                  >Auto</button>
                                </div>
                                <div className="flex items-center gap-2">
                                  <label className="text-xs text-slate-500 dark:text-slate-400 w-16">Rows:</label>
                                  <input
                                    type="number"
                                    min={1}
                                    max={12}
                                    value={customRows === 'auto' ? '' : customRows}
                                    onChange={e => setCustomRows(e.target.value === '' ? 'auto' : Math.max(1, Math.min(12, Number(e.target.value))))}
                                    className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                                    placeholder="auto"
                                  />
                                  <button
                                    type="button"
                                    className={`px-3 py-2 rounded-lg text-xs font-medium transition-all ${customRows === 'auto' ? 'bg-primary-500 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700'}`}
                                    onClick={() => setCustomRows('auto')}
                                  >Auto</button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                  </>
                )}

              {/* Grid customization - Desktop only, show below when in advanced mode */}
              {showAdvanced && layoutMode === 'grid' && (
                <div className="hidden sm:flex items-center justify-center gap-4 card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 px-6 py-4 rounded-xl shadow-lg">
                  <span className="text-sm font-medium text-slate-500 dark:text-slate-400">🎛️ Grid Size:</span>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-500 dark:text-slate-400">Columns:</label>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={customCols === 'auto' ? '' : customCols}
                      onChange={e => setCustomCols(e.target.value === '' ? 'auto' : Math.max(1, Math.min(12, Number(e.target.value))))}
                      className="w-20 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="auto"
                    />
                    <button
                      type="button"
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${customCols === 'auto' ? 'bg-primary-500 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700'}`}
                      onClick={() => setCustomCols('auto')}
                    >Auto</button>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-sm text-slate-500 dark:text-slate-400">Rows:</label>
                    <input
                      type="number"
                      min={1}
                      max={12}
                      value={customRows === 'auto' ? '' : customRows}
                      onChange={e => setCustomRows(e.target.value === '' ? 'auto' : Math.max(1, Math.min(12, Number(e.target.value))))}
                      className="w-20 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-sm bg-white dark:bg-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="auto"
                    />
                    <button
                      type="button"
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${customRows === 'auto' ? 'bg-primary-500 text-white shadow-md' : 'bg-gray-200 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-700'}`}
                      onClick={() => setCustomRows('auto')}
                    >Auto</button>
                  </div>
                </div>
              )}

              {searchQuery && (
                <p className="text-sm text-gray-600 dark:text-gray-400 mt-4 text-center sm:text-left">
                  Found {filteredGames.length} game{filteredGames.length !== 1 ? 's' : ''} matching &quot;{searchQuery}&quot;
                </p>
              )}
            </div>
          )}

        {/* Enhanced Error Display */}
        {error && (
          <div className="mb-6 p-4 bg-gradient-to-r from-red-500/10 to-pink-500/10 border border-red-300/30 dark:border-red-600/30 text-red-700 dark:text-red-300 rounded-xl backdrop-blur-sm animate-slide-up">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              {error}
            </div>
          </div>
        )}

        {/* Enhanced Loading State */}
        {loading && (
          <div className="text-center py-12">
            <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-xl p-8 max-w-sm mx-auto">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 mb-4"></div>
              <p className="text-slate-600 dark:text-slate-400 font-medium">Loading tracked games...</p>
            </div>
          </div>
        )}

        {/* Enhanced Empty State */}
        {!loading && trackedGames.length === 0 ? (
          <div className="text-center py-16">
            <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-xl p-8 max-w-md mx-auto">
              <div className="text-6xl mb-4">🎮</div>
              <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">No games tracked yet</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">Start tracking your favorite games to get updates</p>
              <Link 
                href="/"
                className="btn-primary inline-flex items-center gap-2 px-6 py-3"
              >
                <span>🔍</span>
                <span>Browse Games to Track</span>
              </Link>
            </div>
          </div>
        ) : !loading && searchQuery && filteredGames.length === 0 ? (
          <div className="text-center py-16">
            <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-xl p-8 max-w-md mx-auto">
              <div className="text-6xl mb-4">🔍</div>
              <h3 className="text-lg font-medium text-slate-700 dark:text-slate-300 mb-2">No games found</h3>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">No tracked games match &quot;{searchQuery}&quot;</p>
              <button
                onClick={() => setSearchQuery('')}
                className="btn-primary inline-flex items-center gap-2 px-6 py-3"
              >
                <span>✕</span>
                <span>Clear Search</span>
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Horizontal scroll hint */}
            {layoutMode === 'horizontal' && filteredGames.length > 0 && (
              <div className="mb-4 text-center">
                <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg text-sm text-blue-700 dark:text-blue-300">
                  <span>⬅️</span>
                  <span>Scroll horizontally to browse games</span>
                  <span>➡️</span>
                </div>
              </div>
            )}
            <div 
              className={`
                ${layoutMode === 'grid' 
                  ? 'grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-4 sm:gap-6'
                  : layoutMode === 'list'
                  ? 'flex flex-col gap-4 max-w-4xl mx-auto w-full'
                  : 'flex flex-row gap-6 overflow-x-auto pb-4 snap-x snap-mandatory'
                }
              `}
              style={layoutMode === 'grid' ? customGridStyle : undefined}
            >
            {filteredGames.map((game) => (
              layoutMode === 'grid' || layoutMode === 'horizontal' ? (
                <TrackedGamePosterCard
                  key={game._id}
                  gameId={game._id}
                  appid={game.steamAppId}
                  gogProductId={game.gogProductId}
                  title={game.originalTitle || game.title}
                  originalTitle={game.originalTitle}
                  description={game.description}
                  image={game.image || ''}
                  source={game.source}
                  hasUpdate={game.hasNewUpdate}
                  gameLink={game.gameLink}
                  lastKnownVersion={game.lastKnownVersion}
                  currentBuildNumber={game.currentBuildNumber}
                  currentVersionNumber={game.currentVersionNumber}
                  steamVerified={game.steamVerified}
                  steamName={game.steamName}
                  gogVerified={game.gogVerified}
                  buildNumberVerified={game.buildNumberVerified}
                  notificationsEnabled={game.notificationsEnabled}
                  gogName={game.gogName}
                  gogVersion={game.gogVersion}
                  gogBuildId={game.gogBuildId}
                  gogLastChecked={game.gogLastChecked}
                  gogLatestVersion={gogLatest[game._id]?.version}
                  gogLatestBuildId={gogLatest[game._id]?.buildId}
                  gogLatestDate={gogLatest[game._id]?.date}
                  steamdbUpdate={game.steamdbUpdate}
                  updateHistory={game.updateHistory}
                  pendingUpdates={game.pendingUpdates}
                  onUntrack={async () => {
                    const confirmed = await confirm(
                      'Remove Game from Tracking',
                      `Are you sure you want to stop tracking "${game.title}"? This action cannot be undone.`,
                      { confirmText: 'Remove', cancelText: 'Close', type: 'danger' }
                    );
                    if (!confirmed) return;
                    handleUntrack(game.gameId);
                  }}
                  onCheckUpdate={() => handleSingleGameUpdate(game._id, game.title)}
                  onRefresh={loadTrackedGames}
                  isCheckingUpdate={checkingSingleGame === game._id}
                  className={layoutMode === 'horizontal' ? 'min-w-[200px] snap-start' : ''}
                />
              ) : (
              <div 
                key={game._id} 
                className={`
                  relative game-card animate-fade-in flex flex-col rounded-lg shadow-md border border-gray-200 dark:border-gray-700 overflow-hidden pb-16 bg-white dark:bg-gray-800
                `}
              >
                {/* Blended background image */}
                {game.image && (
                  <div
                    className="absolute inset-0 z-0"
                    aria-hidden="true"
                    style={{
                      backgroundImage: `url('${game.image}')`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      filter: 'blur(24px) brightness(0.7) saturate(1.2)',
                      opacity: 0.25,
                      transition: 'opacity 0.3s',
                    }}
                  />
                )}
                {/* Top-left Untrack Icon */}
                <button
                  onClick={async () => {
                    const confirmed = await confirm(
                      'Remove Game from Tracking',
                      `Are you sure you want to stop tracking "${game.title}"? This action cannot be undone.`,
                      { confirmText: 'Remove', cancelText: 'Close', type: 'danger' }
                    );
                    if (!confirmed) return;
                    handleUntrack(game.gameId);
                  }}
                  title="Untrack game"
                  className="absolute top-2 left-2 h-10 w-10 flex items-center justify-center rounded-lg bg-white/90 dark:bg-gray-900/80 border border-red-300 dark:border-red-600 text-sm hover:bg-red-100 dark:hover:bg-red-800/40 text-red-600 dark:text-red-300 transition z-20 shadow"
                >
                  <span role="img" aria-label="trash">🗑️</span>
                </button>
                <div className="flex flex-col gap-4 p-4 sm:p-6 flex-1 relative z-10">
                  {/* Game Image */}
                  {game.image && (
                    <div className="relative z-10 mx-auto mt-2 mb-2 sm:mt-4 sm:mb-3 flex justify-center items-center">
                      <ImageWithFallback
                        src={game.image}
                        alt={game.title}
                        width={240}
                        height={360}
                        className="w-auto h-auto max-w-[240px] rounded-lg shadow-lg border border-gray-200 dark:border-gray-600"
                      />
                    </div>
                  )}

                  {/* Action Icons (under image) */}
                  <div className="relative z-10 flex justify-center gap-2 mb-2 sm:mb-3">
                    <button
                      onClick={() => handleSingleGameUpdate(game._id, game.title)}
                      disabled={checkingSingleGame === game._id}
                      title="Check updates now"
                      className="h-10 w-10 sm:h-9 sm:w-9 flex items-center justify-center rounded-lg bg-white/90 dark:bg-gray-900/80 border border-gray-300 dark:border-gray-600 text-sm hover:bg-blue-100 dark:hover:bg-blue-800/40 transition disabled:opacity-50 disabled:cursor-not-allowed shadow"
                    >
                      {checkingSingleGame === game._id ? (
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-blue-400 border-t-transparent" />
                      ) : (
                        <span role="img" aria-label="refresh">🔄</span>
                      )}
                    </button>
                    <a
                      href={game.gameLink}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="Open latest post"
                      className="h-10 w-10 sm:h-9 sm:w-9 flex items-center justify-center rounded-lg bg-white/90 dark:bg-gray-900/80 border border-gray-300 dark:border-gray-600 text-sm hover:bg-green-100 dark:hover:bg-green-800/40 transition shadow"
                    >
                      <ExternalLinkIcon className="w-5 h-5" />
                    </a>
                  </div>
                  
                  {/* Game Details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <div className="flex flex-col gap-1 flex-1 min-w-0">
                                <h3 className="font-bold text-base sm:text-lg text-gray-900 dark:text-white leading-tight text-center bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm px-3 py-2 rounded-lg border border-gray-200/50 dark:border-gray-700/50 shadow-sm flex-1 min-w-0 uppercase">
                                  {getDisplayTitle(game)}
                                </h3>
                                {showAdvanced && (game.steamVerified || (game.gogVerified && game.gogProductId !== -1)) && game.originalTitle && game.originalTitle !== getDisplayTitle(game) && (
                                  <div className="text-xs text-gray-500 dark:text-gray-400 text-center italic px-2">
                                    Original: {game.originalTitle}
                                  </div>
                                )}
                              </div>
                              <SearchGameButton 
                                gameTitle={game.title} 
                                size="sm"
                                className="flex-shrink-0"
                              />
                            </div>
                            {game.hasNewUpdate && !game.newUpdateSeen && (
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-1 bg-gradient-to-r from-red-500 to-pink-500 text-white text-xs font-bold rounded-full animate-pulse shadow-lg">
                                  ✨ NEW
                                </span>
                                <button
                                  onClick={() => handleMarkUpdateSeen(game._id)}
                                  className="text-xs text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 underline transition-colors"
                                  title="Mark as seen"
                                >
                                  dismiss
                                </button>
                              </div>
                            )}
                          </div>

                          {/* SteamDB Update Alert - shown inline in SteamVerification when not steam-verified */}
                          {game.steamdbUpdate && !game.steamVerified && (
                            <div className={`mt-2 p-3 border rounded-lg ${
                              game.steamdbUpdate.isOutdated 
                                ? 'bg-gradient-to-r from-orange-500/10 to-red-500/10 border-orange-300/30 dark:border-red-400/30'
                                : 'bg-gradient-to-r from-blue-500/10 to-purple-500/10 border-blue-300/30 dark:border-purple-400/30'
                            }`}>
                              <div className="flex items-center gap-2 mb-1">
                                <span className={`text-sm font-semibold ${
                                  game.steamdbUpdate.isOutdated
                                    ? 'text-orange-600 dark:text-orange-400'
                                    : 'text-blue-600 dark:text-blue-400'
                                }`}>
                                  {game.steamdbUpdate.isOutdated ? '⚠️ Version Behind Steam' : '🎮 Steam Update Detected'}
                                </span>
                                <a
                                  href={game.steamdbUpdate.link}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={`text-xs transition-colors ${
                                    game.steamdbUpdate.isOutdated
                                      ? 'text-orange-500 hover:text-orange-700 dark:hover:text-orange-300'
                                      : 'text-blue-500 hover:text-blue-700 dark:hover:text-blue-300'
                                  }`}
                                  title="View on SteamDB"
                                >
                                  <ExternalLinkIcon className="w-3 h-3" />
                                </a>
                              </div>
                              
                              {game.steamdbUpdate.isOutdated && game.steamdbUpdate.outdatedReason && (
                                <div className="text-xs text-orange-700 dark:text-orange-300 mb-2">
                                  {game.steamdbUpdate.outdatedReason}
                                </div>
                              )}
                              
                              {game.steamdbUpdate.suggestion && (
                                <div className="text-xs text-green-700 dark:text-green-300 mb-2 font-medium">
                                  💡 {game.steamdbUpdate.suggestion}
                                </div>
                              )}
                              
                              <div className="text-xs text-gray-700 dark:text-gray-300">
                                {!game.steamdbUpdate.isOutdated && game.steamdbUpdate.title}
                                {(game.steamdbUpdate.version || game.steamdbUpdate.buildNumber) && (
                                  <div className="flex gap-1 mt-1">
                                    {game.steamdbUpdate.version && (
                                      <span className={`px-1.5 py-0.5 text-xs rounded ${
                                        game.steamdbUpdate.isOutdated
                                          ? 'bg-orange-100 dark:bg-orange-900 text-orange-800 dark:text-orange-200'
                                          : 'bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200'
                                      }`}>
                                        v{game.steamdbUpdate.version}
                                      </span>
                                    )}
                                    {game.steamdbUpdate.buildNumber && (
                                      <span className={`px-1.5 py-0.5 text-xs rounded ${
                                        game.steamdbUpdate.isOutdated
                                          ? 'bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200'
                                          : 'bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200'
                                      }`}>
                                        Build {game.steamdbUpdate.buildNumber}
                                      </span>
                                    )}
                                  </div>
                                )}
                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                  {new Date(game.steamdbUpdate.date).toLocaleDateString()}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                        
                        {/* Smart Priority: Show Steam first if GOG has no version data */}
                        {/* Steam Verification - Show first if GOG is not verified or marked as "Not on GOG" */}
                        {(showAdvanced || !game.gogVerified || game.gogProductId === -1) && !gogLatest[game._id]?.version && (
                          <div className="mt-2">
                            <SteamVerification
                              gameId={game._id}
                              gameTitle={game.title}
                              steamName={game.steamName}
                              steamVerified={game.steamVerified}
                              steamLatestVersion={steamLatest[game._id]?.version}
                              steamLatestBuild={steamLatest[game._id]?.build}
                              steamLatestLink={steamLatest[game._id]?.link}
                              steamdbUpdate={game.steamdbUpdate}
                              onVerificationUpdate={handleVerificationUpdate}
                            />
                          </div>
                        )}

                        {/* GOG Verification - Show if NOT marked as "Not on GOG" OR in advanced mode */}
                        {(showAdvanced || game.gogProductId !== -1) && (
                          <div className="mt-2">
                            <GOGVerification
                              gameId={game._id}
                              gameTitle={game.title}
                              currentGogId={game.gogProductId}
                              currentGogName={game.gogName}
                              isVerified={game.gogVerified}
                              gogLatestVersion={gogLatest[game._id]?.version}
                              gogLatestBuildId={gogLatest[game._id]?.buildId}
                              gogLatestDate={gogLatest[game._id]?.date}
                              trackedVersion={game.currentVersionNumber}
                              trackedBuildId={game.currentBuildNumber}
                              onVerificationComplete={() => {
                                // Refresh the game data after verification
                                loadTrackedGames();
                              }}
                            />
                          </div>
                        )}

                        {/* Steam Verification - Show in Advanced Mode OR when no GOG, after GOG if GOG has version */}
                        {(showAdvanced || !game.gogVerified || game.gogProductId === -1) && gogLatest[game._id]?.version && (
                          <div className="mt-2">
                            <SteamVerification
                              gameId={game._id}
                              gameTitle={game.title}
                              steamName={game.steamName}
                              steamVerified={game.steamVerified}
                              steamLatestVersion={steamLatest[game._id]?.version}
                              steamLatestBuild={steamLatest[game._id]?.build}
                              steamLatestLink={steamLatest[game._id]?.link}
                              steamdbUpdate={game.steamdbUpdate}
                              onVerificationUpdate={handleVerificationUpdate}
                            />
                          </div>
                        )}
                        
                        {/* Smart Version & Build Number Verification */}
                        <div className="mt-2">
                          <SmartVersionVerification
                            gameId={game.gameId}
                            gameTitle={game.title}
                            originalTitle={game.originalTitle || game.title}
                            steamAppId={game.steamAppId}
                            currentBuildNumber={game.currentBuildNumber}
                            buildNumberVerified={game.buildNumberVerified || false}
                            currentVersionNumber={game.currentVersionNumber}
                            versionNumberVerified={game.versionNumberVerified || false}
                            onVerified={loadTrackedGames}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Tracking Info */}
                    <div className="mt-3 sm:mt-4 grid grid-cols-1 gap-2 text-xs sm:text-sm">
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">Added:</span>
                        <span className="ml-1 sm:ml-2 text-gray-900 dark:text-white">
                          {formatDate(game.dateAdded)}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">Last Checked:</span>
                        <span className="ml-1 sm:ml-2 text-gray-900 dark:text-white">
                          {getTimeSince(game.lastChecked)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <NotificationToggle
                          gameId={game._id}
                          currentEnabled={game.notificationsEnabled}
                          onToggleChanged={loadTrackedGames}
                        />
                      </div>
                    </div>

                    {/* Latest Update Status */}
                    {game.latestApprovedUpdate && (
                      <div className="mt-3 sm:mt-4">
                        <h4 className="text-xs sm:text-sm font-medium text-green-700 dark:text-green-300 mb-2 flex items-center gap-2">
                          <span>✅</span>
                          Current Version
                          {game.latestApprovedUpdate.isOnlineFix && (
                            <Image 
                              src="https://online-fix.me/favicon-32x32.png" 
                              alt="Online-Fix" 
                              width={16}
                              height={16}
                              className="inline-block"
                              title="Online-Fix Release"
                            />
                          )}
                        </h4>
                        <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded">
                          <div className="flex flex-col gap-2">
                            <div className="flex-1">
                              <span className="font-medium text-sm">{game.latestApprovedUpdate.version.startsWith('v') ? game.latestApprovedUpdate.version : `v${game.latestApprovedUpdate.version}`}</span>
                              <span className="text-gray-500 dark:text-gray-400 text-xs ml-2">
                                approved {formatDate(game.latestApprovedUpdate.dateFound)}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Previous Updates */}
                    {game.updateHistory && game.updateHistory.length > 1 && (
                      (() => {
                        // Exclude the latest/current version from previous updates
                        const latestVersion = game.latestApprovedUpdate?.version || (game.updateHistory[0]?.version);
                        const previousUpdates = game.updateHistory.filter(update => update.version !== latestVersion);
                        if (previousUpdates.length === 0) return null;
                        return (
                          <div className="mt-3 sm:mt-4">
                            <h4 className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Previous Updates ({previousUpdates.length})
                            </h4>
                            <div className="space-y-1 sm:space-y-2">
                              {previousUpdates.slice(0, 2).map((update, updateIndex) => (
                                <div key={updateIndex} className="text-xs sm:text-sm bg-gray-50 dark:bg-gray-900/20 p-2 rounded">
                                  <div className="flex flex-col gap-1">
                                    <div className="flex-1">
                                      <span className="font-medium">
                                        {update.version}
                                      </span>
                                      <span className="text-gray-500 dark:text-gray-400 ml-2">
                                        found {formatDate(update.dateFound)}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()
                    )}

                    {/* Pending Updates */}
                    {game.pendingUpdates && game.pendingUpdates.length > 0 && (
                      <div className="mt-3 sm:mt-4">
                        <h4 className="text-xs sm:text-sm font-medium text-yellow-700 dark:text-yellow-300 mb-2 flex items-center gap-1 sm:gap-2">
                          <span>⏳</span>
                          Pending Updates ({game.pendingUpdates.length})
                        </h4>
                        <div className="space-y-1 sm:space-y-2">
                          {game.pendingUpdates.slice(0, 3).map((update) => (
                            <div key={update._id} className="text-xs sm:text-sm bg-yellow-50 dark:bg-yellow-900/20 p-2 rounded">
                              <div className="flex flex-col gap-1">
                                <div className="flex-1">
                                  <span className="font-medium">{update.newTitle}</span>
                                  {update.detectedVersion && (
                                    <span className="text-yellow-600 dark:text-yellow-400 ml-2">
                                      {update.detectedVersion}
                                    </span>
                                  )}
                                  {update.aiDetectionConfidence && (
                                    <span className="inline-flex items-center gap-1 ml-2 px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded text-xs">
                                      🤖 {Math.round(update.aiDetectionConfidence * 100)}%
                                    </span>
                                  )}
                                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                                    {update.reason} • Found {formatDate(update.dateFound)}
                                    {update.aiDetectionReason && (
                                      <div className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">
                                        🤖 AI: {update.aiDetectionReason}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Download Links sticky at bottom */}
                <div className="absolute left-0 right-0 bottom-0 z-10 p-4 pt-0 bg-gradient-to-t from-white/90 dark:from-gray-900/90 to-transparent">
                  <GameDownloadLinks gameId={game._id} className="w-full" />
                </div>
              </div>
            )
          ))}
          </div>
          </>
        )}
        </div>
      </div>
    </>
  );
}