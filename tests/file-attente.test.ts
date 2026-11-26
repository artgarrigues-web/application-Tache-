/* Tests de la file d'attente hors connexion et de la règle de conflit (lib/file-attente.ts).
   Lancer : npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import { appliquer, egal, enfiler, fusionner3, resoudre, type Ligne, type Operation } from "../lib/file-attente.ts";

const T0 = "2026-11-26T08:00:00.000Z"; // dans le métro
const T1 = "2026-11-26T08:05:00.000Z";
let n = 0;
const cle = () => `op${++n}`;

const ligne: Ligne = { id: "t1", titre: "Réviser", date: "2026-11-27", heure: "14:00:00", faite: false, lieu: "", recurrence: null };

test("egal : '14:00' et '14:00:00' sont la même heure, '' et null aussi", () => {
  assert.ok(egal("14:00", "14:00:00"));
  assert.ok(egal("", null));
  assert.ok(egal({ b: 1, a: [1, 2] }, { a: [1, 2], b: 1 }));
  assert.ok(!egal("14:00", "15:00"));
});

test("enfiler : seuls les champs vraiment changés sont gardés, avec leur valeur d'avant", () => {
  // Le formulaire renvoie TOUS les champs ; seul le titre a changé.
  const f = enfiler([], { table: "taches", type: "modifier", id: "t1", valeurs: { titre: "Réviser l'analyse", date: "2026-11-27", heure: "14:00", lieu: "" } }, ligne, T0, cle());
  assert.equal(f.length, 1);
  assert.deepEqual(f[0].valeurs, { titre: "Réviser l'analyse" });
  assert.deepEqual(f[0].avant, { titre: "Réviser" });
  assert.equal(f[0].quand.titre, T0);
});

test("enfiler : aucun changement réel = rien dans la file", () => {
  assert.equal(enfiler([], { table: "taches", type: "modifier", id: "t1", valeurs: { heure: "14:00" } }, ligne, T0, cle()).length, 0);
});

test("enfiler : deux modifications de la même tâche fusionnent (avant = la toute première valeur)", () => {
  let f = enfiler([], { table: "taches", type: "modifier", id: "t1", valeurs: { titre: "A" } }, ligne, T0, cle());
  f = enfiler(f, { table: "taches", type: "modifier", id: "t1", valeurs: { titre: "B", faite: true } }, { ...ligne, titre: "A" }, T1, cle());
  assert.equal(f.length, 1);
  assert.deepEqual(f[0].valeurs, { titre: "B", faite: true });
  assert.deepEqual(f[0].avant, { titre: "Réviser", faite: false });
  assert.equal(f[0].quand.titre, T1);
});

test("enfiler : créer puis modifier = créer avec les bonnes valeurs ; créer puis supprimer = rien", () => {
  let f = enfiler([], { table: "taches", type: "inserer", id: "n1", valeurs: { id: "n1", titre: "Nouvelle" } }, null, T0, cle());
  f = enfiler(f, { table: "taches", type: "modifier", id: "n1", valeurs: { titre: "Nouvelle tâche" } }, { id: "n1", titre: "Nouvelle" }, T1, cle());
  assert.equal(f.length, 1);
  assert.equal(f[0].type, "inserer");
  assert.equal(f[0].valeurs?.titre, "Nouvelle tâche");
  f = enfiler(f, { table: "taches", type: "supprimer", id: "n1" }, null, T1, cle());
  assert.equal(f.length, 0);
});

test("enfiler : supprimer remplace les modifications en attente ; modifier après suppression est ignoré", () => {
  let f = enfiler([], { table: "taches", type: "modifier", id: "t1", valeurs: { titre: "A" } }, ligne, T0, cle());
  f = enfiler(f, { table: "taches", type: "supprimer", id: "t1" }, null, T1, cle());
  assert.deepEqual(f.map((o) => o.type), ["supprimer"]);
  f = enfiler(f, { table: "taches", type: "modifier", id: "t1", valeurs: { titre: "B" } }, null, T1, cle());
  assert.equal(f.length, 1);
});

test("appliquer : prévision locale (création avec valeurs par défaut, modification, suppression)", () => {
  const m = new Map<string, Ligne>([["t1", ligne]]);
  appliquer(m, { cle: "x", table: "taches", type: "inserer", id: "n1", valeurs: { titre: "N" }, quand: {} }, T0);
  assert.equal(m.get("n1")?.faite, false);
  assert.equal(m.get("n1")?.cree_le, T0);
  appliquer(m, { cle: "y", table: "taches", type: "modifier", id: "t1", valeurs: { faite: true }, quand: {} }, T0);
  assert.equal(m.get("t1")?.faite, true);
  appliquer(m, { cle: "z", table: "taches", type: "supprimer", id: "t1", quand: {} }, T0);
  assert.ok(!m.has("t1"));
});

const opModif = (valeurs: Record<string, unknown>, avant: Record<string, unknown>, quand = T0): Operation =>
  ({ cle: "o", table: "taches", type: "modifier", id: "t1", valeurs, avant, quand: Object.fromEntries(Object.keys(valeurs).map((k) => [k, quand])) });

test("resoudre : personne d'autre n'a touché au champ → ma valeur part", () => {
  const r = resoudre(opModif({ titre: "A" }, { titre: "Réviser" }), ligne, T1);
  assert.deepEqual(r.aEnvoyer, { titre: "A" });
  assert.equal(r.conflits.length, 0);
});

test("resoudre : l'autre appareil a changé un AUTRE champ → les deux changements sont gardés", () => {
  const serveur = { ...ligne, date: "2026-11-28" }; // l'ordinateur a déplacé la tâche
  const r = resoudre(opModif({ titre: "A" }, { titre: "Réviser" }), serveur, T1);
  assert.deepEqual(r.aEnvoyer, { titre: "A" }); // la date n'est pas renvoyée : celle de l'ordinateur reste
  assert.equal(r.conflits.length, 0);
});

test("resoudre : même champ changé des deux côtés, l'autre appareil PLUS TARD → sa version gagne", () => {
  const serveur = { ...ligne, heure: "16:00:00" };
  const r = resoudre(opModif({ heure: "10:00" }, { heure: "14:00:00" }, T0), serveur, T1);
  assert.deepEqual(r.aEnvoyer, {});
  assert.deepEqual(r.conflits, [{ champ: "heure", gagnant: "autre" }]);
});

test("resoudre : même champ changé des deux côtés, moi PLUS TARD → ma version gagne", () => {
  const serveur = { ...ligne, heure: "16:00:00" };
  const r = resoudre(opModif({ heure: "10:00" }, { heure: "14:00:00" }, T1), serveur, T0);
  assert.deepEqual(r.aEnvoyer, { heure: "10:00" });
  assert.deepEqual(r.conflits, [{ champ: "heure", gagnant: "moi" }]);
});

test("resoudre : heure de modification en base inconnue (migration absente) → ma version, avec avertissement", () => {
  const r = resoudre(opModif({ titre: "A" }, { titre: "Réviser" }), { ...ligne, titre: "C" }, null);
  assert.deepEqual(r.aEnvoyer, { titre: "A" });
  assert.deepEqual(r.conflits, [{ champ: "titre", gagnant: "moi" }]);
});

test("resoudre : même changement des deux côtés → rien à envoyer, pas de conflit", () => {
  const r = resoudre(opModif({ faite: true }, { faite: false }), { ...ligne, faite: true }, T1);
  assert.deepEqual(r.aEnvoyer, {});
  assert.equal(r.conflits.length, 0);
});

test("fusionner3 : jours cochés d'une répétition sur deux appareils → les deux coches sont gardées", () => {
  const base = { frequence: "jour", faites: ["2026-11-24"], exceptions: [] };
  const mien = { ...base, faites: ["2026-11-24", "2026-11-25"] };   // coché dans le métro
  const autre = { ...base, faites: ["2026-11-24", "2026-11-26"] };  // coché sur l'ordinateur
  const f = fusionner3(base, mien, autre, "autre");
  assert.equal(f.conflit, false);
  assert.deepEqual((f.valeur as typeof base).faites.sort(), ["2026-11-24", "2026-11-25", "2026-11-26"].sort());
});

test("fusionner3 : décocher d'un côté, cocher de l'autre", () => {
  const f = fusionner3(["a", "b"], ["b"], ["a", "b", "c"], "mien");
  assert.deepEqual(f.valeur, ["b", "c"]);
  assert.equal(f.conflit, false);
});

test("fusionner3 : étapes (objets avec id) modifiées chacune de son côté", () => {
  const base = [{ id: "e1", texte: "Lire", faite: false }, { id: "e2", texte: "Résumer", faite: false }];
  const mien = [{ id: "e1", texte: "Lire", faite: true }, { id: "e2", texte: "Résumer", faite: false }];
  const autre = [{ id: "e1", texte: "Lire", faite: false }, { id: "e2", texte: "Résumer le chapitre", faite: false }, { id: "e3", texte: "Fiches", faite: false }];
  const f = fusionner3(base, mien, autre, "autre");
  assert.equal(f.conflit, false);
  assert.deepEqual(f.valeur, [
    { id: "e1", texte: "Lire", faite: true },
    { id: "e2", texte: "Résumer le chapitre", faite: false },
    { id: "e3", texte: "Fiches", faite: false },
  ]);
});

test("fusionner3 : vrai conflit sur une valeur simple → tranché par « prefere »", () => {
  assert.deepEqual(fusionner3("a", "b", "c", "mien"), { valeur: "b", conflit: true });
  assert.deepEqual(fusionner3("a", "b", "c", "autre"), { valeur: "c", conflit: true });
});

test("resoudre + fusion : répétition cochée sur deux appareils → valeur fusionnée envoyée, sans avertissement", () => {
  const base = { faites: ["2026-11-24"] };
  const op = opModif({ recurrence: { faites: ["2026-11-24", "2026-11-25"] } }, { recurrence: base });
  const r = resoudre(op, { ...ligne, recurrence: { faites: ["2026-11-24", "2026-11-26"] } }, T1);
  assert.deepEqual(r.aEnvoyer, { recurrence: { faites: ["2026-11-24", "2026-11-26", "2026-11-25"] } });
  assert.equal(r.conflits.length, 0);
});
