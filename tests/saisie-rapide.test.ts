/* Tests de la saisie rapide (lib/saisie-rapide.ts). Lancer : npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyserSaisie, libelleDuree } from "../lib/saisie-rapide.ts";

const mercredi = new Date(2026, 10, 25); // mercredi 25 novembre 2026

// Raccourci : seuls titre / date / heure (les tests d'origine).
const base = (t: string) => {
  const { titre, date, heure } = analyserSaisie(t, mercredi);
  return { titre, date, heure };
};
// Résumé lisible d'une répétition : [fréquence, intervalle, jours de semaine (0 = lundi)].
const rythme = (t: string) => {
  const r = analyserSaisie(t, mercredi).recurrence;
  return r && [r.frequence, r.intervalle, r.joursSemaine];
};

/* ---------- Date et heure (comportement d'origine, inchangé) ---------- */

test("titre seul : rien d'autre n'est reconnu", () => {
  assert.deepEqual(analyserSaisie("Acheter du pain", mercredi), {
    titre: "Acheter du pain", date: null, heure: "", dureeMinutes: null, priorite: null, lieu: "", recurrence: null, extraits: {},
  });
});

test("demain + heure", () => {
  assert.deepEqual(base("Réviser maths demain 14h"), { titre: "Réviser maths", date: "2026-11-26", heure: "14:00" });
  assert.deepEqual(base("Dentiste demain à 9h30"), { titre: "Dentiste", date: "2026-11-26", heure: "09:30" });
});

test("après-demain avant demain (sinon « demain » serait trouvé dedans)", () => {
  assert.equal(analyserSaisie("Sport après-demain", mercredi).date, "2026-11-27");
  assert.equal(analyserSaisie("Sport apres-demain", mercredi).date, "2026-11-27");
});

test("jour de la semaine : le prochain, aujourd'hui compris", () => {
  assert.equal(analyserSaisie("Courses vendredi", mercredi).date, "2026-11-27");
  assert.equal(analyserSaisie("Courses lundi", mercredi).date, "2026-11-30");
  assert.equal(analyserSaisie("Courses mercredi", mercredi).date, "2026-11-25");
  assert.equal(analyserSaisie("Courses VENDREDI", mercredi).date, "2026-11-27");
});

test("aujourd'hui, ce soir, sans date, 14:30, ce week-end, demain matin", () => {
  assert.deepEqual(base("Appeler Léa ce soir 20:15"), { titre: "Appeler Léa", date: "2026-11-25", heure: "20:15" });
  assert.deepEqual(base("Lire un article sans date"), { titre: "Lire un article", date: "", heure: "" });
  assert.equal(analyserSaisie("Rangement ce week-end", mercredi).date, "2026-11-28");
  assert.deepEqual(base("Footing demain matin"), { titre: "Footing", date: "2026-11-26", heure: "" });
});

test("un nombre qui n'est pas une heure reste dans le titre", () => {
  assert.equal(analyserSaisie("Lire 3 chapitres", mercredi).titre, "Lire 3 chapitres");
  assert.equal(analyserSaisie("TP 2 demain", mercredi).titre, "TP 2");
  assert.equal(analyserSaisie("Faire 14h 2 exercices", mercredi).dureeMinutes, null);
});

/* ---------- Répétition ---------- */

test("répétition hebdomadaire : chaque lundi, tous les mardis et jeudis, les samedis", () => {
  assert.deepEqual(rythme("Réviser chaque lundi"), ["semaine", 1, [0]]);
  assert.deepEqual(rythme("Yoga tous les mardis et jeudis"), ["semaine", 1, [1, 3]]);
  assert.deepEqual(rythme("Marché les samedis"), ["semaine", 1, [5]]);
  assert.deepEqual(rythme("Sport lundi, mercredi et vendredi chaque semaine"), ["semaine", 1, [0, 2, 4]]);
  assert.equal(analyserSaisie("Réviser chaque lundi", mercredi).titre, "Réviser");
});

test("la date de début tombe sur le premier jour de la règle (aujourd'hui compris)", () => {
  assert.equal(analyserSaisie("Réviser chaque lundi", mercredi).date, "2026-11-30");
  assert.equal(analyserSaisie("Yoga tous les mardis et jeudis", mercredi).date, "2026-11-26");
  assert.equal(analyserSaisie("Réunion chaque mercredi", mercredi).date, "2026-11-25");
  assert.equal(analyserSaisie("Lessive tous les jours", mercredi).date, "2026-11-25");
  // Date écrite + règle : on part de la date écrite.
  assert.equal(analyserSaisie("Piano chaque semaine à partir de lundi", mercredi).date, "2026-11-30");
});

test("« chaque lundi » n'est pas lu comme la date « lundi » seule", () => {
  const r = analyserSaisie("Réviser chaque lundi", mercredi);
  assert.equal(r.extraits.date, undefined);
  assert.equal(r.extraits.recurrence, "chaque lundi");
});

