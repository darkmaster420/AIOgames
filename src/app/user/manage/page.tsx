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
  const [appriseUrls, setAppriseUrls] = useState<string[]>([]);
  const [newAppriseUrl, setNewAppriseUrl] = useState('');
  const [testingUrl, setTestingUrl] = useState(false);

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
    telegramUsername: '',
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
            telegramUsername: data.preferences.notifications.telegramUsername || '',
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

  // Fetch Apprise URLs
  useEffect(() => {
    async function fetchAppriseUrls() {
      try {
        const res = await fetch('/api/notifications/apprise');
        if (res.ok) {
          const data = await res.json();
          setAppriseUrls(data.urls || []);
        }
      } catch (error) {
        console.error('Failed to fetch Apprise URLs:', error);
      }
    }
    fetchAppriseUrls();
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

  // Helper function to parse service from Apprise URL
  const getServiceFromUrl = (url: string): string => {
    try {
      const match = url.match(/^([a-z]+):\/\//);
      return match ? match[1] : 'unknown';
    } catch {
      return 'unknown';
    }
  };

  // Helper function to get service badge color
  const getServiceBadgeColor = (service: string): string => {
    const colors: Record<string, string> = {
      telegram: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      discord: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200',
      slack: 'bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200',
      gotify: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      ntfy: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
      pushover: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900 dark:text-cyan-200',
      mailto: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      email: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
    };
    return colors[service] || 'bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200';
  };

  // Add Apprise URL
  const handleAddAppriseUrl = async () => {
    if (!newAppriseUrl.trim()) {
      showError('Invalid URL', 'Please enter a valid Apprise URL');
      return;
    }

    try {
      const res = await fetch('/api/notifications/apprise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newAppriseUrl.trim(), action: 'add' })
      });

      const data = await res.json();
      if (!res.ok) {
        showError('Failed to Add URL', data?.error || 'Failed to add Apprise URL');
        return;
      }

      setAppriseUrls(data.urls || []);
      setNewAppriseUrl('');
      showSuccess('URL Added', 'Apprise URL added successfully');
    } catch (err) {
      showError('Failed to Add URL', err instanceof Error ? err.message : 'Failed to add Apprise URL');
    }
  };

  // Test Apprise URL
  const handleTestAppriseUrl = async (url: string) => {
    setTestingUrl(true);
    try {
      const res = await fetch('/api/notifications/apprise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, action: 'test' })
      });

      const data = await res.json();
      if (!res.ok) {
        showError('Test Failed', data?.error || 'Failed to send test notification');
        return;
      }

      showSuccess('Test Sent', `Test notification sent to ${getServiceFromUrl(url)}`);
    } catch (err) {
      showError('Test Failed', err instanceof Error ? err.message : 'Failed to send test notification');
    } finally {
      setTestingUrl(false);
    }
  };

  // Remove Apprise URL
  const handleRemoveAppriseUrl = async (url: string) => {
    const confirmed = await confirm('Remove URL', `Are you sure you want to remove this notification URL?`);
    if (!confirmed) return;

    try {
      const res = await fetch('/api/notifications/apprise', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      const data = await res.json();
      if (!res.ok) {
        showError('Failed to Remove URL', data?.error || 'Failed to remove Apprise URL');
        return;
      }

      setAppriseUrls(data.urls || []);
      showSuccess('URL Removed', 'Apprise URL removed successfully');
    } catch (err) {
      showError('Failed to Remove URL', err instanceof Error ? err.message : 'Failed to remove Apprise URL');
    }
  };


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
        webpushEnabled?: boolean;
        notifyImmediately?: boolean;
        telegramEnabled?: boolean;
        telegramUsername?: string;
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
      payload.telegramUsername = form.telegramUsername;
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

              {/* Apprise URLs Configuration */}
              <div className="space-y-3 p-4 border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 rounded-md">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">🔔 Notification Services (Apprise URLs)</h3>
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                      Configure multiple notification services using Apprise-style URLs
                    </p>
                  </div>
                </div>

                {/* Add URL Input */}
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newAppriseUrl}
                      onChange={(e) => setNewAppriseUrl(e.target.value)}
                      placeholder="telegram://bot_token/chat_id"
                      className="flex-1 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddAppriseUrl();
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={handleAddAppriseUrl}
                      className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-md text-sm font-medium"
                    >
                      Add
                    </button>
                  </div>

                  {/* Help Text with Examples */}
                  <details className="text-xs">
                    <summary className="cursor-pointer text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white font-medium">
                      📖 Supported Services & URL Formats
                    </summary>
                    <div className="mt-2 space-y-2 pl-4 border-l-2 border-indigo-300 dark:border-indigo-600">
                      <div>
                        <span className="font-mono text-indigo-600 dark:text-indigo-400">telegram://</span>
                        <span className="text-gray-700 dark:text-gray-300">bot_token/chat_id</span>
                        <p className="text-gray-500 dark:text-gray-400 ml-4">Telegram Bot notifications</p>
                      </div>
                      <div>
                        <span className="font-mono text-purple-600 dark:text-purple-400">discord://</span>
                        <span className="text-gray-700 dark:text-gray-300">webhook_id/webhook_token</span>
                        <p className="text-gray-500 dark:text-gray-400 ml-4">Discord Webhook notifications</p>
                      </div>
                      <div>
                        <span className="font-mono text-pink-600 dark:text-pink-400">slack://</span>
                        <span className="text-gray-700 dark:text-gray-300">token/channel</span>
                        <p className="text-gray-500 dark:text-gray-400 ml-4">Slack notifications</p>
                      </div>
                      <div>
                        <span className="font-mono text-green-600 dark:text-green-400">gotify://</span>
                        <span className="text-gray-700 dark:text-gray-300">host/token</span>
                        <p className="text-gray-500 dark:text-gray-400 ml-4">Gotify self-hosted notifications</p>
                      </div>
                      <div>
                        <span className="font-mono text-orange-600 dark:text-orange-400">ntfy://</span>
                        <span className="text-gray-700 dark:text-gray-300">host/topic</span>
                        <p className="text-gray-500 dark:text-gray-400 ml-4">Ntfy notifications</p>
                      </div>
                      <div>
                        <span className="font-mono text-cyan-600 dark:text-cyan-400">pushover://</span>
                        <span className="text-gray-700 dark:text-gray-300">user_key@token</span>
                        <p className="text-gray-500 dark:text-gray-400 ml-4">Pushover notifications</p>
                      </div>
                      <div>
                        <span className="font-mono text-red-600 dark:text-red-400">mailto://</span>
                        <span className="text-gray-700 dark:text-gray-300">your_email@domain.com</span>
                        <p className="text-gray-500 dark:text-gray-400 ml-4">Email notifications (requires SMTP configuration)</p>
                      </div>
                    </div>
                  </details>
                </div>

                {/* Configured URLs List */}
                {appriseUrls.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Configured Services:</p>
                    <div className="space-y-2">
                      {appriseUrls.map((url, idx) => {
                        const service = getServiceFromUrl(url);
                        const badgeColor = getServiceBadgeColor(service);
                        // Mask sensitive parts of the URL
                        const maskedUrl = url.length > 40 ? `${url.substring(0, 40)}...` : url;
                        
                        return (
                          <div key={idx} className="flex items-center gap-2 p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700">
                            <span className={`px-2 py-1 rounded text-xs font-semibold uppercase ${badgeColor}`}>
                              {service}
                            </span>
                            <span className="flex-1 text-xs font-mono text-gray-600 dark:text-gray-400 truncate">
                              {maskedUrl}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleTestAppriseUrl(url)}
                              disabled={testingUrl}
                              className="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded text-xs font-medium disabled:opacity-50"
                            >
                              Test
                            </button>
                            <button
                              type="button"
                              onClick={() => handleRemoveAppriseUrl(url)}
                              className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs font-medium"
                            >
                              Remove
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-500 dark:text-gray-400 italic">
                    No notification services configured yet. Add a URL above to get started.
                  </div>
                )}
              </div>

              {/* Legacy: Notification Provider (can be deprecated later) */}
              <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 italic">
                  ⚠️ Legacy notification methods (being phased out in favor of Apprise URLs above):
                </p>
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
                      <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-700">
                        <p className="text-xs text-blue-700 dark:text-blue-300 mb-2">
                          <strong>📱 Shared Telegram Bot</strong>
                        </p>
                        <p className="text-xs text-gray-600 dark:text-gray-400">
                          This application uses a shared Telegram bot{botInfo && (
                            <>
                              {' '}(<a 
                                href={botInfo.botLink} 
                                target="_blank" 
                                rel="noopener noreferrer"
                                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                              >
                                @{botInfo.username}
                              </a>)
                            </>
                          )}. Simply start the bot and provide your username or chat ID below to receive notifications!
                        </p>
                      </div>
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
                    </>
                  )}
                </div>
              )}
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
            
            {/* Test Notifications (Apprise) */}
            {appriseUrls.length > 0 && (
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
                    showSuccess('Test Sent', data.message || 'Test notification sent to all configured services');
                  } catch {
                    showError('Test Failed', 'Failed to send test notification');
                  }
                }}
              >
                🔔 Test All Notifications
              </button>
            )}
            
            {/* Legacy test buttons (deprecated) */}
            {form.notificationsProvider === 'telegram' && form.telegramEnabled && form.telegramChatId && (
              <button
                type="button"
                className="px-4 py-2 bg-purple-600 text-white rounded-md opacity-60"
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
                title="Legacy method - prefer using Apprise URLs above"
              >
                Test Legacy Telegram
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
