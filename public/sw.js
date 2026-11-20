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
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const client = windows.find((w) => "focus" in w);
      if (!client) return self.clients.openWindow(url);
      // An open window: bring it to the front and send it to the page. Browsers differ in what works (iPhone web apps
      // can ignore WindowClient.navigate), so the page is also told by message (components/push/push-navigation.tsx)
      // and, if navigating fails outright, the page is opened as a new window, which a web app loads in place.
      try {
        await client.focus();
      } catch {
        /* focusing can be refused: carry on */
      }
      try {
        client.postMessage({ type: "202:navigate", url });
      } catch {
        /* the page may be gone */
      }
      let navigated = false;
      try {
        navigated = Boolean(await client.navigate(url));
      } catch {
        navigated = false;
      }
      if (!navigated) return self.clients.openWindow(url);
      return undefined;
    }),
  );
});