test("autres rythmes : jours, N semaines, mois, ans, en semaine, week-end, un sur deux", () => {
  assert.deepEqual(rythme("Méditer tous les jours"), ["jour", 1, [2]]);
  assert.deepEqual(rythme("Méditer chaque matin"), ["jour", 1, [2]]);
  assert.deepEqual(rythme("Footing tous les 2 jours"), ["jour", 2, [2]]);
  assert.deepEqual(rythme("Ménage toutes les deux semaines"), ["semaine", 2, [2]]);
  assert.deepEqual(rythme("Ménage un samedi sur deux"), ["semaine", 2, [5]]);
  assert.deepEqual(rythme("Révisions en semaine"), ["semaine", 1, [0, 1, 2, 3, 4]]);
  assert.deepEqual(rythme("Révisions du lundi au vendredi"), ["semaine", 1, [0, 1, 2, 3, 4]]);
  assert.deepEqual(rythme("Grasse mat le week-end"), ["semaine", 1, [5, 6]]);
  assert.equal(rythme("Facture chaque mois")?.[0], "mois");
  assert.equal(rythme("Anniversaire tous les ans")?.[0], "annee");
  assert.equal(rythme("Arroser plantes hebdo")?.[0], "semaine");
  assert.equal(rythme("Bilan mensuel")?.[0], "mois");
});

test("« le 5 de chaque mois » : rythme mensuel qui commence le prochain 5", () => {
  const r = analyserSaisie("Payer loyer le 5 de chaque mois", mercredi);
  assert.equal(r.titre, "Payer loyer");
  assert.equal(r.recurrence?.frequence, "mois");
  assert.equal(r.recurrence?.modeMois, "jour");
  assert.equal(r.date, "2026-12-05");
  assert.equal(analyserSaisie("Relevé le 30 de chaque mois", mercredi).date, "2026-11-30");
});

test("une règle reconnue est complète (prête à enregistrer)", () => {
  assert.deepEqual(analyserSaisie("Réviser chaque lundi", mercredi).recurrence, {
    frequence: "semaine", intervalle: 1, joursSemaine: [0], modeMois: "jour", fin: { type: "jamais" }, exceptions: [], faites: [],
  });
});

/* ---------- Durée ---------- */

test("durée : « 1 h », « 45 min », « 2 heures », « une demi-heure », « pendant 1h30 »", () => {
  const d = (t: string) => analyserSaisie(t, mercredi).dureeMinutes;
  assert.equal(d("Réviser 1 h"), 60);
  assert.equal(d("Réviser 2 h 30"), 150);
  assert.equal(d("Réviser 45 min"), 45);
  assert.equal(d("Réviser 45min"), 45);
  assert.equal(d("Réviser 2 heures"), 120);
  assert.equal(d("Réviser une heure"), 60);
  assert.equal(d("Réviser une heure et demie"), 90);
  assert.equal(d("Réviser une demi-heure"), 30);
  assert.equal(d("Réviser un quart d'heure"), 15);
  assert.equal(d("Réviser pendant 1h30"), 90);
  assert.equal(d("Réviser en 2h"), 120);
  assert.equal(analyserSaisie("Réviser pendant 1h30", mercredi).titre, "Réviser");
});

test("« 2h » collé : durée si moins de 4 h sans « à », sinon heure", () => {
  assert.deepEqual(analyserSaisie("Sport 2h", mercredi).dureeMinutes, 120);
  assert.equal(analyserSaisie("Sport 2h", mercredi).heure, "");
  assert.equal(analyserSaisie("Sport à 2h", mercredi).heure, "02:00");
  assert.equal(analyserSaisie("Sport 18h", mercredi).heure, "18:00");
  assert.equal(analyserSaisie("Sport 18h", mercredi).dureeMinutes, null);
});

test("heure + durée dans la même phrase", () => {
  const r = analyserSaisie("Cours demain 14h 2h", mercredi);
  assert.equal(r.heure, "14:00");
  assert.equal(r.dureeMinutes, 120);
  const s = analyserSaisie("Réviser chaque lundi 14h 1 h", mercredi);
  assert.equal(s.heure, "14:00");
  assert.equal(s.dureeMinutes, 60);
});

test("plage « de 14h à 15h30 » : heure de début et durée", () => {
  const r = analyserSaisie("Réunion de 14h à 15h30", mercredi);
  assert.equal(r.titre, "Réunion");
  assert.equal(r.heure, "14:00");
  assert.equal(r.dureeMinutes, 90);
  assert.equal(analyserSaisie("TD 8h-10h", mercredi).dureeMinutes, 120);
  // Plage à l'envers : pas de durée négative.
  assert.equal(analyserSaisie("TD 16h-14h", mercredi).dureeMinutes, null);
});

test("libellé de durée", () => {
  assert.equal(libelleDuree(45), "45 min");
  assert.equal(libelleDuree(60), "1 h");
  assert.equal(libelleDuree(90), "1 h 30");
  assert.equal(libelleDuree(125), "2 h 05");
});

/* ---------- Priorité ---------- */

