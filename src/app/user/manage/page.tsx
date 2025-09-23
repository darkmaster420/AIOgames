'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useNotification } from '../../../contexts/NotificationContext';
import { useConfirm } from '../../../components/ConfirmDialog';

export default function UserManagePage() {
  const { showSuccess, showError } = useNotification();
  const { confirm, ConfirmDialog } = useConfirm();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [form, setForm] = useState({
    email: '',
    currentPassword: '',
    newPassword: '',
    confirmNewPassword: '',
    // notification settings
    notificationsProvider: '',
    webpushEnabled: true,
    telegramEnabled: false,
    telegramBotToken: '',
    telegramChatId: ''
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
        setForm((f) => ({ ...f, email: data.email || '' }));
        // initialize notification settings from preferences if available
        if (data.preferences?.notifications) {
          setForm((f) => ({
            ...f,
            notificationsProvider: data.preferences.notifications.provider || f.notificationsProvider,
            webpushEnabled: typeof data.preferences.notifications.webpushEnabled === 'boolean' ? data.preferences.notifications.webpushEnabled : f.webpushEnabled,
            telegramEnabled: data.preferences.notifications.telegramEnabled || false,
            telegramBotToken: data.preferences.notifications.telegramBotToken || '',
            telegramChatId: data.preferences.notifications.telegramChatId || ''
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
        currentPassword?: string; 
        newPassword?: string; 
        provider?: string; 
        webpushEnabled?: boolean;
        telegramEnabled?: boolean;
        telegramBotToken?: string;
        telegramChatId?: string;
      } = { email: form.email };
      
      if (form.newPassword) {
        payload.currentPassword = form.currentPassword;
        payload.newPassword = form.newPassword;
      }
      
      // Notification settings
      payload.provider = form.notificationsProvider;
      payload.webpushEnabled = form.webpushEnabled;
      payload.telegramEnabled = form.telegramEnabled;
      payload.telegramBotToken = form.telegramBotToken;
      payload.telegramChatId = form.telegramChatId;

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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Email</label>
            <input
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              required
              className="mt-1 block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
            />
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
              {/* Notification Provider */}
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Provider</label>
                <select
                  name="notificationsProvider"
                  value={form.notificationsProvider}
                  onChange={handleChange}
                  className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                >
                  <option value="webpush">Web Push</option>
                  <option value="email">Email</option>
                  <option value="telegram">Telegram Bot</option>
                </select>
              </div>

              {/* Web Push Settings */}
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  name="webpushEnabled"
                  checked={form.webpushEnabled}
                  onChange={(e) => setForm({ ...form, webpushEnabled: e.target.checked })}
                  className="w-4 h-4"
                />
                <label className="text-sm text-gray-600 dark:text-gray-300">Enable Web Push Notifications</label>
              </div>

              {/* Telegram Bot Settings */}
              <div className="space-y-3 p-4 border border-gray-200 dark:border-gray-600 rounded-md">
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    name="telegramEnabled"
                    checked={form.telegramEnabled}
                    onChange={(e) => setForm({ ...form, telegramEnabled: e.target.checked })}
                    className="w-4 h-4"
                  />
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Enable Telegram Bot Notifications</label>
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
                        className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
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
                        className="block w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      />
                    </div>

                    <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1">
                      <p><strong>Setup Instructions:</strong></p>
                      <p>1. Create a bot with @BotFather on Telegram</p>
                      <p>2. Get your chat ID from @userinfobot</p>
                      <p>3. Start a chat with your bot first</p>
                      <p>4. Use the &ldquo;Test Telegram&rdquo; button below to verify</p>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="pt-4 border-t">
            <h2 className="text-lg font-medium text-gray-900 dark:text-white">Danger Zone</h2>
            <p className="text-sm text-gray-600 dark:text-gray-300">Delete your account — this will deactivate your account and tracked games.</p>
            <div className="mt-3">
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
                className="px-4 py-2 bg-red-600 text-white rounded-md"
              >
                Delete Account
              </button>
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
            {form.telegramEnabled && form.telegramBotToken && form.telegramChatId && (
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
            <button
              type="button"
              className="px-4 py-2 border rounded-md"
              onClick={() => router.push('/')}
            >
              Close
            </button>
          </div>
        </form>
      </div>
      <ConfirmDialog />
    </div>
  );
}
