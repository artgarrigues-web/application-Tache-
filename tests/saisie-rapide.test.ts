/* Tests de la saisie rapide (lib/saisie-rapide.ts). Lancer : npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import { analyserSaisie } from "../lib/saisie-rapide.ts";

const mercredi = new Date(2026, 10, 25); // mercredi 25 novembre 2026

test("titre seul : ni date ni heure", () => {
  assert.deepEqual(analyserSaisie("Acheter du pain", mercredi), { titre: "Acheter du pain", date: null, heure: "" });
});

test("demain + heure", () => {
  assert.deepEqual(analyserSaisie("Réviser maths demain 14h", mercredi), { titre: "Réviser maths", date: "2026-11-26", heure: "14:00" });
  assert.deepEqual(analyserSaisie("Dentiste demain à 9h30", mercredi), { titre: "Dentiste", date: "2026-11-26", heure: "09:30" });
});

test("après-demain avant demain (sinon « demain » serait trouvé dedans)", () => {
  assert.equal(analyserSaisie("Sport après-demain", mercredi).date, "2026-11-27");
  assert.equal(analyserSaisie("Sport apres-demain", mercredi).date, "2026-11-27");
});

test("jour de la semaine : le prochain, aujourd'hui compris", () => {
  assert.equal(analyserSaisie("Courses vendredi", mercredi).date, "2026-11-27");
  assert.equal(analyserSaisie("Courses lundi", mercredi).date, "2026-11-30");
  assert.equal(analyserSaisie("Courses mercredi", mercredi).date, "2026-11-25");
});

test("aujourd'hui, ce soir, sans date, 14:30", () => {
  assert.deepEqual(analyserSaisie("Appeler Léa ce soir 20:15", mercredi), { titre: "Appeler Léa", date: "2026-11-25", heure: "20:15" });
  assert.deepEqual(analyserSaisie("Lire un article sans date", mercredi), { titre: "Lire un article", date: "", heure: "" });
});

test("un nombre qui n'est pas une heure reste dans le titre", () => {
  assert.equal(analyserSaisie("Lire 3 chapitres", mercredi).titre, "Lire 3 chapitres");
  assert.equal(analyserSaisie("TP 2 demain", mercredi).titre, "TP 2");
});
