'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNotification } from '../../../contexts/NotificationContext';
import { useConfirm } from '../../../contexts/ConfirmContext';

export default function UserManagePage() {
  const { showSuccess, showError } = useNotification();
  const { confirm } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [botInfo, setBotInfo] = useState<{ username: string; botLink: string } | null>(null);

  const [form, setForm] = useState({
    email: '',
    username: '',
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: '',
    // notification settings
    notificationsProvider: 'telegram',
    notifyImmediately: true,
    telegramUsername: '',
    telegramChatId: '',
    telegramBotManagementEnabled: false,
    // release group preferences
    prioritize0xdeadcode: false,
    avoidRepacks: false,
    preferRepacks: false
  });

  const router = useRouter();

  useEffect(() => {
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/user/me');
        if (!res.ok) throw new Error('Failed to load user');
        const data = await res.json();
        if (!mounted) return;
  setForm((f) => ({ ...f, email: data.email || '', username: data.username || f.username }));
        // initialize notification settings from preferences if available
        if (data.preferences?.notifications) {
          setForm((f) => ({
            ...f,
            notificationsProvider: data.preferences.notifications.provider || 'telegram',
            notifyImmediately: typeof data.preferences.notifications.notifyImmediately === 'boolean' ? data.preferences.notifications.notifyImmediately : true,
            telegramUsername: data.preferences.notifications.telegramUsername || '',
            telegramChatId: data.preferences.notifications.telegramChatId || '',
            telegramBotManagementEnabled: data.preferences.notifications.telegramBotManagementEnabled || false
          }));
        }
        
        // Load release group preferences
        if (data.preferences?.releaseGroups) {
          setForm((f) => ({
            ...f,
            prioritize0xdeadcode: data.preferences.releaseGroups.prioritize0xdeadcode || false,
            avoidRepacks: data.preferences.releaseGroups.avoidRepacks || false,
            preferRepacks: data.preferences.releaseGroups.preferRepacks || false
          }));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message || 'Unable to load user');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  // Fetch Telegram bot info
  useEffect(() => {
    async function fetchBotInfo() {
      try {
        const res = await fetch('/api/telegram/bot-info');
        if (res.ok) {
          const data = await res.json();
          setBotInfo(data);
        }
      } catch (error) {
        console.error('Failed to fetch bot info:', error);
      }
    }
    fetchBotInfo();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    const { name, type } = target;
    const value = type === 'checkbox' ? (target as HTMLInputElement).checked : target.value;
    setForm({ ...form, [name]: value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (form.newPassword && form.newPassword !== form.confirmNewPassword) {
      setError('New passwords do not match');
      return;
    }

    setSaving(true);
    try {
      const payload: { 
        email: string; 
        username?: string;
        currentPassword?: string; 
        newPassword?: string; 
        provider?: string; 
        notifyImmediately?: boolean;
        telegramUsername?: string;
        telegramChatId?: string;
        telegramBotManagementEnabled?: boolean;
        prioritize0xdeadcode?: boolean;
        avoidRepacks?: boolean;
        preferRepacks?: boolean;
      } = { email: form.email };

      if (form.username) {
        payload.username = form.username.toLowerCase();
      }
      
      if (form.newPassword) {
        payload.currentPassword = form.currentPassword;
        payload.newPassword = form.newPassword;
      }
      
      // Notification settings
      payload.provider = form.notificationsProvider;
      payload.notifyImmediately = form.notifyImmediately;
      payload.telegramUsername = form.telegramUsername;
      payload.telegramChatId = form.telegramChatId;
      payload.telegramBotManagementEnabled = form.telegramBotManagementEnabled;
      
      // Release group preferences
      payload.prioritize0xdeadcode = form.prioritize0xdeadcode;
      payload.avoidRepacks = form.avoidRepacks;
      payload.preferRepacks = form.preferRepacks;
      payload.preferRepacks = form.preferRepacks;

      const res = await fetch('/api/user/update', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data?.error || 'Update failed');
      } else {
        setSuccess('Profile updated');
        try { router.refresh(); } catch { /* ignore */ }
        // clear password fields
        setForm((f) => ({ ...f, currentPassword: '', newPassword: '', confirmNewPassword: '' }));
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Update failed');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 p-6 flex items-start justify-center">
      <div className="max-w-2xl w-full bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Manage Account</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">Update your email, change password, and configure notification options (coming soon).</p>

        <form className="mt-6 space-y-6" onSubmit={handleSubmit}>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Username</label>
            <input
              name="username"
              type="text"
              value={form.username}
              onChange={handleChange}
              placeholder="your_username"
              className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Lowercase letters, numbers & underscores. Can be changed anytime.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email</label>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              required
              className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              disabled
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Email notifications coming soon.</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Current Password (required to change password)</label>
            <input
              name="currentPassword"
              type="password"
              value={form.currentPassword}
              onChange={handleChange}
              className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">New Password</label>
              <input
                name="newPassword"
                type="password"
                value={form.newPassword}
                onChange={handleChange}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Confirm New Password</label>
              <input
                name="confirmNewPassword"
                type="password"
                value={form.confirmNewPassword}
                onChange={handleChange}
                className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Notification Settings</label>
            <div className="mt-3 space-y-4">
              {/* Immediate Notifications */}
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  name="notifyImmediately"
                  checked={form.notifyImmediately}
                  onChange={(e) => setForm({ ...form, notifyImmediately: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-sm text-gray-600 dark:text-gray-300">Send notifications immediately when updates are found</label>
              </div>

              {/* Telegram Settings */}
              <div className="space-y-3 p-4 border border-purple-200 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20 rounded-md">
                  <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                          Telegram Username
                          <span className="text-gray-500 ml-1">(optional - use this OR Chat ID)</span>
                        </label>
                        <input
                          type="text"
                          name="telegramUsername"
                          value={form.telegramUsername}
                          onChange={handleChange}
                          placeholder="@yourusername"
                          className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Your Telegram username (with or without @)
                        </p>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                          Chat ID
                          <span className="text-gray-500 ml-1">(optional - use this OR Username)</span>
                        </label>
                        <input
                          type="text"
                          name="telegramChatId"
                          value={form.telegramChatId}
                          onChange={handleChange}
                          placeholder="123456789"
                          className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Get your Chat ID by sending /start to the bot
                        </p>
                      </div>
                      <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded border">
                        <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                          🚀 How to get started:
                        </p>
                        {botInfo ? (
                          <ol className="text-xs text-gray-600 dark:text-gray-400 space-y-1 list-decimal list-inside">
                            <li>
                              Start the bot: <a 
                                href={botInfo.botLink} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                              >
                                @{botInfo.username}
                              </a>
                            </li>
                            <li>Send <code className="px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">/start</code> to get your Chat ID</li>
                            <li>Enter your username or the Chat ID above</li>
                            <li>Save your settings</li>
                          </ol>
                        ) : (
                          <ol className="text-xs text-gray-600 dark:text-gray-400 space-y-1 list-decimal list-inside">
                            <li>Start the shared AIOgames bot on Telegram</li>
                            <li>Send <code className="px-1 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">/start</code> to get your Chat ID</li>
                            <li>Enter your username or the Chat ID above</li>
                            <li>Save your settings</li>
                          </ol>
                        )}
                      </div>
                      <div className="mt-3 p-3 bg-gray-50 dark:bg-gray-800 rounded border">
                        <div className="flex items-center space-x-2">
                          <input
                            type="checkbox"
                            name="telegramBotManagementEnabled"
                            checked={form.telegramBotManagementEnabled}
                            onChange={(e) => setForm({ ...form, telegramBotManagementEnabled: e.target.checked })}
                            className="w-4 h-4"
                            disabled
                          />
                          <label className="text-sm font-medium text-gray-700 dark:text-gray-300">🤖 Telegram Bot Management <span className="ml-2 text-xs text-orange-500">(coming soon)</span></label>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Manage your tracked games directly from Telegram (add, remove, list, update) — coming soon!
                        </p>
                      </div>
                </div>
            </div>
          </div>

          {/* Release Group Preferences */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
              Release Group Preferences
            </label>
            <div className="space-y-4 bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  name="prioritize0xdeadcode"
                  checked={form.prioritize0xdeadcode}
                  onChange={handleChange}
                  className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <div>
                  <label className="text-sm font-medium text-gray-900 dark:text-white">
                    Prefer 0xdeadcode releases (online fixes)
                  </label>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    Always accept 0xdeadcode releases as valid updates and prioritize them over other groups
                  </p>
                </div>
              </div>
              
              <div className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  name="avoidRepacks"
                  checked={form.avoidRepacks}
                  onChange={handleChange}
                  className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                  disabled={form.preferRepacks}
                />
                <div>
                  <label className="text-sm font-medium text-gray-900 dark:text-white">
                    Avoid Repacks
                  </label>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    Filter out repack releases (titles containing &quot;repack&quot; or &quot;-repack&quot;) from update notifications
                  </p>
                </div>
              </div>
              
              <div className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  name="preferRepacks"
                  checked={form.preferRepacks}
                  onChange={handleChange}
                  className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <div>
                  <label className="text-sm font-medium text-gray-900 dark:text-white">
                    Prefer Repacks ONLY
                  </label>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    Only track and receive repack releases. Repacks get priority 1, all other releases are ignored
                  </p>
                </div>
              </div>
            </div>
          </div>

          {error && <div className="text-sm text-red-600 dark:text-red-300">{error}</div>}
          {success && <div className="text-sm text-green-600 dark:text-green-300">{success}</div>}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            
            {/* Test Telegram button */}
            {form.telegramChatId && (
              <button
                type="button"
                className="px-4 py-2 bg-purple-600 text-white rounded-md"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/notifications/test-telegram', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        username: form.telegramUsername,
                        chatId: form.telegramChatId
                      })
                    });
                    const data = await res.json();
                    if (!res.ok) {
                      showError('Telegram Test Failed', data?.error || 'Failed to send Telegram test');
                      return;
                    }
                    showSuccess('Telegram Test Sent', 'Telegram test message sent successfully!');
                  } catch {
                    showError('Telegram Test Failed', 'Failed to send Telegram test');
                  }
                }}
              >
                Test Telegram
              </button>
            )}
            
            <button
              type="button"
              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700"
              onClick={() => router.push('/')}
            >
              Close
            </button>
          </div>
        </form>

        {/* Danger Zone - Moved to Bottom */}
        <div className="mt-8 pt-6 border-t border-red-200 dark:border-red-800">
          <h2 className="text-lg font-medium text-red-900 dark:text-red-100">⚠️ Danger Zone</h2>
          <p className="text-sm text-red-600 dark:text-red-300 mt-1">Delete your account — this will permanently remove your account and all tracked games.</p>
          <div className="mt-4">
            <button
              type="button"
              onClick={async () => {
                const confirmed = await confirm('Delete Account', 'Are you sure you want to delete your account? This action cannot be undone.');
                if (!confirmed) return;
                try {
                  const res = await fetch('/api/user/delete', { method: 'DELETE' });
                  const data = await res.json();
                  if (!res.ok) {
                    showError('Account Deletion Failed', data?.error || 'Failed to delete account');
                    return;
                  }
                  // Redirect to home after deletion
                  window.location.href = '/';
                } catch {
                  showError('Account Deletion Failed', 'Failed to delete account');
                }
              }}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-md font-medium transition-colors"
            >
              🗑️ Delete Account
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
