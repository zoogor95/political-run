/* global self */
/* Majority Map's service worker: shows "your move" notifications pushed by the game's server, and opens the match when
   one is tapped. Nothing else: the game itself isn't cached here. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Majority Map";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      // The game is on screen: it tells the player itself, so no notification on top of it.
      if (windows.some((w) => w.visibilityState === "visible" && w.focused)) return undefined;
      return self.registration.showNotification(title, {
        body: data.body || "",
        tag: data.tag || "majority-map",
        renotify: true,
        data: { url: data.url || self.registration.scope },
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || self.registration.scope;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.startsWith(self.registration.scope));
      if (open) return open.navigate(url).then((w) => (w || open).focus());
      return self.clients.openWindow(url);
    }),
  );
});
