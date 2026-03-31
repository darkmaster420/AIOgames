"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { GameDownloadLinks } from '../../../components/GameDownloadLinks';
import { SteamVerification } from '../../../components/SteamVerification';
import GOGVerification from '../../../components/GOGVerification';
import { SmartVersionVerification } from '../../../components/SmartVersionVerification';
import { NotificationToggle } from '../../../components/NotificationToggle';
import { cleanGameTitle } from '../../../utils/steamApi';
import { ExternalLinkIcon } from '../../../components/ExternalLinkIcon';

interface GameDetailsResponse {
  appid: number;
  name: string;
  type?: string;
  description?: string;
  short_description?: string;
  header_image?: string;
  background?: string;
  developers?: string[];
  publishers?: string[];
  release_date?: {
    date?: string;
    coming_soon?: boolean;
  };
  platforms?: {
    windows?: boolean;
    mac?: boolean;
    linux?: boolean;
  };
  metacritic?: {
    score?: number;
    url?: string;
  };
  genres?: Array<{ id: string; description: string }>;
  categories?: Array<{ id: number; description: string }>;
  owners?: string;
  userscore?: number;
  positive?: number;
  negative?: number;
  price_overview?: {
    final_formatted?: string;
    initial_formatted?: string;
    discount_percent?: number;
  };
  isTracked?: boolean;
  trackedGameId?: string;
  gameId?: string;
  title?: string;
  originalTitle?: string;
  source?: string;
  image?: string;
  gameLink?: string;
  steamVerified?: boolean;
  steamAppId?: number;
  steamName?: string;
  gogVerified?: boolean;
  gogProductId?: number;
  gogName?: string;
  gogVersion?: string;
  gogBuildId?: string;
  gogLastChecked?: string;
  buildNumberVerified?: boolean;
  currentBuildNumber?: string;
  versionNumberVerified?: boolean;
  currentVersionNumber?: string;
  lastKnownVersion?: string;
  notificationsEnabled?: boolean;
  dateAdded?: string;
  lastChecked?: string;
  hasNewUpdate?: boolean;
  updateHistory?: Array<{
    version?: string;
    dateFound?: string;
    gameLink?: string;
    isLatest?: boolean;
  }>;
  pendingUpdates?: Array<{
    _id: string;
    newTitle?: string;
    detectedVersion?: string;
    dateFound?: string;
    reason?: string;
  }>;
  dataSource?: string;
  error?: string;
}

interface GameApiSearchResult {
  id: string;
  originalId?: number | string;
  title: string;
  originalTitle?: string;
  excerpt?: string;
  description?: string;
  link?: string;
  date?: string;
  source?: string;
  siteType?: string;
  image?: string;
}

