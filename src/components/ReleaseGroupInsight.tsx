"use client";

import { useEffect, useState } from 'react';
import { useNotification } from '../contexts/NotificationContext';

interface ReleaseGroupEntry {
  releaseGroup: string;
  title: string;
  version?: string;
  buildNumber?: string;
  dateFound: string;
  _id: string;
}

interface ReleaseGroupInsightProps {
  gameId: string;
}

// Curated trusted scene/pack groups (initial list; can be extended at runtime later)
const TRUSTED_GROUPS = new Set([
  'RUNE','TENOKE','GOG','CODEX','SKIDROW','DODI','FITGIRL','EMPRESS','PLAZA','RAZOR1911','DARKSIDERS','HOODLUM','FLT','GOLDBERG','P2P'
]);

export function ReleaseGroupInsight({ gameId }: ReleaseGroupInsightProps) {
  const { showError } = useNotification();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [latestGroup, setLatestGroup] = useState<ReleaseGroupEntry | null>(null);
  const [reliability, setReliability] = useState<number | null>(null);
  const [alternateGroups, setAlternateGroups] = useState<string[]>([]);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/tracking/${gameId}/release-groups`);
        if (!res.ok) throw new Error('Failed to load release group data');
        const data = await res.json();
        if (cancelled) return;
        const groups: ReleaseGroupEntry[] = data.releaseGroups || [];
        if (groups.length === 0) {
          setLatestGroup(null);
          setReliability(null);
          return;
        }
        // Most recent already first due to API sort; pick that as primary
        const primary = groups[0];
        setLatestGroup(primary);

        // Reliability heuristic:
        // Count occurrences of each release group in totalVariants ordering (we only got grouped unique, so fallback to uniqueness score)
        // We approximate frequency weight by giving 1 point per unique group and a slight boost if in TRUSTED_GROUPS.
        // If name matches 0xdeadcode -> treat as ONLINE-FIX alias with high trust (85 base).
        const specialAlias = primary.releaseGroup.toLowerCase() === '0xdeadcode';
        let base = 60; // base confidence for any detected group
        if (TRUSTED_GROUPS.has(primary.releaseGroup.toUpperCase())) base = 75;
        if (specialAlias) base = 85; // online-fix special handling

        // Add small bonus if version/build present
        if (primary.version) base += 5;
        if (primary.buildNumber) base += 5;

        // Cap at 95; floor at 50
        base = Math.min(95, Math.max(50, base));
        setReliability(base);

        // Provide a few alternates (other groups discovered)
        const alts = groups.slice(1, 4).map(g => g.releaseGroup);
        setAlternateGroups(alts);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        setError(msg);
        showError('Failed to load release group insight');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [gameId, showError]);

  if (loading) {
    return (
      <div className="mt-2 p-3 rounded-md bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        Release group analysis…
      </div>
    );
  }

  if (error || !latestGroup) {
    return null; // Keep UI clean if nothing yet
  }

  const displayGroup = latestGroup.releaseGroup.toLowerCase() === '0xdeadcode'
    ? 'ONLINE-FIX (0xdeadcode)'
    : latestGroup.releaseGroup;

  return (
    <div className="mt-2 p-3 rounded-md bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-indigo-600 dark:text-indigo-300 font-semibold mb-1">
            Release Group Extraction
          </div>
          <div className="text-sm font-mono text-indigo-800 dark:text-indigo-200 flex flex-wrap items-center gap-2">
            <span className="px-2 py-0.5 bg-indigo-100 dark:bg-indigo-800/40 rounded-md">{displayGroup}</span>
            {alternateGroups.length > 0 && (
              <span className="text-xs text-indigo-500 dark:text-indigo-400">Alt: {alternateGroups.join(', ')}</span>
            )}
          </div>
          {(latestGroup.version || latestGroup.buildNumber) && (
            <div className="text-xs text-indigo-600 dark:text-indigo-400 mt-1">
              {latestGroup.version && <>v{latestGroup.version}</>}
              {latestGroup.version && latestGroup.buildNumber && ' • '}
              {latestGroup.buildNumber && <>Build {latestGroup.buildNumber}</>}
            </div>
          )}
        </div>
        {reliability !== null && (
          <div className="text-right">
            <div className="text-[10px] uppercase text-indigo-500 dark:text-indigo-400 font-medium">Reliability</div>
            <div className="text-sm font-semibold text-indigo-700 dark:text-indigo-200">{reliability}%</div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ReleaseGroupInsight;