/* Service worker d'AgendIA : petit programme que le navigateur garde en arrière-plan,
   même quand l'application est fermée. Il a deux rôles :

   1. NOTIFICATIONS (depuis le 26/11/2026) :
      - « push » : le serveur envoie un rappel → on affiche la notification
        (et le nombre de tâches du jour en pastille sur l'icône, si le système le permet) ;
      - « notificationclick » : on ouvre AgendIA sur le bon jour (ou « Ma journée »).

   2. HORS CONNEXION : il garde une copie de l'APPLICATION elle-même (la page, le code
      JavaScript, le style, les icônes) pour qu'elle s'ouvre sans réseau, dans le métro
      ou en amphi. Les TÂCHES, elles, sont gardées par l'application (lib/hors-ligne.ts) :
      ce fichier ne touche jamais aux données ni aux requêtes vers Supabase ou /api/.

   Stratégies de cache (une par type de fichier) :
   - la page : « réseau d'abord » — on essaie le réseau (version la plus récente) ; s'il ne
     répond pas en 4 secondes ou pas du tout, on sert la copie ;
   - /_next/static/… : ces fichiers ont un nom qui change à chaque version (empreinte) ;
     leur contenu ne change donc jamais → « cache d'abord », sans réseau ;
   - icônes, manifeste : copie tout de suite, mise à jour en arrière-plan.               */

const CACHE_PAGE = "agendia-page-v1";
const CACHE_STATIQUE = "agendia-statique-v1";
const DELAI_PAGE_MS = 4000;
const GARDER_JOURS = 14; // anciens fichiers d'une version précédente : gardés 14 jours

self.addEventListener("install", (e) => {
  // On met tout de suite la page en cache, pour qu'un premier passage suffise.
  e.waitUntil(caches.open(CACHE_PAGE).then((c) => c.add("/")).catch(() => undefined).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const gardes = [CACHE_PAGE, CACHE_STATIQUE];
    for (const nom of await caches.keys()) if (nom.startsWith("agendia-") && !gardes.includes(nom)) await caches.delete(nom);
    await self.clients.claim();
  })());
});

// Copie d'une réponse avec la date de mise en cache (pour le ménage des vieux fichiers).
async function ranger(cache, cle, reponse) {
  if (!reponse || !reponse.ok || reponse.type === "opaque") return;
  const entetes = new Headers(reponse.headers);
  entetes.set("x-agendia-le", String(Date.now()));
  const corps = await reponse.clone().blob();
  await cache.put(cle, new Response(corps, { status: reponse.status, statusText: reponse.statusText, headers: entetes }));
}

async function page(requete) {
  const cache = await caches.open(CACHE_PAGE);
  const reseau = fetch(requete).then(async (r) => { await ranger(cache, "/", r.clone()); return r; });
  reseau.catch(() => undefined); // évite une erreur « non traitée » si le réseau échoue après coup
  const copie = await cache.match("/");
  if (!copie) return reseau; // jamais ouverte ici : on attend le réseau
  // Course entre le réseau et un minuteur : le premier qui répond gagne.
  const minuteur = new Promise((ok) => setTimeout(() => ok(null), DELAI_PAGE_MS));
  try {
    const r = await Promise.race([reseau, minuteur]);
    return r || copie;
  } catch {
    return copie; // pas de réseau du tout
  }
}

async function statique(requete) {
  const cache = await caches.open(CACHE_STATIQUE);
  const copie = await cache.match(requete);
  if (copie) return copie;
  const r = await fetch(requete);
  await ranger(cache, requete, r.clone());
  return r;
}

async function annexe(requete) {
  const cache = await caches.open(CACHE_STATIQUE);
  const copie = await cache.match(requete);
  const reseau = fetch(requete).then(async (r) => { await ranger(cache, requete, r.clone()); return r; });
  if (copie) { reseau.catch(() => undefined); return copie; }
  return reseau;
}

self.addEventListener("fetch", (e) => {
  const requete = e.request;
  if (requete.method !== "GET") return;
  const url = new URL(requete.url);
  if (url.origin !== self.location.origin) return;    // Supabase, polices… : pas notre affaire
  if (url.pathname.startsWith("/api/")) return;       // données : gérées par l'application
  if (url.searchParams.has("_rsc")) return;            // échanges internes de Next.js
  if (requete.mode === "navigate") { e.respondWith(page(requete)); return; }
  if (url.pathname.startsWith("/_next/static/")) { e.respondWith(statique(requete)); return; }
  if (/\.(png|svg|ico|webmanifest|json|woff2?)$/.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
    e.respondWith(annexe(requete));
  }
});

/* La page nous envoie la liste des fichiers qu'elle a chargés AVANT que ce service worker
   ne la contrôle (première visite) : on les met en cache, et on fait le ménage des fichiers
   d'anciennes versions qui ne servent plus depuis 14 jours. */
self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type !== "agendia-mettre-en-cache" || !Array.isArray(d.urls)) return;
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIQUE);
    const actuels = new Set();
    for (const brut of d.urls) {
      let url;
      try { url = new URL(brut, self.location.origin); } catch { continue; }
      if (url.origin !== self.location.origin || !url.pathname.startsWith("/_next/static/")) continue;
      actuels.add(url.href);
      if (!(await cache.match(url.href))) {
        try { await ranger(cache, url.href, await fetch(url.href)); } catch { /* hors ligne : tant pis */ }
      }
    }
    const limite = Date.now() - GARDER_JOURS * 86400000;
    for (const requete of await cache.keys()) {
      if (!new URL(requete.url).pathname.startsWith("/_next/static/") || actuels.has(requete.url)) continue;
      const r = await cache.match(requete);
      if (Number(r && r.headers.get("x-agendia-le")) < limite) await cache.delete(requete);
    }
  })());
});

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