function stripHtmlTags(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export default function AppIdDetailPage() {
  const { status } = useSession();
  const params = useParams<{ appid: string }>();
  const rawAppId = params?.appid;
  const appid = Array.isArray(rawAppId) ? rawAppId[0] : rawAppId;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [game, setGame] = useState<GameDetailsResponse | null>(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState('');
  const [resultsQuery, setResultsQuery] = useState('');
  const [gameResults, setGameResults] = useState<GameApiSearchResult[]>([]);
  const [trackingLoading, setTrackingLoading] = useState(false);
  const [trackingError, setTrackingError] = useState('');
  const [untrackingLoading, setUntrackingLoading] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [markingLatest, setMarkingLatest] = useState<string | null>(null);
  const [markLatestError, setMarkLatestError] = useState('');
  const [markLatestSuccess, setMarkLatestSuccess] = useState('');
  const [steamLatest, setSteamLatest] = useState<{ version?: string; build?: string; link?: string }>({});
  const [gogLatest, setGogLatest] = useState<{ version?: string; buildId?: string; date?: string }>({});

  useEffect(() => {
    let isMounted = true;

    const loadGame = async () => {
      if (!appid) {
        setError('Missing app ID.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const response = await fetch(`/api/games/${appid}`);
        const data: GameDetailsResponse = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Failed to load game details.');
        }

        if (!isMounted) return;
        setGame(data);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load game details.');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadGame();

    return () => {
      isMounted = false;
    };
  }, [appid]);

  const summary = useMemo(() => {
    if (!game?.short_description && !game?.description) return '';
    return stripHtmlTags(game.short_description || game.description || '');
  }, [game]);

  const developerText = game?.developers?.length ? game.developers.join(', ') : 'Unknown';
  const publisherText = game?.publishers?.length ? game.publishers.join(', ') : 'Unknown';
  const genreText = game?.genres?.length ? game.genres.map(g => g.description).join(', ') : 'Unknown';

  const loadGameByAppId = async () => {
    if (!appid) return;

    const response = await fetch(`/api/games/${appid}`);
    const data: GameDetailsResponse = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Failed to load game details.');
    }
    setGame(data);
  };

  const handleVerificationUpdate = (_trackedId: string, verified: boolean, steamAppId?: number, steamName?: string) => {
    setGame(prev => prev ? {
      ...prev,
      steamVerified: verified,
      steamAppId: steamAppId || prev.steamAppId,
      steamName: steamName || prev.steamName,
    } : prev);
  };

  const handleUntrackGame = async () => {
    if (!game?.isTracked) return;

    const confirmed = window.confirm(`Stop tracking "${game.name}"?`);
    if (!confirmed) return;

    setUntrackingLoading(true);
    setTrackingError('');

    try {
      const trackedGameId = game.gameId || String(game.appid);
      const response = await fetch(`/api/tracking?gameId=${encodeURIComponent(trackedGameId)}`, {
        method: 'DELETE',
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to untrack game.');
      }

      setGame(prev => prev ? {
        ...prev,
        isTracked: false,
        trackedGameId: undefined,
      } : prev);
    } catch (err) {
      setTrackingError(err instanceof Error ? err.message : 'Failed to untrack game.');
    } finally {
      setUntrackingLoading(false);
    }
  };

  const handleMarkAsLatest = async (result: GameApiSearchResult) => {
    if (!game?.trackedGameId) return;

    const version = result.originalTitle || result.title || '';
    if (!version.trim()) return;

    const confirmed = window.confirm(`Mark "${version}" as the latest version for "${game.name}"?\n\nThis will update lastKnownVersion and add it to the update history.`);
    if (!confirmed) return;

    setMarkingLatest(result.id);
    setMarkLatestError('');
    setMarkLatestSuccess('');

    try {
      const response = await fetch(`/api/tracking/${game.trackedGameId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version,
          gameLink: result.link || '',
          title: version,
          source: result.source || '',
          image: result.image || '',
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to mark as latest.');
      }

      setMarkLatestSuccess(`Marked "${version}" as latest.`);
      await loadGameByAppId();
    } catch (err) {
      setMarkLatestError(err instanceof Error ? err.message : 'Failed to mark as latest.');
    } finally {
      setMarkingLatest(null);
    }
  };

  const handleSingleGameUpdate = async () => {
    if (!game?.trackedGameId) return;

    setCheckingUpdates(true);
    setTrackingError('');

    try {
      const response = await fetch('/api/updates/check-single', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ gameId: game.trackedGameId }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to check updates.');
      }

      await loadGameByAppId();
    } catch (err) {
      setTrackingError(err instanceof Error ? err.message : 'Failed to check updates.');
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleTrackGame = async () => {
    if (!game?.appid) return;

    if (status === 'unauthenticated') {
      window.location.href = `/auth/signin?callbackUrl=/appid/${game.appid}`;
      return;
    }

    setTrackingLoading(true);
    setTrackingError('');

    try {
      const bestResult = gameResults[0];
      const trackPayload = {
        gameId: String(game.appid),
        title: game.name,
        originalTitle: game.name,
        cleanedTitle: cleanGameTitle(game.name),
        source: bestResult?.source || 'Steam',
        image: bestResult?.image || game.header_image || '',
        description: summary || game.short_description || game.description || '',
        gameLink: bestResult?.link || `https://store.steampowered.com/app/${game.appid}`,
      };

      const response = await fetch('/api/tracking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trackPayload),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || 'Failed to track game.');
      }

      setGame(prev => prev ? {
        ...prev,
        isTracked: true,
      } : prev);
    } catch (err) {
      setTrackingError(err instanceof Error ? err.message : 'Failed to track game.');
    } finally {
      setTrackingLoading(false);
    }
  };

  useEffect(() => {
    let isMounted = true;

    const loadResults = async () => {
      const query = game?.name?.trim();
      if (!query) {
        if (isMounted) {
          setGameResults([]);
          setResultsQuery('');
        }
        return;
      }

      if (isMounted) {
        setResultsLoading(true);
        setResultsError('');
        setResultsQuery(query);
      }

      try {
        const response = await fetch(`/api/games/search?search=${encodeURIComponent(query)}&nocache=1`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load results from gameapi.');
        }

        const results: GameApiSearchResult[] = Array.isArray(data) ? data : [];
        const normalizedQuery = query.toLowerCase();
        const ranked = [...results]
          .sort((a, b) => {
            const aTitle = (a.originalTitle || a.title || '').toLowerCase();
            const bTitle = (b.originalTitle || b.title || '').toLowerCase();
            const aStarts = aTitle.startsWith(normalizedQuery) ? 1 : 0;
            const bStarts = bTitle.startsWith(normalizedQuery) ? 1 : 0;
            if (aStarts !== bStarts) return bStarts - aStarts;

            const aContains = aTitle.includes(normalizedQuery) ? 1 : 0;
            const bContains = bTitle.includes(normalizedQuery) ? 1 : 0;
            if (aContains !== bContains) return bContains - aContains;

            const aDate = a.date ? new Date(a.date).getTime() : 0;
            const bDate = b.date ? new Date(b.date).getTime() : 0;
            return bDate - aDate;
          })
          .slice(0, 18);

        if (isMounted) {
          setGameResults(ranked);
        }
      } catch (err) {
        if (!isMounted) return;
        setResultsError(err instanceof Error ? err.message : 'Failed to load results from gameapi.');
        setGameResults([]);
      } finally {
        if (isMounted) {
          setResultsLoading(false);
        }
      }
    };

    loadResults();

    return () => {
      isMounted = false;
    };
  }, [game?.name]);

  useEffect(() => {
    let isMounted = true;

    const loadLatestVerificationData = async () => {
      if (!game?.isTracked) return;

      if (game.steamAppId && (game.steamVerified || game.gogVerified)) {
        try {
          const steamResponse = await fetch(`/api/steamdb?action=updates&appId=${game.steamAppId}&limit=1`);
          if (steamResponse.ok && isMounted) {
            const steamData = await steamResponse.json();
            const latest = steamData?.data?.updates?.[0];
            if (latest) {
              setSteamLatest({
                version: latest.version,
                build: latest.changeNumber,
                link: latest.link,
              });
            }
          }
        } catch {
          // ignore
        }
      }

      if (game.gogVerified && game.gogProductId && game.gogProductId !== -1) {
        try {
          const gogResponse = await fetch(`/api/gogdb?action=version&productId=${game.gogProductId}&os=windows`, {
            cache: 'default',
            next: { revalidate: 3600 },
          });
          if (gogResponse.ok && isMounted) {
            const gogData = await gogResponse.json();
            if (gogData?.success && (gogData?.version || gogData?.buildId)) {
              setGogLatest({
                version: gogData.version,
                buildId: gogData.buildId,
                date: gogData.date,
              });
            }
          }
        } catch {
          // ignore
        }
      }
    };

    loadLatestVerificationData();

    return () => {
      isMounted = false;
    };
  }, [game?.isTracked, game?.steamAppId, game?.steamVerified, game?.gogVerified, game?.gogProductId]);

  return (
    <div className="min-h-screen">
      <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <Link
            href="/tracking"
            className="btn-glass !py-2 !px-3 !text-sm"
          >
            Back to Tracking
          </Link>

          <div className="flex items-center gap-2">
            {game?.gameLink && (
              <a
                href={game.gameLink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary !py-2 !px-3 !text-sm inline-flex items-center gap-1.5"
              >
                <ExternalLinkIcon className="w-3.5 h-3.5" /> Open Source Page
              </a>
            )}
            {game && !game.isTracked && (
              <button
                type="button"
                onClick={handleTrackGame}
                disabled={trackingLoading || untrackingLoading}
                className="btn-success !py-2 !px-3 !text-sm inline-flex items-center disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {trackingLoading ? 'Tracking...' : 'Track Game'}
              </button>
            )}

            {game?.isTracked && (
              <button
                type="button"
                onClick={handleUntrackGame}
                disabled={untrackingLoading || trackingLoading}
                className="inline-flex items-center rounded-lg bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 px-3 py-2 text-sm font-medium text-white shadow-lg hover:shadow-xl transition-all duration-200 hover:scale-105 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {untrackingLoading ? 'Removing...' : 'Untrack'}
              </button>
            )}
          </div>
        </div>

        {trackingError && (
          <div className="mb-4 rounded-lg border border-red-200/50 dark:border-red-500/40 bg-red-100/80 dark:bg-red-500/10 backdrop-blur-sm p-4 text-sm text-red-700 dark:text-red-200">
            {trackingError}
          </div>
        )}

        {loading && (
          <div className="card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-xl p-8 text-center text-slate-600 dark:text-slate-300">
            Loading AppID data...
          </div>
        )}

        {!loading && error && (
          <div className="card-gradient backdrop-blur-sm border border-red-200/50 dark:border-red-500/40 rounded-xl p-6 text-red-700 dark:text-red-200">
            {error}
          </div>
        )}

        {!loading && !error && game && (
          <div className="space-y-6">
            <section className="overflow-hidden card-gradient backdrop-blur-sm border border-white/20 dark:border-white/10 rounded-xl shadow-lg">
              {game.header_image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={game.header_image}
                  alt={game.name}
                  className="h-auto w-full object-cover"
                />
              )}

              <div className="space-y-4 p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight sm:text-3xl text-gradient">{game.name}</h1>
                  <span className="status-badge bg-slate-100/80 text-slate-700 border border-slate-200/50 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-600/50">AppID {game.appid}</span>
                  <span className="status-badge bg-slate-100/80 text-slate-700 border border-slate-200/50 dark:bg-slate-800/50 dark:text-slate-300 dark:border-slate-600/50">{game.dataSource || 'steam'}</span>
                  {game.isTracked && (
                    <span className="status-badge status-online">Tracked</span>
                  )}
                  {game.steamVerified && (
                    <span className="status-badge bg-primary-100/80 text-primary-800 border border-primary-200/50 dark:bg-primary-900/30 dark:text-primary-300 dark:border-primary-700/50">Steam Verified</span>
                  )}
                  {game.hasNewUpdate && (
                    <span className="status-badge bg-red-100/80 text-red-800 border border-red-200/50 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700/50">Update Pending</span>
                  )}
                </div>

                {summary && <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{summary}</p>}

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border border-white/30 dark:border-white/10 p-3">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Developers</div>
                    <div className="mt-1 text-sm text-slate-800 dark:text-slate-100">{developerText}</div>
                  </div>
                  <div className="rounded-lg bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border border-white/30 dark:border-white/10 p-3">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Publishers</div>
                    <div className="mt-1 text-sm text-slate-800 dark:text-slate-100">{publisherText}</div>
                  </div>
                  <div className="rounded-lg bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border border-white/30 dark:border-white/10 p-3">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Genres</div>
                    <div className="mt-1 text-sm text-slate-800 dark:text-slate-100">{genreText}</div>
                  </div>
                  <div className="rounded-lg bg-white/50 dark:bg-slate-800/50 backdrop-blur-sm border border-white/30 dark:border-white/10 p-3">
                    <div className="text-xs text-slate-500 dark:text-slate-400">Release Date</div>
                    <div className="mt-1 text-sm text-slate-800 dark:text-slate-100">{game.release_date?.date || 'Unknown'}</div>
                  </div>
                </div>
              </div>
            </section>

            {game.isTracked && game.trackedGameId && (
              <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Tracking Management</h2>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSingleGameUpdate}
                      disabled={checkingUpdates}
                      className="inline-flex items-center rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-100 hover:bg-slate-700 disabled:opacity-60"
                    >
                      {checkingUpdates ? 'Checking...' : 'Check Updates'}
                    </button>
                    <GameDownloadLinks gameId={game.trackedGameId} className="w-44" />
                  </div>
                </div>

                <div className="mt-4 space-y-3">
                  <div className="rounded-md border border-slate-700/60 bg-slate-800/50 px-4 py-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-400 mb-1">Currently Tracked</p>
                    <p className="text-sm font-semibold text-slate-100 truncate">{game.originalTitle || game.title || game.name}</p>
                  </div>

                  <SteamVerification
                    gameId={game.trackedGameId}
                    gameTitle={game.title || game.name}
                    steamName={game.steamName}
                    steamVerified={game.steamVerified}
                    steamLatestVersion={steamLatest.version}
                    steamLatestBuild={steamLatest.build}
                    steamLatestLink={steamLatest.link}
                    onVerificationUpdate={handleVerificationUpdate}
                  />

                  <GOGVerification
                    gameId={game.trackedGameId}
                    gameTitle={game.title || game.name}
                    currentGogId={game.gogProductId}
                    currentGogName={game.gogName}
                    isVerified={game.gogVerified}
                    gogLatestVersion={gogLatest.version}
                    gogLatestBuildId={gogLatest.buildId}
                    gogLatestDate={gogLatest.date}
                    trackedVersion={game.currentVersionNumber}
                    trackedBuildId={game.currentBuildNumber}
                    onVerificationComplete={loadGameByAppId}
                  />

                  <SmartVersionVerification
                    gameId={game.gameId || String(game.appid)}
                    gameTitle={game.title || game.name}
                    originalTitle={game.originalTitle || game.title || game.name}
                    steamAppId={game.steamAppId}
                    currentBuildNumber={game.currentBuildNumber}
                    buildNumberVerified={game.buildNumberVerified || false}
                    currentVersionNumber={game.currentVersionNumber}
                    versionNumberVerified={game.versionNumberVerified || false}
                    onVerified={loadGameByAppId}
                  />

                  <div className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
                    <NotificationToggle
                      gameId={game.trackedGameId}
                      currentEnabled={game.notificationsEnabled ?? true}
                      onToggleChanged={loadGameByAppId}
                    />
                  </div>
                </div>
              </section>
            )}

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Recent History</h2>
              <div className="mt-3 space-y-2">
                {!game.updateHistory?.length && (
                  <p className="text-sm text-slate-400">No history available.</p>
                )}
                {game.updateHistory?.slice(0, 10).map((item, idx) => (
                  <div key={`${item.version || 'v'}-${idx}`} className="flex items-center justify-between gap-2 rounded-md border border-slate-800 bg-slate-950/40 p-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-100">{item.version || 'Unknown version'}</p>
                      <p className="text-xs text-slate-400">{item.dateFound ? new Date(item.dateFound).toLocaleString() : 'Unknown date'}</p>
                    </div>
                    {item.gameLink && (
                      <a
                        href={item.gameLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                      >
                        Open Source
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">Results</h2>
                <span className="rounded bg-slate-800 px-2 py-1 text-xs text-slate-300">
                  Query: {resultsQuery || game.name}
                </span>
              </div>

              <p className="mt-2 text-sm text-slate-400">
                Live search results for this game from gameapi sources.
              </p>

              {markLatestError && (
                <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                  {markLatestError}
                </div>
              )}
              {markLatestSuccess && (
                <div className="mt-3 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-200">
                  {markLatestSuccess}
                </div>
              )}

              {resultsLoading && (
                <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-300">
                  Loading results from gameapi...
                </div>
              )}

              {!resultsLoading && resultsError && (
                <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
                  {resultsError}
                </div>
              )}

              {!resultsLoading && !resultsError && gameResults.length === 0 && (
                <div className="mt-4 rounded-md border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
                  No results found in gameapi for this title.
                </div>
              )}

              {!resultsLoading && !resultsError && gameResults.length > 0 && (
                <div className="mt-4 space-y-3">
                  {gameResults.map((result) => (
                    <div key={result.id} className="rounded-md border border-slate-800 bg-slate-950/40 p-3">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-3">
                            {result.image && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={result.image}
                                alt={result.originalTitle || result.title}
                                className="h-20 w-14 shrink-0 rounded object-cover"
                              />
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="mb-2 flex flex-wrap items-center gap-2">
                                <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{result.source || 'Unknown source'}</span>
                                <span className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-300">{result.siteType || 'unknown'}</span>
                              </div>
                              <h3 className="line-clamp-2 text-sm font-semibold text-slate-100">
                                {result.originalTitle || result.title}
                              </h3>
                              <p className="mt-1 text-xs text-slate-400">
                                {result.date ? new Date(result.date).toLocaleString() : 'Unknown date'}
                              </p>
                            </div>
                          </div>
                        </div>

                        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-44">
                          {result.link && (
                            <a
                              href={result.link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block w-full rounded border border-slate-700 px-3 py-1.5 text-center text-xs text-slate-100 hover:bg-slate-800"
                            >
                              Open Source Post
                            </a>
                          )}

                          {result.originalId && result.siteType && (
                            <GameDownloadLinks
                              postId={String(result.originalId)}
                              siteType={result.siteType}
                              gameTitle={result.originalTitle || result.title}
                              className="w-full"
                            />
                          )}

                          {game.isTracked && game.trackedGameId && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleMarkAsLatest(result)}
                                disabled={markingLatest === result.id}
                                className="block w-full rounded border border-emerald-700 px-3 py-1.5 text-center text-xs text-emerald-300 hover:bg-emerald-900/40 disabled:opacity-60"
                              >
                                {markingLatest === result.id ? 'Saving...' : '✓ Mark as Latest'}
                              </button>
                              <button
                                type="button"
                                onClick={handleSingleGameUpdate}
                                disabled={checkingUpdates}
                                className="block w-full rounded border border-slate-700 px-3 py-1.5 text-center text-xs text-slate-100 hover:bg-slate-800 disabled:opacity-60"
                              >
                                {checkingUpdates ? 'Checking...' : '🔄 Check Updates'}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
