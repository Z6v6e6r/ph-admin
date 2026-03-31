self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function (event) {
  var payload = {};
  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_error) {
      payload = {
        body: event.data.text()
      };
    }
  }

  var title = String(payload.title || 'Новое сообщение поддержки');
  var body = String(payload.body || 'Откройте чат, чтобы прочитать сообщение.');
  var threadId = String(payload.threadId || '').trim();
  var tag = String(payload.tag || (threadId ? 'phab-chat-' + threadId : 'phab-chat'));
  var url = String(payload.url || '/').trim() || '/';

  var notificationOptions = {
    body: body,
    tag: tag,
    renotify: false,
    data: {
      url: url,
      threadId: threadId
    }
  };

  event.waitUntil(self.registration.showNotification(title, notificationOptions));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var targetUrl =
    event.notification &&
    event.notification.data &&
    typeof event.notification.data.url === 'string'
      ? event.notification.data.url
      : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clients) {
      for (var i = 0; i < clients.length; i += 1) {
        var client = clients[i];
        if (!client || !client.url) {
          continue;
        }
        try {
          var clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin) {
            if (typeof client.navigate === 'function') {
              return client.navigate(targetUrl).then(function () {
                return client.focus();
              });
            }
            return client.focus();
          }
        } catch (_error) {}
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
