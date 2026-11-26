/* Tests des étapes (sous-tâches) et du matériel cochables (lib/etapes.ts),
   en particulier pour les tâches répétées (une case par jour). Lancer : npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avancement, basculerCaseSerie, basculerCaseTache, cleMateriel, decouperLignes, nettoyer, validerEtapes,
} from "../lib/etapes.ts";
import { ajouterException, arreterAvant, developper, recurrenceParDefaut, validerRecurrence } from "../lib/recurrence.ts";
import type { Tache } from "../lib/types.ts";

function tache(champs: Partial<Tache>): Tache {
  return {
    id: "s1", titre: "Sport", description: "", date: "2026-11-23", heure: "", dureeMinutes: null,
    lieu: "", echeance: "", materiel: "Gourde\nServiette", categorie: "perso", priorite: "moyenne", groupe: null, couleur: null,
    projetId: null, rappelMinutes: null, recurrence: null, faite: false, creeLe: "2026-11-01T00:00:00Z",
    etapes: [{ id: "a", texte: "Échauffement", faite: false }, { id: "b", texte: "Étirements", faite: false }], ...champs,
  };
}

test("tâche unique : cocher une étape et un élément du matériel", () => {
  const t = tache({});
  const c1 = basculerCaseTache(t, "etape", "b");
  assert.deepEqual(c1.etapes.map((e) => e.faite), [false, true]);
  const c2 = basculerCaseTache({ ...t, ...c1 }, "materiel", "Gourde ");
  assert.deepEqual(c2.materielPris, ["gourde"]);
  assert.deepEqual(avancement({ ...t, ...c2 }), { etapesFaites: 1, etapesTotal: 2, materielPris: 1, materielTotal: 2 });
  // Décocher
  assert.deepEqual(basculerCaseTache({ ...t, ...c2 }, "materiel", "gourde").materielPris, []);
});

test("tâche répétée : une case cochée ne vaut QUE pour son jour", () => {
  const serie = tache({ recurrence: recurrenceParDefaut("2026-11-23") }); // chaque lundi
  const r = basculerCaseSerie(serie.recurrence!, "2026-11-30", "etape", "a", "2026-11-30");
  const r2 = basculerCaseSerie(r, "2026-11-30", "materiel", "Gourde", "2026-11-30");
  const occ = developper([{ ...serie, recurrence: r2 }], "2026-11-23", "2026-12-07");
  assert.equal(occ.length, 3);
  const [lun23, lun30, lun7] = occ;
  assert.deepEqual(lun30.etapes!.map((e) => e.faite), [true, false]);
  assert.deepEqual(lun30.materielPris, ["gourde"]);
  assert.deepEqual(lun23.etapes!.map((e) => e.faite), [false, false]);
  assert.deepEqual(lun7.materielPris, []);
});

test("les cases suivent la série : exception, série coupée, validation, vieux jours oubliés", () => {
  let r = recurrenceParDefaut("2026-11-23");
  r = basculerCaseSerie(r, "2026-11-30", "etape", "a", "2026-11-30");
  r = basculerCaseSerie(r, "2026-12-07", "etape", "a", "2026-12-07");
  assert.deepEqual(Object.keys(ajouterException(r, "2026-11-30").cases!), ["2026-12-07"]);
  assert.deepEqual(Object.keys(arreterAvant(r, "2026-12-07").cases!), ["2026-11-30"]);
  assert.deepEqual(validerRecurrence(JSON.parse(JSON.stringify(r)))!.cases, r.cases);
  assert.equal(validerRecurrence({ ...r, cases: { "pas-une-date": { etapes: ["a"] } } })!.cases, undefined);
  // Cocher en mars oublie les cases de novembre (plus de 60 jours avant).
  const tard = basculerCaseSerie(r, "2027-03-01", "etape", "a", "2027-03-01");
  assert.deepEqual(Object.keys(tard.cases!), ["2027-03-01"]);
  // Décocher la dernière case d'un jour retire ce jour.
  assert.deepEqual(Object.keys(basculerCaseSerie(r, "2026-11-30", "etape", "a", "2026-12-07").cases!), ["2026-12-07"]);
});

test("validation, nettoyage et liste collée", () => {
  assert.deepEqual(validerEtapes([{ id: "x", texte: "  A " }, { texte: "" }, "n'importe quoi", { id: "x", texte: "B", faite: true }])
    .map((e) => [e.texte, e.faite, e.id === "x"]), [["A", false, true], ["B", true, false]]);
  assert.deepEqual(validerEtapes(null), []);
  const n = nettoyer([{ id: "a", texte: "  ", faite: false }, { id: "b", texte: " B ", faite: true }], "Gourde", ["gourde", "serviette"]);
  assert.deepEqual(n, { etapes: [{ id: "b", texte: "B", faite: true }], materielPris: ["gourde"] });
  assert.deepEqual(decouperLignes("- Pain\n• Lait\n\n1. Œufs\n[x] Café"), ["Pain", "Lait", "Œufs", "Café"]);
  assert.equal(cleMateriel("  Clé   USB "), "cle usb");
});
