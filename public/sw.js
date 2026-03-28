// Service Worker: プッシュ通知の受信と表示

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Bath.exe';
  const options = {
    body: data.body || 'お風呂の時間だよ！',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: data.vibrate || [200],
    data: { url: '/' },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// 通知タップでアプリを開く
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/') && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/');
    })
  );
});
