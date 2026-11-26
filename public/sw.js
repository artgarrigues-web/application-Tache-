/* Service worker d'AgendIA : petit programme que le navigateur garde en arrière-plan,
   même quand l'application est fermée. Il ne sert qu'aux NOTIFICATIONS :
   - « push » : le serveur envoie un rappel → on affiche la notification
     (et le nombre de tâches du jour en pastille sur l'icône, si le système le permet) ;
   - « notificationclick » : on ouvre AgendIA sur le bon jour (ou « Ma journée »).
   Il ne met rien en cache : l'application fonctionne exactement comme avant. */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { corps: e.data ? e.data.text() : "" }; }
  const titre = d.titre || "AgendIA";
  const taches = [
    self.registration.showNotification(titre, {
      body: d.corps || "",
      tag: d.tag || undefined,
      renotify: Boolean(d.tag),
      icon: "/icone-192.png",
      badge: "/badge-96.png",
      data: { url: d.url || "/" },
      lang: "fr",
    }),
  ];
  if (typeof d.badge === "number" && self.navigator && "setAppBadge" in self.navigator) {
    taches.push(d.badge > 0 ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge());
  }
  e.waitUntil(Promise.all(taches).catch(() => undefined));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const cible = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const f of fenetres) {
      if (new URL(f.url).origin === self.location.origin) {
        await f.focus();
        f.postMessage({ type: "agendia-ouvrir", url: cible });
        return;
      }
    }
    await self.clients.openWindow(cible);
  })());
});
