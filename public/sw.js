// Service worker de OCTO: muestra los avisos de precio de "Mis gasolineras"
// (notificaciones push que envía api/src/alerts/send.ts) y, al tocarlos, abre la
// página. No intercepta peticiones: la web funciona igual que sin él.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = { body: event.data ? event.data.text() : "" };
    }
    event.waitUntil(
        self.registration.showNotification(data.title || "OCTO", {
            body: data.body || "",
            icon: "/icons/octo-192.png",
            tag: data.tag || "octo",
            renotify: true,
            lang: "es",
            data: { url: data.url || "/mis-gasolineras/" },
        })
    );
});

self.addEventListener("notificationclick", (event) => {
    event.notification.close();
    const url = new URL(event.notification.data?.url || "/mis-gasolineras/", self.location.origin).href;
    event.waitUntil(
        (async () => {
            const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
            const open = windows.find((w) => w.url === url);
            if (open) return open.focus();
            return self.clients.openWindow(url);
        })()
    );
});
