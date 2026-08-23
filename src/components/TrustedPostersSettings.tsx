'use client';

import { useCallback, useEffect, useState } from 'react';
import { useNotification } from '../contexts/NotificationContext';

type ReputationList = { stored: string[]; env: string[] };
type ReputationResponse = { trusted: ReputationList; untrusted: ReputationList };

/** One editable panel (trusted or untrusted) plus its read-only env baseline. */
function PosterListEditor({
  label,
  hint,
  accent,
  value,
  envValue,
  onChange,
}: {
  label: string;
  hint: string;
  accent: 'green' | 'red';
  value: string;
  envValue: string[];
  onChange: (next: string) => void;
}) {
  const accentClasses =
    accent === 'green'
      ? 'focus:ring-green-500 border-green-300/50 dark:border-green-700/50'
      : 'focus:ring-red-500 border-red-300/50 dark:border-red-700/50';

  return (
    <div className="flex-1 min-w-[260px]">
      <label className="block text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1">{label}</label>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{hint}</p>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={6}
        spellCheck={false}
        placeholder="One username per line"
        className={`w-full px-3 py-2 text-sm rounded-lg bg-white dark:bg-gray-900 border text-gray-900 dark:text-white focus:outline-none focus:ring-2 ${accentClasses}`}
      />
      {envValue.length > 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          From environment (always applied):{' '}
          <span className="font-mono text-gray-700 dark:text-gray-300">{envValue.join(', ')}</span>
        </p>
      )}
    </div>
  );
}

/** Splits a textarea into a trimmed, de-duplicated username list. */
function parseList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,]/)) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

export function TrustedPostersSettings() {
  const { showSuccess, showError } = useNotification();
  const [trusted, setTrusted] = useState('');
  const [untrusted, setUntrusted] = useState('');
  const [env, setEnv] = useState<{ trusted: string[]; untrusted: string[] }>({ trusted: [], untrusted: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/trusted-posters');
      if (!res.ok) throw new Error('Failed to load poster settings');
      const data = (await res.json()) as ReputationResponse;
      setTrusted(data.trusted.stored.join('\n'));
      setUntrusted(data.untrusted.stored.join('\n'));
      setEnv({ trusted: data.trusted.env, untrusted: data.untrusted.env });
    } catch (error) {
      showError('Load failed', error instanceof Error ? error.message : 'Could not load settings');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/trusted-posters', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trusted: parseList(trusted), untrusted: parseList(untrusted) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      // Reflect the server's cleaned/deduped lists back into the fields.
      setTrusted((data as ReputationResponse).trusted.stored.join('\n'));
      setUntrusted((data as ReputationResponse).untrusted.stored.join('\n'));
      showSuccess('Saved', 'cs.rin.ru poster reputation updated. New searches use it immediately.');
    } catch (error) {
      showError('Save failed', error instanceof Error ? error.message : 'Could not save settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-8">
        <div className="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-1">cs.rin.ru poster reputation</h2>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Trusted uploaders are ranked to the top of forum search results; untrusted ones sink to the bottom.
        Changes apply to new searches within a minute — no restart needed.
      </p>

      <div className="flex flex-wrap gap-6">
        <PosterListEditor
          label="✅ Trusted uploaders"
          hint="Known-clean posters (e.g. Owla, nomenomenom). Ranked first."
          accent="green"
          value={trusted}
          envValue={env.trusted}
          onChange={setTrusted}
        />
        <PosterListEditor
          label="🚫 Untrusted uploaders"
          hint="Posters to push down. Never removes a name that is also trusted."
          accent="red"
          value={untrusted}
          envValue={env.untrusted}
          onChange={setUntrusted}
        />
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={load}
          disabled={saving}
          className="px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors"
        >
          Reset
        </button>
      </div>
    </div>
  );
}
