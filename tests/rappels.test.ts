/* Tests des rappels (lib/rappels.ts) et de l'heure de Paris (lib/fuseau.ts). Lancer : npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import { heureMurale, instantMural } from "../lib/fuseau.ts";
import { compter, rappelsDus, resumesDus, type TacheRappel } from "../lib/rappels.ts";

const tache = (champs: Partial<TacheRappel>): TacheRappel => ({
  id: "t1", user_id: "u1", titre: "Réviser", date: "2026-11-26", heure: "14:00:00", lieu: "", rappel_minutes: 30, recurrence: null, ...champs,
});
// 26/11/2026 est en heure d'hiver : Paris = UTC + 1.
const paris = (date: string, heure: string) => instantMural(date, heure);

test("heure de Paris : hiver UTC+1, été UTC+2", () => {
  assert.equal(new Date(paris("2026-11-26", "14:00")).toISOString(), "2026-11-26T13:00:00.000Z");
  assert.equal(new Date(paris("2026-07-01", "14:00")).toISOString(), "2026-07-01T12:00:00.000Z");
  assert.deepEqual(heureMurale(Date.parse("2026-03-29T01:30:00Z")), { date: "2026-03-29", heure: "03:30", minutes: 210 }); // passage à l'heure d'été
});

test("rappel 30 min avant : dû à 13 h 30, pas avant, rattrapé pendant 15 min", () => {
  const t = [tache({})];
  assert.equal(rappelsDus(t, paris("2026-11-26", "13:29")).length, 0);
  const n = rappelsDus(t, paris("2026-11-26", "13:30"));
  assert.equal(n.length, 1);
  assert.equal(n[0].corps, "Dans 30 min, à 14 h 00");
  assert.equal(rappelsDus(t, paris("2026-11-26", "13:44")).length, 1);
  assert.equal(rappelsDus(t, paris("2026-11-26", "13:45")).length, 0);
});

test("pas de rappel si rappel_minutes est null ; tâche sans heure rappelée à 9 h", () => {
  assert.equal(rappelsDus([tache({ rappel_minutes: null })], paris("2026-11-26", "13:30")).length, 0);
  const n = rappelsDus([tache({ heure: null, rappel_minutes: 0 })], paris("2026-11-26", "09:00"));
  assert.equal(n.length, 1);
  assert.equal(n[0].corps, "À faire aujourd'hui");
});

test("la veille : rappel le 25 pour une tâche du 26 ; clé différente si l'heure change", () => {
  const n = rappelsDus([tache({ rappel_minutes: 1440 })], paris("2026-11-25", "14:05"));
  assert.equal(n.length, 1);
  assert.match(n[0].corps, /^Demain à 14 h 00/);
  const autre = rappelsDus([tache({ rappel_minutes: 1440, heure: "15:00:00" })], paris("2026-11-25", "15:00"));
  assert.notEqual(n[0].cle, autre[0].cle);
});

test("série : chaque occurrence non cochée est rappelée, pas les jours cochés", () => {
  const recurrence = { frequence: "jour", intervalle: 1, joursSemaine: [], modeMois: "jour", fin: { type: "jamais" }, exceptions: [], faites: ["2026-11-27"] };
  const t = [tache({ date: "2026-11-20", rappel_minutes: 0, recurrence })];
  assert.equal(rappelsDus(t, paris("2026-11-26", "14:00")).length, 1);
  assert.equal(rappelsDus(t, paris("2026-11-27", "14:00")).length, 0); // cochée d'avance
});

test("résumé du matin à l'heure choisie, avec le compte du jour et des retards", () => {
  const taches = [tache({}), tache({ id: "t2", date: "2026-11-24" }), tache({ id: "t3", user_id: "u2" })];
  const n = resumesDus([{ user_id: "u1", resume_matin: "08:00:00" }], taches, paris("2026-11-26", "08:02"));
  assert.equal(n.length, 1);
  assert.equal(n[0].corps, "1 tâche aujourd'hui · 1 en retard. Touche pour la préparer en 1 minute.");
  assert.equal(n[0].url, "/?ma-journee=1");
  assert.equal(resumesDus([{ user_id: "u1", resume_matin: "08:00:00" }], taches, paris("2026-11-26", "07:59")).length, 0);
  assert.deepEqual(compter(taches.filter((t) => t.user_id === "u1"), "2026-11-26"), { duJour: 1, enRetard: 1 });
});
