// 202 service worker: it only shows Web Push messages and opens the right page when one is tapped. It caches
// nothing and handles no fetches. Registered from the notification settings (components/push/push-settings.tsx).

/** An internal path only: a message may never send the person to another site. */
function safePath(path) {
  if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/start";
  return path.slice(0, 300);
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 120) : "202";
  const body = typeof data.body === "string" ? data.body.slice(0, 300) : "";
  const url = safePath(data.url);
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      tag: url, // a second message about the same page replaces the first
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if ("navigate" in client && "focus" in client) {
          return client.navigate(url).then((c) => (c || client).focus());
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
