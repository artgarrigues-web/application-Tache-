/* Tests de la répétition des tâches (lib/recurrence.ts) et de son export iCalendar.
   Lancer : npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ajouterException, analyserId, arreterAvant, basculerFaite, decrireRecurrence, developper, entreesCourantes,
  idOccurrence, nombreAvant, normaliserRecurrence, occurrencesEntre, premiereOccurrence, recurrenceParDefaut,
  validerRecurrence,
} from "../lib/recurrence.ts";
import { regleRRULE } from "../lib/ics-recurrence.ts";
import type { Recurrence, Tache } from "../lib/types.ts";

const regle = (champs: Partial<Recurrence>): Recurrence => ({ ...recurrenceParDefaut("2026-11-24"), ...champs });

function tache(champs: Partial<Tache>): Tache {
  return {
    id: "s1", titre: "Sport", description: "", date: "2026-11-24", heure: "", dureeMinutes: null,
    lieu: "", echeance: "", materiel: "", categorie: "perso", priorite: "moyenne", groupe: null, couleur: null,
    recurrence: null, faite: false, creeLe: "2026-11-01T00:00:00Z", ...champs,
  };
}

test("tous les jours et tous les 3 jours", () => {
  assert.deepEqual(occurrencesEntre("2026-11-24", regle({ frequence: "jour" }), "2026-11-23", "2026-11-27"),
    ["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]);
  assert.deepEqual(occurrencesEntre("2026-11-24", regle({ frequence: "jour", intervalle: 3 }), "2026-11-24", "2026-12-03"),
    ["2026-11-24", "2026-11-27", "2026-11-30", "2026-12-03"]);
});

test("semaine : plusieurs jours, toutes les 2 semaines, saut en avant", () => {
  // 24/11/2026 = mardi. Mardi et jeudi, toutes les 2 semaines.
  const r = regle({ frequence: "semaine", intervalle: 2, joursSemaine: [1, 3] });
  assert.deepEqual(occurrencesEntre("2026-11-24", r, "2026-11-23", "2026-12-13"),
    ["2026-11-24", "2026-11-26", "2026-12-08", "2026-12-10"]);
  // Loin dans le futur (le calcul saute directement à la bonne période).
  assert.deepEqual(occurrencesEntre("2026-11-24", r, "2027-11-22", "2027-11-28"), ["2027-11-23", "2027-11-25"]);
});

test("le lundi d'une semaine qui commence un mardi n'est pas compté", () => {
  const r = regle({ frequence: "semaine", joursSemaine: [0, 1] });
  assert.deepEqual(occurrencesEntre("2026-11-24", r, "2026-11-23", "2026-12-01"), ["2026-11-24", "2026-11-30", "2026-12-01"]);
});

test("premiereOccurrence cale le début sur les jours choisis", () => {
  assert.equal(premiereOccurrence("2026-11-24", regle({ frequence: "semaine", joursSemaine: [0, 3] })), "2026-11-26");
  assert.equal(premiereOccurrence("2026-11-24", regle({ frequence: "mois" })), "2026-11-24");
});

test("mois : le 31 tombe le dernier jour des mois courts", () => {
  const r = regle({ frequence: "mois" });
  assert.deepEqual(occurrencesEntre("2027-01-31", r, "2027-01-01", "2027-05-31"),
    ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
  // 2028 est bissextile : 29 février.
  assert.deepEqual(occurrencesEntre("2028-01-30", r, "2028-02-01", "2028-02-29"), ["2028-02-29"]);
});

test("mois : 4e mardi et dernier mardi", () => {
  // 24/11/2026 = 4e et dernier mardi de novembre.
  assert.deepEqual(occurrencesEntre("2026-11-24", regle({ frequence: "mois", modeMois: "rang" }), "2026-11-01", "2027-01-31"),
    ["2026-11-24", "2026-12-22", "2027-01-26"]);
  assert.deepEqual(occurrencesEntre("2026-11-24", regle({ frequence: "mois", modeMois: "dernier" }), "2026-11-01", "2027-01-31"),
    ["2026-11-24", "2026-12-29", "2027-01-26"]);
});

test("un 5e jeudi devient « dernier jeudi » à l'enregistrement", () => {
  // 29/10/2026 = 5e jeudi.
  const r = normaliserRecurrence(regle({ frequence: "mois", modeMois: "rang" }), "2026-10-29");
  assert.equal(r.modeMois, "dernier");
});

test("an : 29 février → 28 février les années non bissextiles", () => {
  assert.deepEqual(occurrencesEntre("2028-02-29", regle({ frequence: "annee" }), "2028-01-01", "2032-12-31"),
    ["2028-02-29", "2029-02-28", "2030-02-28", "2031-02-28", "2032-02-29"]);
});

test("fin à une date, fin après N fois (exceptions comprises)", () => {
  const parDate = regle({ frequence: "jour", fin: { type: "date", date: "2026-11-26" } });
  assert.deepEqual(occurrencesEntre("2026-11-24", parDate, "2026-11-01", "2026-12-31"), ["2026-11-24", "2026-11-25", "2026-11-26"]);
  const troisFois = regle({ frequence: "semaine", joursSemaine: [1], fin: { type: "nombre", nombre: 3 }, exceptions: ["2026-12-01"] });
  assert.deepEqual(occurrencesEntre("2026-11-24", troisFois, "2026-11-01", "2027-01-31"), ["2026-11-24", "2026-12-08"]);
  assert.equal(nombreAvant("2026-11-24", troisFois, "2026-12-08"), 2);
});

test("cocher, supprimer une occurrence, arrêter la série", () => {
  let r = regle({ frequence: "jour" });
  r = basculerFaite(r, "2026-11-25");
  assert.deepEqual(r.faites, ["2026-11-25"]);
  r = ajouterException(r, "2026-11-25");
  assert.deepEqual([r.faites, r.exceptions], [[], ["2026-11-25"]]);
  assert.deepEqual(occurrencesEntre("2026-11-24", r, "2026-11-24", "2026-11-26"), ["2026-11-24", "2026-11-26"]);
  r = arreterAvant(r, "2026-11-26");
  assert.deepEqual(occurrencesEntre("2026-11-24", r, "2026-11-24", "2026-12-31"), ["2026-11-24"]);
});

test("developper : une carte par occurrence, cochée selon la règle", () => {
  const serie = tache({ recurrence: regle({ frequence: "jour", faites: ["2026-11-25"] }), echeance: "2026-11-26" });
  const occ = developper([serie, tache({ id: "u", recurrence: null })], "2026-11-24", "2026-11-26");
  assert.deepEqual(occ.map((t) => [t.id, t.faite]), [
    [idOccurrence("s1", "2026-11-24"), false], ["s1~2026-11-25", true], ["s1~2026-11-26", false], ["u", false],
  ]);
  // L'échéance suit l'occurrence (ici : 2 jours après).
  assert.equal(occ[2].echeance, "2026-11-28");
  assert.deepEqual(analyserId("s1~2026-11-25"), { serieId: "s1", date: "2026-11-25" });
  assert.equal(analyserId("abc"), null);
});

test("entreesCourantes : une seule entrée à faire par série", () => {
  const serie = tache({ date: "2026-11-01", recurrence: regle({ frequence: "jour", faites: ["2026-11-17", "2026-11-18", "2026-11-23"] }) });
  const e = entreesCourantes([serie], "2026-11-24");
  // Cochées depuis le 17/11 (7 jours) + la plus ancienne non cochée depuis cette date : le 19/11.
  assert.deepEqual(e.map((t) => [t.date, t.faite]), [["2026-11-17", true], ["2026-11-18", true], ["2026-11-23", true], ["2026-11-19", false]]);
  // Série terminée et tout coché : plus rien à faire.
  const finie = tache({ recurrence: regle({ frequence: "jour", fin: { type: "nombre", nombre: 1 }, faites: ["2026-11-24"] }) });
  assert.deepEqual(entreesCourantes([finie], "2026-11-24").map((t) => t.faite), [true]);
});

test("validerRecurrence refuse ou corrige les données invalides", () => {
  assert.equal(validerRecurrence(null), null);
  assert.equal(validerRecurrence({ frequence: "heure" }), null);
  const r = validerRecurrence({ frequence: "semaine", intervalle: -2, joursSemaine: [9, 2, 2], faites: ["x", "2026-11-24"] })!;
  assert.deepEqual([r.intervalle, r.joursSemaine, r.faites, r.fin], [1, [2], ["2026-11-24"], { type: "jamais" }]);
});

test("phrases lisibles", () => {
  assert.equal(decrireRecurrence(regle({ frequence: "semaine", intervalle: 2, joursSemaine: [0, 3] }), "2026-11-24"),
    "Toutes les 2 semaines le lundi et le jeudi");
  assert.equal(decrireRecurrence(regle({ frequence: "semaine", joursSemaine: [0, 1, 2, 3, 4] }), "2026-11-24"),
    "Toutes les semaines du lundi au vendredi");
  assert.equal(decrireRecurrence(regle({ frequence: "mois", fin: { type: "nombre", nombre: 5 } }), "2027-01-31"),
    "Tous les mois le 31 (ou le dernier jour des mois plus courts), 5 fois");
  assert.equal(decrireRecurrence(regle({ frequence: "annee", fin: { type: "date", date: "2030-01-01" } }), "2026-11-24"),
    "Tous les ans le 24 novembre, jusqu'au 1er janvier 2030");
});

test("export iCalendar : RRULE équivalente à l'affichage", () => {
  assert.equal(regleRRULE(regle({ frequence: "jour", intervalle: 2 }), "2026-11-24", null), "FREQ=DAILY;INTERVAL=2");
  assert.equal(regleRRULE(regle({ frequence: "semaine", joursSemaine: [0, 3] }), "2026-11-24", null), "FREQ=WEEKLY;WKST=MO;BYDAY=MO,TH");
  assert.equal(regleRRULE(regle({ frequence: "mois" }), "2026-11-24", null), "FREQ=MONTHLY;BYMONTHDAY=24");
  assert.equal(regleRRULE(regle({ frequence: "mois" }), "2027-01-31", null), "FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1");
  assert.equal(regleRRULE(regle({ frequence: "mois", modeMois: "rang" }), "2026-11-24", null), "FREQ=MONTHLY;BYDAY=4TU");
  assert.equal(regleRRULE(regle({ frequence: "mois", modeMois: "dernier" }), "2026-11-24", null), "FREQ=MONTHLY;BYDAY=-1TU");
  assert.equal(regleRRULE(regle({ frequence: "annee" }), "2028-02-29", null), "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=28,29;BYSETPOS=-1");
  assert.equal(regleRRULE(regle({ frequence: "jour", fin: { type: "nombre", nombre: 4 } }), "2026-11-24", null), "FREQ=DAILY;COUNT=4");
  // Sans heure : UNTIL est une date ; avec heure : un instant UTC (23:59:59 à Paris = 22:59:59Z en hiver).
  assert.equal(regleRRULE(regle({ frequence: "jour", fin: { type: "date", date: "2026-12-31" } }), "2026-11-24", null), "FREQ=DAILY;UNTIL=20261231");
  assert.equal(regleRRULE(regle({ frequence: "jour", fin: { type: "date", date: "2026-12-31" } }), "2026-11-24", "14:00"), "FREQ=DAILY;UNTIL=20261231T225959Z");
  assert.equal(regleRRULE(regle({ frequence: "jour", fin: { type: "date", date: "2027-07-01" } }), "2026-11-24", "14:00"), "FREQ=DAILY;UNTIL=20270701T215959Z");
});