test("priorité haute : important, urgent, prioritaire, !!", () => {
  const p = (t: string) => analyserSaisie(t, mercredi).priorite;
  assert.equal(p("Rendre rapport important"), "haute");
  assert.equal(p("Rendre rapport IMPORTANT"), "haute");
  assert.equal(p("Rendre rapport urgent"), "haute");
  assert.equal(p("Rendre rapport très important"), "haute");
  assert.equal(p("Rendre rapport !!"), "haute");
  assert.equal(p("Rendre rapport priorité haute"), "haute");
  assert.equal(analyserSaisie("Rendre rapport important", mercredi).titre, "Rendre rapport");
});

test("priorité basse : pas urgent, facultatif, si possible (avant « urgent »)", () => {
  const p = (t: string) => analyserSaisie(t, mercredi).priorite;
  assert.equal(p("Ranger photos pas urgent"), "basse");
  assert.equal(p("Ranger photos facultatif"), "basse");
  assert.equal(p("Ranger photos si possible"), "basse");
  assert.equal(p("Ranger photos priorité basse"), "basse");
  assert.equal(p("Ranger photos"), null);
  assert.equal(analyserSaisie("Ranger photos pas urgent", mercredi).titre, "Ranger photos");
});

/* ---------- Lieu ---------- */

test("lieu après « à / au / à la »", () => {
  const l = (t: string) => analyserSaisie(t, mercredi).lieu;
  assert.equal(l("Réviser à la bibliothèque"), "Bibliothèque");
  assert.equal(l("Réviser à la bibliotheque"), "Bibliotheque");
  assert.equal(l("Réviser à la BU"), "BU");
  assert.equal(l("Réviser au bureau"), "Bureau");
  assert.equal(l("Réviser au CDI"), "CDI");
  assert.equal(l("Courses au supermarché"), "Supermarché");
  assert.equal(l("Sport à la salle de sport"), "Salle de sport");
  assert.equal(analyserSaisie("Réviser à la bibliothèque", mercredi).titre, "Réviser");
});

test("lieu : bibliothèque seule, salle 204, amphi A, chez…, en visio, @lieu libre", () => {
  const l = (t: string) => analyserSaisie(t, mercredi).lieu;
  assert.equal(l("Réviser bibliothèque"), "Bibliothèque");
  assert.equal(l("TD salle 204"), "Salle 204");
  assert.equal(l("TD en salle B204"), "Salle B204");
  assert.equal(l("CM amphi A"), "Amphi A");
  assert.equal(l("Dîner chez Paul"), "Chez Paul");
  assert.equal(l("Rendez-vous chez le dentiste"), "Chez le dentiste");
  assert.equal(l("Réunion en visio"), "Visio");
  assert.equal(l("Réunion sur Teams"), "Teams");
  assert.equal(l("Footing @Parc_de_la_Tête_d'Or"), "Parc de la Tête d'Or");
});

test("un « à » qui n'annonce pas un lieu reste dans le titre", () => {
  const r = analyserSaisie("Envoyer le mail à Paul", mercredi);
  assert.equal(r.lieu, "");
  assert.equal(r.titre, "Envoyer le mail à Paul");
  assert.equal(analyserSaisie("Ranger le bureau", mercredi).lieu, ""); // « le bureau » sans « au » : objet, pas lieu
});

/* ---------- Tout ensemble, et correction ---------- */

test("la phrase complète de l'exemple", () => {
  const r = analyserSaisie("Réviser maths chaque lundi 14h 1 h à la bibliothèque important", mercredi);
  assert.equal(r.titre, "Réviser maths");
  assert.equal(r.date, "2026-11-30");
  assert.equal(r.heure, "14:00");
  assert.equal(r.dureeMinutes, 60);
  assert.equal(r.priorite, "haute");
  assert.equal(r.lieu, "Bibliothèque");
  assert.deepEqual(r.recurrence?.joursSemaine, [0]);
  assert.deepEqual(r.extraits, {
    recurrence: "chaque lundi", heure: "14h", duree: "1 h", lieu: "à la bibliothèque", priorite: "important",
  });
});

test("ignorer un champ : ses mots retournent dans le titre", () => {
  const r = analyserSaisie("Lire un document important à la BU", mercredi, ["priorite"]);
  assert.equal(r.priorite, null);
  assert.equal(r.titre, "Lire un document important");
  assert.equal(r.lieu, "BU");
  const s = analyserSaisie("Réviser chaque lundi", mercredi, ["recurrence"]);
  assert.equal(s.recurrence, null);
  assert.equal(s.date, "2026-11-30"); // « lundi » reste compris comme date
  assert.equal(s.titre, "Réviser chaque");
  const t = analyserSaisie("Réviser chaque lundi", mercredi, ["recurrence", "date"]);
  assert.equal(t.titre, "Réviser chaque lundi");
  assert.equal(t.date, null);
});

test("ponctuation : les virgules orphelines ne restent pas dans le titre", () => {
  assert.equal(analyserSaisie("Réviser maths, demain, 14h", mercredi).titre, "Réviser maths");
});
