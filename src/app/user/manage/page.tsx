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

  const [form, setForm] = useState({
    email: '',
    username: '',
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: '',
    // notification settings
    notificationsProvider: '',
    webpushEnabled: true,
    notifyImmediately: true,
    telegramEnabled: false,
    telegramBotToken: '',
    telegramChatId: '',
    telegramBotManagementEnabled: false,
    // release group preferences
    prioritize0xdeadcode: false,
    prefer0xdeadcodeForOnlineFixes: true,
    avoidRepacks: false
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
            notificationsProvider: data.preferences.notifications.provider || f.notificationsProvider,
            webpushEnabled: typeof data.preferences.notifications.webpushEnabled === 'boolean' ? data.preferences.notifications.webpushEnabled : f.webpushEnabled,
            notifyImmediately: typeof data.preferences.notifications.notifyImmediately === 'boolean' ? data.preferences.notifications.notifyImmediately : true,
            telegramEnabled: data.preferences.notifications.telegramEnabled || false,
            telegramBotToken: data.preferences.notifications.telegramBotToken || '',
            telegramChatId: data.preferences.notifications.telegramChatId || '',
            telegramBotManagementEnabled: data.preferences.notifications.telegramBotManagementEnabled || false
          }));
          // If provider is webpush and enabled, prompt for permission
          if ((data.preferences.notifications.provider === 'webpush' || !data.preferences.notifications.provider) && data.preferences.notifications.webpushEnabled !== false) {
            // prompt after a tick to avoid blocking render
                    setTimeout(() => {
                      if (Notification && Notification.permission === 'default') {
                        // request permission non-blocking
                        void Notification.requestPermission();
                      }
                    }, 500);
          }
        }
        
        // Load release group preferences
        if (data.preferences?.releaseGroups) {
          setForm((f) => ({
            ...f,
            prioritize0xdeadcode: data.preferences.releaseGroups.prioritize0xdeadcode || false,
            prefer0xdeadcodeForOnlineFixes: data.preferences.releaseGroups.prefer0xdeadcodeForOnlineFixes !== false,
            avoidRepacks: data.preferences.releaseGroups.avoidRepacks || false
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

  // Register service worker and subscribe if webpush enabled
  useEffect(() => {
    async function setupPush() {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
      try {
        // register service worker
        const reg = await navigator.serviceWorker.register('/sw.js');

        // fetch VAPID public key
        const r = await fetch('/api/notifications/vapid-public');
        if (!r.ok) return;
        const { publicKey } = await r.json();
        if (!publicKey) return;

        // subscribe if permission is default and user wants webpush
        if (form.notificationsProvider === 'webpush' && form.webpushEnabled) {
          if (Notification.permission === 'default') {
            // request permission first
            const perm = await Notification.requestPermission();
            if (perm !== 'granted') return;
          }

          if (Notification.permission === 'granted') {
            const sub = await reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: urlBase64ToUint8Array(publicKey)
            });

            // send subscription to backend
            await fetch('/api/user/subscribe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ subscription: sub })
            });
          }
        }
          } catch {
        // ignore errors during push setup
      }
    }

    setupPush();
  }, [form.notificationsProvider, form.webpushEnabled]);

  // helper: convert base64 public key to Uint8Array
  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target as HTMLInputElement | HTMLSelectElement;
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
        webpushEnabled?: boolean;
        notifyImmediately?: boolean;
        telegramEnabled?: boolean;
        telegramBotToken?: string;
        telegramChatId?: string;
        telegramBotManagementEnabled?: boolean;
        prioritize0xdeadcode?: boolean;
        prefer0xdeadcodeForOnlineFixes?: boolean;
        avoidRepacks?: boolean;
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
      payload.webpushEnabled = form.webpushEnabled;
      payload.notifyImmediately = form.notifyImmediately;
      payload.telegramEnabled = form.telegramEnabled;
      payload.telegramBotToken = form.telegramBotToken;
      payload.telegramChatId = form.telegramChatId;
      payload.telegramBotManagementEnabled = form.telegramBotManagementEnabled;
      
      // Release group preferences
      payload.prioritize0xdeadcode = form.prioritize0xdeadcode;
      payload.prefer0xdeadcodeForOnlineFixes = form.prefer0xdeadcodeForOnlineFixes;
      payload.avoidRepacks = form.avoidRepacks;

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

              {/* Notification Provider */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Notification Method</label>
                <select
                  name="notificationsProvider"
                  value={form.notificationsProvider}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="webpush">Web Push Notifications</option>
                  <option value="email">Email Notifications</option>
                  <option value="telegram">Telegram Bot</option>
                </select>
              </div>

              {/* Web Push Settings */}
              {form.notificationsProvider === 'webpush' && (
                <div className="space-y-3 p-4 border border-blue-200 dark:border-blue-700 bg-blue-50 dark:bg-blue-900/20 rounded-md">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      name="webpushEnabled"
                      checked={form.webpushEnabled}
                      onChange={(e) => setForm({ ...form, webpushEnabled: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Enable Web Push Notifications</label>
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                    <p><strong>Web Push Setup:</strong></p>
                    <p>• Notifications appear directly in your browser</p>
                    <p>• Works even when the site is closed (if browser is running)</p>
                    <p>• You&apos;ll be prompted to allow notifications when enabled</p>
                  </div>
                </div>
              )}

              {/* Email Settings */}
              {form.notificationsProvider === 'email' && (
                <div className="space-y-3 p-4 border border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/20 rounded-md">
                  <div className="text-sm text-gray-700 dark:text-gray-300">
                    <p><strong>Email Notifications</strong></p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      Notifications will be sent to your registered email: <span className="font-mono">{form.email}</span>
                    </p>
                  </div>
                </div>
              )}

              {/* Telegram Settings */}
              {form.notificationsProvider === 'telegram' && (
                <div className="space-y-3 p-4 border border-purple-200 dark:border-purple-700 bg-purple-50 dark:bg-purple-900/20 rounded-md">
                  <div className="flex items-center space-x-2">
                    <input
                      type="checkbox"
                      name="telegramEnabled"
                      checked={form.telegramEnabled}
                      onChange={(e) => setForm({ ...form, telegramEnabled: e.target.checked })}
                      className="w-4 h-4"
                    />
                    <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Enable Telegram Notifications</label>
                  </div>
                  {form.telegramEnabled && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                          Bot Token
                          <span className="text-gray-500 ml-1">(from @BotFather)</span>
                        </label>
                        <input
                          type="password"
                          name="telegramBotToken"
                          value={form.telegramBotToken}
                          onChange={handleChange}
                          placeholder="1234567890:ABCdefGHIjklMNOpqrsTUVwxyz"
                          className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                          Chat ID
                          <span className="text-gray-500 ml-1">(your user ID or group chat ID)</span>
                        </label>
                        <input
                          type="text"
                          name="telegramChatId"
                          value={form.telegramChatId}
                          onChange={handleChange}
                          placeholder="123456789 or -100123456789"
                          className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                        />
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
                    </>
                  )}
                </div>
              )}
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
                    Prioritize 0xdeadcode releases
                  </label>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    When multiple updates are found, prioritize 0xdeadcode releases (online fixes) over other groups
                  </p>
                </div>
              </div>
              
              <div className="flex items-start space-x-3">
                <input
                  type="checkbox"
                  name="prefer0xdeadcodeForOnlineFixes"
                  checked={form.prefer0xdeadcodeForOnlineFixes}
                  onChange={handleChange}
                  className="mt-1 h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
                />
                <div>
                  <label className="text-sm font-medium text-gray-900 dark:text-white">
                    Prefer 0xdeadcode for online fixes
                  </label>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                    Always consider 0xdeadcode releases as valid updates (they provide online fixes)
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
            
            {/* Test buttons based on selected provider */}
            {form.notificationsProvider === 'webpush' && form.webpushEnabled && (
              <button
                type="button"
                className="px-4 py-2 bg-green-600 text-white rounded-md"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/notifications/send-test', { method: 'POST' });
                    const data = await res.json();
                    if (!res.ok) {
                      showError('Test Failed', data?.error || 'Failed to send test notification');
                      return;
                    }
                    showSuccess('Test Sent', 'Test notification sent (check your device)');
                  } catch {
                    showError('Test Failed', 'Failed to send test notification');
                  }
                }}
              >
                Test Web Push
              </button>
            )}
            
            {form.notificationsProvider === 'telegram' && form.telegramEnabled && form.telegramBotToken && form.telegramChatId && (
              <button
                type="button"
                className="px-4 py-2 bg-purple-600 text-white rounded-md"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/notifications/test-telegram', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        botToken: form.telegramBotToken,
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
            
            {form.notificationsProvider === 'email' && (
              <button
                type="button"
                className="px-4 py-2 bg-orange-600 text-white rounded-md"
                onClick={async () => {
                  try {
                    const res = await fetch('/api/notifications/send-test', { method: 'POST' });
                    const data = await res.json();
                    if (!res.ok) {
                      showError('Test Failed', data?.error || 'Failed to send test email');
                      return;
                    }
                    showSuccess('Test Sent', 'Test email sent (check your inbox)');
                  } catch {
                    showError('Test Failed', 'Failed to send test email');
                  }
                }}
              >
                Test Email
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
