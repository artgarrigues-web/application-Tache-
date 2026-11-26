"use client";

/* Notifications côté NAVIGATEUR : activer / désactiver les rappels sur CET appareil.

   Étapes de l'activation (norme « web push », gratuite, sans compte Apple ni Google) :
   1. le service worker (public/sw.js) est installé : c'est lui qui affichera les rappels ;
   2. le navigateur demande l'autorisation à l'utilisateur (une seule fois) ;
   3. il fournit un « abonnement » (adresse d'envoi + clés), qu'on range en base
      (table abonnements_push) pour que le serveur puisse y envoyer les rappels.

   Sur iPhone/iPad : il faut iOS 16.4 ou plus ET avoir ajouté AgendIA à l'écran
   d'accueil (Safari → Partager → « Sur l'écran d'accueil »), puis l'ouvrir depuis
   son icône. Dans Safari lui-même, Apple ne propose pas les notifications web.     */

import * as depot from "./depot";
import { VAPID_CLE_PUBLIQUE } from "./notifications-cle";

export type EtatNotifications =
  | "indisponible"     // navigateur trop ancien
  | "ios-ecran"        // iPhone/iPad : ajouter d'abord à l'écran d'accueil
  | "bloquees"         // l'utilisateur a refusé : à réautoriser dans les réglages
  | "inactives"        // possible, pas encore activé sur cet appareil
  | "actives";

export function estIOS(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
export function estInstallee(): boolean {
  return matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}
function prise(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function enregistrerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    return null;
  }
}

export async function etatNotifications(): Promise<EtatNotifications> {
  if (!prise()) return estIOS() && !estInstallee() ? "ios-ecran" : "indisponible";
  if (Notification.permission === "denied") return "bloquees";
  const reg = await navigator.serviceWorker.getRegistration("/");
  const abonnement = await reg?.pushManager.getSubscription();
  return abonnement && Notification.permission === "granted" ? "actives" : "inactives";
}

// La clé publique est en « base64 url » ; le navigateur la veut en octets.
function versOctets(base64: string): Uint8Array<ArrayBuffer> {
  const rembourre = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const brut = atob(rembourre);
  const octets = new Uint8Array(new ArrayBuffer(brut.length));
  for (let i = 0; i < brut.length; i++) octets[i] = brut.charCodeAt(i);
  return octets;
}

function nomAppareil(): string {
  const ua = navigator.userAgent;
  const systeme = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Appareil";
  const nav = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return nav ? `${systeme} · ${nav}` : systeme;
}

export async function activerNotifications(): Promise<EtatNotifications> {
  if (!prise()) return etatNotifications();
  const reg = (await enregistrerServiceWorker()) ?? (await navigator.serviceWorker.ready);
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "bloquees" : "inactives";
  await navigator.serviceWorker.ready;
  const abonnement = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: versOctets(VAPID_CLE_PUBLIQUE) }));
  const json = abonnement.toJSON();
  await depot.enregistrerAbonnement({
    endpoint: abonnement.endpoint, p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "", appareil: nomAppareil(),
  });
  return "actives";
}

export async function desactiverNotifications(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const abonnement = await reg?.pushManager.getSubscription();
  if (!abonnement) return;
  await depot.retirerAbonnement(abonnement.endpoint).catch(() => undefined);
  await abonnement.unsubscribe();
}

// Pastille sur l'icône de l'application installée (nombre de tâches du jour).
export function mettrePastille(n: number) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    if (n > 0) nav.setAppBadge?.(n)?.catch(() => undefined);
    else nav.clearAppBadge?.()?.catch(() => undefined);
  } catch { /* non pris en charge : rien à faire */ }
}
