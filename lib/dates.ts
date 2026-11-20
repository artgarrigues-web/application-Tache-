/* Outils pour les dates : fonctions "pures" (même entrée → même sortie,
   aucun effet de bord), donc faciles à comprendre et à tester.
   Les dates sont stockées en texte "AAAA-MM-JJ" : l'ordre alphabétique est
   alors l'ordre chronologique. Les objets Date sont toujours construits avec
   (année, mois, jour) en heure LOCALE pour éviter les décalages UTC.        */

import type { Vue } from "./types";

export function aujourdhui(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function versISO(date: Date): string {
  const a = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0"); // les mois vont de 0 à 11
  const j = String(date.getDate()).padStart(2, "0");
  return `${a}-${m}-${j}`;
}

export function depuisISO(texte: string): Date {
  const [a, m, j] = texte.split("-").map(Number);
  return new Date(a, m - 1, j);
}

export function ajouterJours(date: Date, n: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

// Semaine commençant le lundi : getDay() vaut 0 le dimanche, d'où le (x + 6) % 7.
export function debutSemaine(date: Date): Date {
  return ajouterJours(date, -((date.getDay() + 6) % 7));
}

export function formater(date: Date, options: Intl.DateTimeFormatOptions): string {
  return date.toLocaleDateString("fr-FR", options);
}

export function majuscule(texte: string): string {
  return texte.charAt(0).toUpperCase() + texte.slice(1);
}

export interface Plage { debut: string; fin: string }

// Intervalle de dates affiché par une vue (null pour la vue Liste = tout).
export function plageVisible(vue: Vue, d: Date): Plage | null {
  switch (vue) {
    case "jour":
      return { debut: versISO(d), fin: versISO(d) };
    case "semaine": {
      const lundi = debutSemaine(d);
      return { debut: versISO(lundi), fin: versISO(ajouterJours(lundi, 6)) };
    }
    case "mois":
      return {
        debut: versISO(new Date(d.getFullYear(), d.getMonth(), 1)),
        fin: versISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)), // jour 0 du mois suivant = dernier jour
      };
    default:
      return null;
  }
}

export function titrePeriode(vue: Vue, d: Date): string {
  if (vue === "jour") return majuscule(formater(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" }));
  if (vue === "semaine") {
    const lundi = debutSemaine(d);
    const dimanche = ajouterJours(lundi, 6);
    return `Semaine du ${formater(lundi, { day: "numeric", month: "long" })} au ${formater(dimanche, { day: "numeric", month: "long", year: "numeric" })}`;
  }
  if (vue === "mois") return majuscule(formater(d, { month: "long", year: "numeric" }));
  if (vue === "tri") return "Tâches à faire : Urgent · Important · Rapide";
  return "Toutes les tâches";
}

// Date de référence après un clic sur ‹ (sens = -1) ou › (sens = +1).
export function deplacer(vue: Vue, d: Date, sens: number): Date {
  if (vue === "jour") return ajouterJours(d, sens);
  if (vue === "semaine") return ajouterJours(d, 7 * sens);
  if (vue === "mois") return new Date(d.getFullYear(), d.getMonth() + sens, 1);
  return d;
}
