// Service Worker for Push Notifications
console.log('[Service Worker] Loading...');

self.addEventListener('push', function(event) {
  console.log('[Service Worker] Push event received');
  
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
      console.log('[Service Worker] Push data:', data);
    } catch (e) {
      console.error('[Service Worker] Error parsing push data:', e);
      data = { title: 'AIOgames', body: event.data.text() };
    }
  }
  
  const title = data.title || 'AIOgames';
  const options = {
    body: data.body || 'New update available',
    icon: data.icon || '/icon-192x192.png',
    badge: data.badge || '/icon-192x192.png',
    image: data.image,
    data: data.data || data,
    actions: data.actions || [],
    tag: data.tag || 'default',
    requireInteraction: false
  };
  
  console.log('[Service Worker] Showing notification:', title, options);
  
  event.waitUntil(
    self.registration.showNotification(title, options)
      .then(() => console.log('[Service Worker] Notification shown successfully'))
      .catch(err => console.error('[Service Worker] Error showing notification:', err))
  );
});

self.addEventListener('notificationclick', function(event) {
  console.log('[Service Worker] Notification clicked');
  event.notification.close();
  
  const urlToOpen = event.notification.data?.url || '/tracking';
  
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // Check if there's already a window open
        for (let client of windowClients) {
          if (client.url.includes(urlToOpen) && 'focus' in client) {
            return client.focus();
          }
        }
        // If no window is open, open a new one
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

self.addEventListener('install', function(event) {
  console.log('[Service Worker] Installing...');
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  console.log('[Service Worker] Activating...');
  event.waitUntil(clients.claim());
});

