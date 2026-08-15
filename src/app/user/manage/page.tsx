'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNotification } from '../../../contexts/NotificationContext';
import RSSFeedManager from '../../../components/RSSFeedManager';

type SettingsForm = {
  notifyImmediately: boolean;
  telegramUsername: string;
  telegramChatId: string;
  telegramBotManagementEnabled: boolean;
  prioritize0xdeadcode: boolean;
  avoidOnlineFixes: boolean;
  avoidRepacks: boolean;
  preferRepacks: boolean;
  showRecentUploads: boolean;
};

const initialForm: SettingsForm = {
  notifyImmediately: true,
  telegramUsername: '',
  telegramChatId: '',
  telegramBotManagementEnabled: false,
  prioritize0xdeadcode: false,
  avoidOnlineFixes: false,
  avoidRepacks: false,
  preferRepacks: false,
  showRecentUploads: false,
};

export default function SettingsPage() {
  const router = useRouter();
  const { showSuccess, showError } = useNotification();
  const [form, setForm] = useState(initialForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [botInfo, setBotInfo] = useState<{ username: string; botLink: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch('/api/user/me').then(response => response.ok ? response.json() : Promise.reject(new Error('Failed to load settings'))),
      fetch('/api/telegram/bot-info').then(response => response.ok ? response.json() : null),
    ]).then(([data, info]) => {
      if (!mounted) return;
      const notifications = data.preferences?.notifications || {};
      const releaseGroups = data.preferences?.releaseGroups || {};
      const homepage = data.preferences?.homepage || {};
      setForm({
        notifyImmediately: notifications.notifyImmediately ?? true,
        telegramUsername: notifications.telegramUsername || '',
        telegramChatId: notifications.telegramChatId || '',
        telegramBotManagementEnabled: notifications.telegramBotManagementEnabled || false,
        prioritize0xdeadcode: releaseGroups.prioritize0xdeadcode || false,
        avoidOnlineFixes: releaseGroups.avoidOnlineFixes || false,
        avoidRepacks: releaseGroups.avoidRepacks || false,
        preferRepacks: releaseGroups.preferRepacks || false,
        showRecentUploads: homepage.showRecentUploads || false,
      });
      if (info) setBotInfo(info);
    }).catch(error => showError('Settings Error', error instanceof Error ? error.message : 'Failed to load settings'))
      .finally(() => mounted && setLoading(false));
    return () => { mounted = false; };
  }, [showError]);

  const setBoolean = (name: keyof SettingsForm, value: boolean) => {
    setForm(current => ({ ...current, [name]: value }));
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const response = await fetch('/api/user/update', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'telegram',
          ...form,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to save settings');
      showSuccess('Settings Saved', 'Shared library preferences were updated.');
      router.refresh();
    } catch (error) {
      showError('Save Failed', error instanceof Error ? error.message : 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const testTelegram = async () => {
    try {
      const response = await fetch('/api/notifications/test-telegram', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: form.telegramUsername, chatId: form.telegramChatId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to send Telegram test');
      showSuccess('Telegram Test Sent', 'The test message was delivered.');
    } catch (error) {
      showError('Telegram Test Failed', error instanceof Error ? error.message : 'Failed to send Telegram test');
    }
  };

  if (loading) return <div className="p-8 text-slate-600 dark:text-slate-300">Loading settings...</div>;

  return (
    <main className="min-h-screen p-4 sm:p-6">
      <form className="max-w-3xl mx-auto space-y-8" onSubmit={save}>
        <header>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Settings</h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Preferences apply to the shared NAS library.</p>
        </header>

        <section className="space-y-4 border-t border-slate-200 dark:border-slate-700 pt-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Notifications</h2>
          <label className="flex items-start gap-3">
            <input type="checkbox" checked={form.notifyImmediately} onChange={event => setBoolean('notifyImmediately', event.target.checked)} className="mt-1 h-4 w-4" />
            <span className="text-sm text-slate-700 dark:text-slate-300">Send notifications immediately when updates are found</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="text-sm text-slate-700 dark:text-slate-300">
              Telegram username
              <input value={form.telegramUsername} onChange={event => setForm(current => ({ ...current, telegramUsername: event.target.value }))} placeholder="@username" className="mt-1 block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800" />
            </label>
            <label className="text-sm text-slate-700 dark:text-slate-300">
              Telegram chat ID
              <input value={form.telegramChatId} onChange={event => setForm(current => ({ ...current, telegramChatId: event.target.value }))} placeholder="123456789" className="mt-1 block w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800" />
            </label>
          </div>
          {botInfo && <p className="text-xs text-slate-500 dark:text-slate-400">Send <code>/start</code> to <a href={botInfo.botLink} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">@{botInfo.username}</a> to get the chat ID.</p>}
          {form.telegramChatId && <button type="button" onClick={testTelegram} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-md text-sm">Test Telegram</button>}
        </section>

        <section className="space-y-4 border-t border-slate-200 dark:border-slate-700 pt-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Discovery</h2>
          <Toggle label="Always show recent uploads" checked={form.showRecentUploads} onChange={value => setBoolean('showRecentUploads', value)} />
          <Toggle label="Avoid online fixes" checked={form.avoidOnlineFixes} onChange={value => setForm(current => ({ ...current, avoidOnlineFixes: value, prioritize0xdeadcode: value ? false : current.prioritize0xdeadcode }))} />
          <Toggle label="Prefer 0xdeadcode releases for online fixes" checked={form.prioritize0xdeadcode} disabled={form.avoidOnlineFixes} onChange={value => setBoolean('prioritize0xdeadcode', value)} />
          <Toggle label="Avoid repacks" checked={form.avoidRepacks} disabled={form.preferRepacks} onChange={value => setBoolean('avoidRepacks', value)} />
          <Toggle label="Prefer repacks only" checked={form.preferRepacks} onChange={value => setForm(current => ({ ...current, preferRepacks: value, avoidRepacks: value ? false : current.avoidRepacks }))} />
        </section>

        <section className="border-t border-slate-200 dark:border-slate-700 pt-6">
          <RSSFeedManager />
        </section>

        <div className="flex gap-3 border-t border-slate-200 dark:border-slate-700 pt-6">
          <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-50">{saving ? 'Saving...' : 'Save Settings'}</button>
          <button type="button" onClick={() => router.push('/')} className="px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-md text-slate-700 dark:text-slate-300">Close</button>
        </div>
      </form>
    </main>
  );
}

function Toggle({ label, checked, disabled = false, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} className="mt-1 h-4 w-4" />
      <span className="text-sm text-slate-700 dark:text-slate-300">{label}</span>
    </label>
  );
}
