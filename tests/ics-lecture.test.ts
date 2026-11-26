/* Tests de la lecture des agendas externes (lib/ics-lecture.ts). Lancer : npm test */

import { test } from "node:test";
import assert from "node:assert/strict";
import { lireICS, normaliserAdresse } from "../lib/ics-lecture.ts";

const lignes = (...l: string[]) => l.join("\r\n");

// Agenda type Google : fuseau Europe/Paris décrit, cours chaque lundi, un lundi supprimé,
// un lundi déplacé, un rendez-vous en UTC, un jour férié « toute la journée ».
const GOOGLE = lignes(
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "BEGIN:VTIMEZONE", "TZID:Europe/Paris",
  "BEGIN:DAYLIGHT", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "TZNAME:CEST", "DTSTART:19700329T020000", "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU", "END:DAYLIGHT",
  "BEGIN:STANDARD", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "TZNAME:CET", "DTSTART:19701025T030000", "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU", "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT", "UID:cours@google", "DTSTART;TZID=Europe/Paris:20261102T080000", "DTEND;TZID=Europe/Paris:20261102T100000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO", "EXDATE;TZID=Europe/Paris:20261109T080000", "SUMMARY:Cours de mécanique", "LOCATION:Amphi A", "END:VEVENT",
  "BEGIN:VEVENT", "UID:cours@google", "RECURRENCE-ID;TZID=Europe/Paris:20261116T080000",
  "DTSTART;TZID=Europe/Paris:20261116T140000", "DTEND;TZID=Europe/Paris:20261116T160000", "SUMMARY:Cours de mécanique (déplacé)", "END:VEVENT",
  "BEGIN:VEVENT", "UID:rdv@google", "DTSTART:20261118T130000Z", "DTEND:20261118T133000Z", "SUMMARY:Dentiste", "END:VEVENT",
  "BEGIN:VEVENT", "UID:ferie@google", "DTSTART;VALUE=DATE:20261111", "DTEND;VALUE=DATE:20261112", "SUMMARY:Armistice", "TRANSP:TRANSPARENT", "END:VEVENT",
  "BEGIN:VEVENT", "UID:annule@google", "DTSTART:20261119T090000Z", "DTEND:20261119T100000Z", "STATUS:CANCELLED", "SUMMARY:Annulé", "END:VEVENT",
  "END:VCALENDAR",
);

test("Google : série hebdomadaire, date supprimée, occurrence déplacée, UTC, toute la journée", () => {
  const ev = lireICS(GOOGLE, "g", "2026-11-01", "2026-11-30");
  const cours = ev.filter((e) => e.titre.startsWith("Cours"));
  assert.deepEqual(cours.map((e) => `${e.date} ${e.heure}-${e.fin}`),
    ["2026-11-02 08:00-10:00", "2026-11-16 14:00-16:00", "2026-11-23 08:00-10:00", "2026-11-30 08:00-10:00"]);
  assert.equal(cours[0].lieu, "Amphi A");
  const dentiste = ev.find((e) => e.titre === "Dentiste")!;
  assert.equal(`${dentiste.heure}-${dentiste.fin}`, "14:00-14:30"); // 13 h UTC = 14 h à Paris en novembre
  const ferie = ev.find((e) => e.titre === "Armistice")!;
  assert.equal(ferie.journee, true);
  assert.equal(ferie.libre, true);
  assert.equal(ev.some((e) => e.titre === "Annulé"), false);
});

// Agenda type Outlook : fuseau Windows « Romance Standard Time », événement l'été (UTC+2).
const OUTLOOK = lignes(
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:Microsoft Exchange Server 2010",
  "BEGIN:VTIMEZONE", "TZID:Romance Standard Time",
  "BEGIN:STANDARD", "DTSTART:16010101T030000", "TZOFFSETFROM:+0200", "TZOFFSETTO:+0100", "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=10", "END:STANDARD",
  "BEGIN:DAYLIGHT", "DTSTART:16010101T020000", "TZOFFSETFROM:+0100", "TZOFFSETTO:+0200", "RRULE:FREQ=YEARLY;INTERVAL=1;BYDAY=-1SU;BYMONTH=3", "END:DAYLIGHT",
  "END:VTIMEZONE",
  "BEGIN:VEVENT", "UID:td@outlook", "DTSTART;TZID=Romance Standard Time:20260615T090000", "DTEND;TZID=Romance Standard Time:20260615T103000", "SUMMARY:TD Maths", "END:VEVENT",
  "BEGIN:VEVENT", "UID:nuit@outlook", "DTSTART;TZID=Romance Standard Time:20260616T230000", "DTEND;TZID=Romance Standard Time:20260617T013000", "SUMMARY:Garde de nuit", "END:VEVENT",
  "END:VCALENDAR",
);

test("Outlook : fuseau Windows et événement à cheval sur minuit", () => {
  const ev = lireICS(OUTLOOK, "o", "2026-06-01", "2026-06-30");
  assert.deepEqual(ev.map((e) => `${e.date} ${e.heure}-${e.fin} ${e.titre}`), [
    "2026-06-15 09:00-10:30 TD Maths",
    "2026-06-16 23:00-24:00 Garde de nuit",
    "2026-06-17 00:00-01:30 Garde de nuit",
  ]);
});

test("adresse : webcal accepté, adresses internes refusées", () => {
  assert.deepEqual(normaliserAdresse("webcal://calendar.google.com/calendar/ical/x/private-abc/basic.ics"),
    { url: "https://calendar.google.com/calendar/ical/x/private-abc/basic.ics" });
  assert.ok("erreur" in normaliserAdresse("https://127.0.0.1/a.ics"));
  assert.ok("erreur" in normaliserAdresse("https://localhost/a.ics"));
  assert.ok("erreur" in normaliserAdresse("ftp://exemple.com/a.ics"));
  assert.ok("erreur" in normaliserAdresse("https://agendia-taches.vercel.app/api/calendrier/abc.ics"));
});
