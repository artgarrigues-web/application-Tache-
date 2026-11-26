/* Heure de Paris côté serveur.

   Dans le navigateur, new Date() donne l'heure locale de l'utilisateur. Mais le serveur
   Vercel tourne en heure UTC : 14:00 « à Paris » y vaut 13:00 l'hiver et 12:00 l'été.
   Ces deux fonctions font la conversion sans bibliothèque, avec Intl (intégré à Node
   et aux navigateurs), qui connaît les changements d'heure.

   Ce fichier n'importe rien : il peut être testé directement par Node.            */

export const FUSEAU_PARIS = "Europe/Paris";

const formateurs = new Map<string, Intl.DateTimeFormat>();
function formateur(fuseau: string): Intl.DateTimeFormat {
  let f = formateurs.get(fuseau);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: fuseau, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formateurs.set(fuseau, f);
  }
  return f;
}

// Vrai si le nom est un fuseau connu (« Europe/Paris », « America/New_York »…).
export function fuseauValide(fuseau: string): boolean {
  try { formateur(fuseau); return true; } catch { return false; }
}

/* Date et heure « au mur » dans un fuseau, pour un instant donné.
   Ex. : 2026-07-01T12:00Z à Paris → { date: "2026-07-01", heure: "14:00", minutes: 840 }. */
export function heureMurale(instant: number, fuseau = FUSEAU_PARIS): { date: string; heure: string; minutes: number } {
  const p = Object.fromEntries(formateur(fuseau).formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  const minutes = Number(p.hour) * 60 + Number(p.minute);
  return { date: `${p.year}-${p.month}-${p.day}`, heure: `${p.hour}:${p.minute}`, minutes };
}

// Écart (en ms) entre l'heure murale du fuseau et l'heure UTC, à un instant donné.
function decalage(instant: number, fuseau: string): number {
  const p = Object.fromEntries(formateur(fuseau).formatToParts(new Date(instant)).map((x) => [x.type, x.value]));
  const commeUTC = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return commeUTC - Math.floor(instant / 1000) * 1000;
}

/* L'instant (ms depuis 1970) qui correspond à « date à heure » dans un fuseau.
   Ex. : ("2026-11-26", "14:00") à Paris → 13:00 UTC.
   On devine avec le décalage du moment, puis on corrige une fois : cela suffit,
   y compris les nuits de changement d'heure. */
export function instantMural(date: string, heure: string, fuseau = FUSEAU_PARIS): number {
  const [a, m, j] = date.split("-").map(Number);
  const [h, mi] = (heure || "00:00").split(":").map(Number);
  const commeUTC = Date.UTC(a, m - 1, j, h, mi);
  let instant = commeUTC - decalage(commeUTC, fuseau);
  instant = commeUTC - decalage(instant, fuseau);
  return instant;
}

// "2026-11-26" + n jours (calcul en UTC pur : pas de piège d'heure d'été).
export function decalerDate(iso: string, n: number): string {
  const [a, m, j] = iso.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, j + n)).toISOString().slice(0, 10);
}
