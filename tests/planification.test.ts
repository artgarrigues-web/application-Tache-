/* Tests de l'algorithme de planification (lib/planification.ts).
   Lancer : npm test   (Node exécute directement le TypeScript, sans dépendance à installer). */

import { test } from "node:test";
import assert from "node:assert/strict";
import { planifier, proposerPlannings, validerPlages, PLAGES_PAR_DEFAUT, type PlageDispo } from "../lib/planification.ts";
import type { Tache } from "../lib/types.ts";

const LUNDI = "2026-11-23";
const AVANT = new Date(2026, 10, 22, 12, 0); // dimanche précédent : toute la semaine est dans le futur

let n = 0;
function tache(champs: Partial<Tache>): Tache {
  n++;
  return {
    id: `t${n}`, titre: `Tâche ${n}`, description: "", date: "", heure: "", dureeMinutes: null,
    lieu: "", echeance: "", materiel: "", categorie: "perso", priorite: "moyenne", groupe: null, couleur: null, projetId: null, recurrence: null,
    faite: false, creeLe: "2026-11-01T00:00:00Z", ...champs,
  };
}
const lundiSeul: PlageDispo[] = [{ jour: 0, debut: "08:00", fin: "12:00" }];

test("durée par défaut 1 h et premier créneau libre", () => {
  const p = planifier({ taches: [tache({ id: "a" })], lundi: LUNDI, plages: lundiSeul, maintenant: AVANT }, "echeances");
  assert.equal(p.placements.length, 1);
  assert.deepEqual([p.placements[0].date, p.placements[0].heure, p.placements[0].dureeMinutes], [LUNDI, "08:00", 60]);
  assert.equal(p.placements[0].dureeParDefaut, true);
});

test("évite les tâches déjà datées avec heure", () => {
  const occupee = tache({ date: LUNDI, heure: "08:00", dureeMinutes: 90 });
  const p = planifier({ taches: [occupee, tache({ id: "a", dureeMinutes: 30 })], lundi: LUNDI, plages: lundiSeul, maintenant: AVANT }, "echeances");
  assert.equal(p.placements[0].heure, "09:30");
});

test("ne place rien dans le passé (aujourd'hui coupé à l'heure actuelle, arrondie aux 5 min)", () => {
  const p = planifier({ taches: [tache({})], lundi: LUNDI, plages: lundiSeul, maintenant: new Date(2026, 10, 23, 9, 7) }, "echeances");
  assert.equal(p.placements[0].heure, "09:10");
  const q = planifier({ taches: [tache({})], lundi: LUNDI, plages: lundiSeul, maintenant: new Date(2026, 10, 24, 8, 0) }, "echeances");
  assert.equal(q.placements.length, 0, "lundi est passé : plus rien à placer");
});

test("l'échéance la plus proche passe en premier et la tâche est placée avant son échéance", () => {
  const plages: PlageDispo[] = [{ jour: 0, debut: "08:00", fin: "09:00" }, { jour: 2, debut: "08:00", fin: "09:00" }];
  const tard = tache({ id: "tard", echeance: "2026-11-30" });
  const tot = tache({ id: "tot", echeance: "2026-11-23" });
  const p = planifier({ taches: [tard, tot], lundi: LUNDI, plages, maintenant: AVANT }, "echeances");
  const ou = Object.fromEntries(p.placements.map((x) => [x.tacheId, x.date]));
  assert.equal(ou.tot, "2026-11-23");
  assert.equal(ou.tard, "2026-11-25");
  assert.equal(p.stats.apresEcheance, 0);
});

test("avertit quand une tâche ne tient qu'après son échéance", () => {
  const plages: PlageDispo[] = [{ jour: 3, debut: "08:00", fin: "10:00" }]; // seulement jeudi
  const p = planifier({ taches: [tache({ id: "a", echeance: "2026-11-24" })], lundi: LUNDI, plages, maintenant: AVANT }, "echeances");
  assert.equal(p.placements[0].date, "2026-11-26");
  assert.equal(p.placements[0].apresEcheance, true);
});

test("une tâche trop longue reste dans la checklist avec une explication", () => {
  const p = planifier({ taches: [tache({ id: "a", dureeMinutes: 300 })], lundi: LUNDI, plages: lundiSeul, maintenant: AVANT }, "echeances");
  assert.equal(p.placements.length, 0);
  assert.equal(p.nonPlaces[0].tacheId, "a");
  assert.match(p.nonPlaces[0].raison, /5 h/);
});

test("les tâches faites ou déjà datées ne sont pas replanifiées", () => {
  const p = planifier({ taches: [tache({ faite: true }), tache({ date: LUNDI })], lundi: LUNDI, plages: lundiSeul, maintenant: AVANT }, "echeances");
  assert.equal(p.placements.length + p.nonPlaces.length, 0);
});

