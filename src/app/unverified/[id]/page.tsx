"use client";

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { SteamVerification } from '../../../components/SteamVerification';

interface TrackedGameResponse {
  _id: string;
  gameId: string;
  title: string;
  originalTitle?: string;
  image?: string;
  description?: string;
  source?: string;
  gameLink?: string;
  steamAppId?: number;
  steamName?: string;
  steamVerified?: boolean;
  lastKnownVersion?: string;
  currentVersionNumber?: string;
  currentBuildNumber?: string;
}

export default function UnverifiedGamePage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params?.id) ? params?.id[0] : params?.id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [game, setGame] = useState<TrackedGameResponse | null>(null);

  const displayTitle = useMemo(() => {
    if (!game) return '';
    return game.steamName || game.originalTitle || game.title;
  }, [game]);

  useEffect(() => {
    let isMounted = true;

    const loadGame = async () => {
      if (!id) {
        setError('Missing game id.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError('');

      try {
        const response = await fetch(`/api/tracking/${id}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error || 'Failed to load tracked game.');
        }

        if (!isMounted) return;
        setGame(data.game);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load tracked game.');
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
  }, [id]);

  const handleVerificationUpdate = (_gameId: string, verified: boolean, steamAppId?: number, steamName?: string) => {
    setGame(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        steamVerified: verified,
        steamAppId: steamAppId || prev.steamAppId,
        steamName: steamName || prev.steamName,
      };
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-sm text-gray-500 dark:text-gray-400">Loading unverified game...</div>
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className="min-h-screen px-4 py-12">
        <div className="max-w-3xl mx-auto rounded-xl border border-red-400/30 bg-red-500/10 p-5">
          <h1 className="text-lg font-semibold text-red-200 mb-2">Unable to open game</h1>
          <p className="text-sm text-red-100/90">{error || 'Tracked game was not found.'}</p>
          <div className="mt-4">
            <Link href="/tracking" className="inline-flex items-center px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm text-white transition-colors">
              Back to Tracking
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const canOpenAppPage = !!game.steamAppId;

  return (
    <div className="min-h-screen px-4 py-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-white">Unverified Game Management</h1>
            <p className="text-sm text-gray-300 mt-1">Add Steam appid verification for this tracked game so full appid tools can be used.</p>
          </div>
          <Link href="/tracking" className="inline-flex items-center px-3 py-2 rounded-md bg-white/10 hover:bg-white/20 text-sm text-white transition-colors">
            Back to Tracking
          </Link>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
          <div className="grid md:grid-cols-[180px_1fr] gap-5">
            <div>
              {game.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={game.image}
                  alt={displayTitle}
                  className="w-full rounded-lg border border-white/10 object-cover"
                />
              ) : (
                <div className="w-full aspect-[2/3] rounded-lg border border-dashed border-white/20 flex items-center justify-center text-xs text-gray-400">
                  No image
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h2 className="text-xl font-semibold text-white">{displayTitle}</h2>

              <div className="text-sm text-gray-300">
                <div>Tracked Title: <span className="text-white">{game.originalTitle || game.title}</span></div>
                <div>Last Known: <span className="text-white">{game.lastKnownVersion || game.currentVersionNumber || game.currentBuildNumber || 'Unknown'}</span></div>
                <div>Steam App ID: <span className="text-white">{game.steamAppId || 'Not linked'}</span></div>
              </div>

              {game.gameLink && (
                <a
                  href={game.gameLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-3 py-2 rounded-md bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 text-sm transition-colors"
                >
                  Open Current Source Link
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 space-y-4">
          <h3 className="text-lg font-semibold text-white">Steam Verification</h3>
          <p className="text-sm text-gray-300">Use this to find and link the correct Steam app. Once linked, the game can be managed via appid page.</p>

          <SteamVerification
            gameId={game._id}
            gameTitle={game.originalTitle || game.title}
            steamName={game.steamName}
            steamVerified={game.steamVerified}
            onVerificationUpdate={handleVerificationUpdate}
          />
        </div>

        <div className="rounded-2xl border border-white/10 bg-slate-900/60 p-5">
          {canOpenAppPage ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h4 className="text-white font-semibold">Ready for appid route</h4>
                <p className="text-sm text-gray-300">Steam appid is linked. Open the full management page.</p>
              </div>
              <Link
                href={`/appid/${game.steamAppId}`}
                className="inline-flex items-center px-4 py-2 rounded-md bg-green-600 hover:bg-green-700 text-white text-sm font-medium transition-colors"
              >
                Open AppID Page
              </Link>
            </div>
          ) : (
            <div>
              <h4 className="text-white font-semibold">Waiting for Steam appid</h4>
              <p className="text-sm text-gray-300">Link a Steam app above to unlock appid page management and SteamDB-backed update intelligence.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