test("« regroupé par lieu » enchaîne les tâches d'un même lieu", () => {
  const taches = [
    tache({ id: "b1", lieu: "Bibliothèque", dureeMinutes: 60 }),
    tache({ id: "g1", lieu: "Gymnase", dureeMinutes: 60 }),
    tache({ id: "b2", lieu: "bibliotheque ", dureeMinutes: 60 }), // même lieu, écrit autrement
  ];
  const plages: PlageDispo[] = [{ jour: 0, debut: "08:00", fin: "20:00" }];
  const lieu = planifier({ taches, lundi: LUNDI, plages, maintenant: AVANT }, "lieu");
  const ordre = lieu.placements.map((p) => p.tacheId);
  assert.ok(Math.abs(ordre.indexOf("b1") - ordre.indexOf("b2")) === 1, `b1 et b2 doivent se suivre : ${ordre}`);
  assert.equal(lieu.stats.changementsDeLieu, 1);
});

test("« charge équilibrée » répartit sur plusieurs jours", () => {
  const taches = [1, 2, 3].map(() => tache({ dureeMinutes: 60 }));
  const equilibre = planifier({ taches, lundi: LUNDI, plages: PLAGES_PAR_DEFAUT, maintenant: AVANT }, "equilibre");
  assert.equal(new Set(equilibre.placements.map((p) => p.date)).size, 3);
  const echeances = planifier({ taches, lundi: LUNDI, plages: PLAGES_PAR_DEFAUT, maintenant: AVANT }, "echeances");
  assert.equal(new Set(echeances.placements.map((p) => p.date)).size, 1);
});

test("aucun chevauchement entre tâches placées et tâches existantes, quelle que soit la stratégie", () => {
  const taches = [
    tache({ date: "2026-11-24", heure: "10:00", dureeMinutes: 120 }),
    ...Array.from({ length: 25 }, (_, i) => tache({ dureeMinutes: 30 + (i % 4) * 45, lieu: ["A", "B", ""][i % 3], echeance: i % 2 ? "2026-11-26" : "" })),
  ];
  for (const p of proposerPlannings({ taches, lundi: LUNDI, plages: PLAGES_PAR_DEFAUT, maintenant: AVANT })) {
    const occupes = [
      { date: "2026-11-24", debut: 600, fin: 720 },
      ...p.placements.map((x) => {
        const [h, m] = x.heure.split(":").map(Number);
        return { date: x.date, debut: h * 60 + m, fin: h * 60 + m + x.dureeMinutes };
      }),
    ];
    for (const x of occupes) {
      assert.ok(x.debut >= 480 && x.fin <= 1200, `${p.id} : hors plage 8h-20h`);
      for (const y of occupes) {
        if (x !== y && x.date === y.date) assert.ok(x.fin <= y.debut || y.fin <= x.debut, `${p.id} : chevauchement`);
      }
    }
    assert.equal(p.placements.length + p.nonPlaces.length, 25, `${p.id} : chaque tâche est placée ou signalée`);
  }
});

test("déterministe : deux appels donnent le même résultat", () => {
  const taches = Array.from({ length: 10 }, (_, i) => tache({ dureeMinutes: 20 * (i + 1), lieu: i % 2 ? "X" : "Y" }));
  const e = { taches, lundi: LUNDI, plages: PLAGES_PAR_DEFAUT, maintenant: AVANT };
  assert.deepEqual(proposerPlannings(e), proposerPlannings(e));
});

test("signale deux propositions identiques", () => {
  const p = proposerPlannings({ taches: [tache({})], lundi: LUNDI, plages: lundiSeul, maintenant: AVANT });
  assert.equal(p[1].identiqueA, "echeances");
});

test("validerPlages rejette les plages incohérentes", () => {
  assert.deepEqual(validerPlages([{ jour: 0, debut: "10:00", fin: "09:00" }, { jour: 9, debut: "08:00", fin: "09:00" }, { jour: 1, debut: "08:00", fin: "09:00" }]),
    [{ jour: 1, debut: "08:00", fin: "09:00" }]);
  assert.equal(validerPlages("n'importe quoi"), null);
});

test("« regroupé par lieu » : une tâche urgente sans lieu passe avant un groupe qui peut attendre", () => {
  const taches = [
    tache({ id: "b1", lieu: "Bibliothèque" }), tache({ id: "b2", lieu: "Bibliothèque" }),
    tache({ id: "urgent", echeance: LUNDI }),
  ];
  const p = planifier({ taches, lundi: LUNDI, plages: lundiSeul, maintenant: AVANT }, "lieu");
  assert.equal(p.placements[0].tacheId, "urgent");
  assert.equal(p.placements[0].heure, "08:00");
});
