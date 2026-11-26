/* Saisie rapide : on tape une phrase comme « Réviser maths chaque lundi 14h 1 h à la
   bibliothèque important » et l'application en tire le titre ET les détails.
   Inspiré de Todoist et Fantastical, en plus simple : seules les tournures françaises
   les plus courantes sont reconnues, tout le reste devient le titre.

   Reconnu (minuscules/majuscules et accents indifférents) :
   - DATE      : « aujourd'hui », « auj », « ce soir », « ce matin », « demain »,
                 « après-demain », un jour (« lundi », « le lundi », « dès lundi » :
                 le prochain, aujourd'hui compris), « ce week-end » (samedi), « sans date ».
   - HEURE     : « 14h », « 14h30 », « 9h05 », « 14:30 », « à 9h ».
   - DURÉE     : « 1 h », « 1h30 » (moins de 4 h, sans « à »), « 45 min », « 2 heures »,
                 « une heure », « une demi-heure », « un quart d'heure », « pendant 2h »,
                 et une plage « de 14h à 16h » / « 14h-16h » (heure + durée).
   - RÉPÉTITION: « chaque lundi », « tous les lundis et jeudis », « un lundi sur deux »,
                 « tous les jours », « toutes les 2 semaines », « chaque mois »,
                 « tous les ans », « en semaine », « le week-end », « quotidien »,
                 « hebdo », « le 15 de chaque mois ».
   - PRIORITÉ  : « important », « urgent », « prioritaire », « !! », « priorité haute »
                 → haute ; « pas urgent », « facultatif », « si possible », « priorité
                 basse » → basse ; « priorité moyenne/normale » → moyenne.
   - LIEU      : « à la bibliothèque », « au bureau », « à la BU », « salle 204 »,
                 « amphi A », « bâtiment B », « chez Paul », « en visio », « sur Teams »,
                 « @Café_du_coin » (n'importe quel lieu, « _ » = espace).

   Pour CORRIGER : chaque élément reconnu est renvoyé avec le texte qui l'a déclenché
   (« extraits »). L'écran affiche une pastille par élément ; la toucher la retire et
   rappelle analyserSaisie avec ce champ dans « ignorer » : les mots retournent alors
   dans le titre.

   Fonction PURE (pas d'accès à l'écran ni à la base, aucun import exécuté) : les tests
   (tests/saisie-rapide.test.ts, node --test) la chargent telle quelle.               */

import type { Priorite, Recurrence } from "./types";

/* Copies locales de petites fonctions de lib/dates.ts (voir plus haut : pas d'import). */
function ajouterJours(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function versISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function depuisISO(iso: string): Date {
  const [a, m, j] = iso.split("-").map(Number);
  return new Date(a, m - 1, j);
}
// 0 = lundi … 6 = dimanche (getDay() donne 0 = dimanche).
const jourDe = (d: Date) => (d.getDay() + 6) % 7;

export type ChampSaisie = "date" | "heure" | "duree" | "recurrence" | "priorite" | "lieu";

export interface SaisieAnalysee {
  titre: string;
  date: string | null;          // "AAAA-MM-JJ", "" = « sans date » écrit, null = rien trouvé
  heure: string;                // "HH:MM" ou ""
  dureeMinutes: number | null;  // null = rien trouvé
  priorite: Priorite | null;    // null = rien trouvé (le formulaire mettra « moyenne »)
  lieu: string;                 // "" = rien trouvé
  recurrence: Recurrence | null;
  /* Texte d'origine qui a déclenché chaque champ, ex. { recurrence: "chaque lundi" }.
     Sert aux pastilles de correction. Un champ absent = rien reconnu pour lui. */
  extraits: Partial<Record<ChampSaisie, string>>;
}

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];
const RE_JOUR = "(?:lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)";
const FIN = "(?=[\\s,.;!?)])"; // fin de mot : espace ou ponctuation
const NOMBRES: Record<string, number> = { un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6 };
const nombre = (t: string) => NOMBRES[t] ?? Number(t);

/* Version « à plat » du texte : minuscules, sans accents, apostrophe droite, MÊME
   LONGUEUR que l'original (caractère par caractère). On cherche les motifs dans cette
   version, puis on découpe l'original aux mêmes positions : les motifs restent simples
   (« apres » suffit pour « après », « Après », « APRÈS ») et le titre garde ses accents. */
function aplatir(s: string): string {
  let r = "";
  for (const c of s.split("")) {
    if (c === "’") { r += "'"; continue; }
    const d = c.normalize("NFD")[0].toLowerCase();
    r += d.length === 1 ? d : c;
  }
  return r;
}

/* Lieux reconnus après « à / au / à la / en / dans » (écrits à plat). */
const LIEUX = [
  "bibliotheque", "bibli", "bu", "mediatheque", "cdi", "fac", "faculte", "universite", "ecole", "lycee", "college", "campus",
  "maison", "bureau", "boulot", "travail", "labo", "laboratoire", "cantine", "ru", "resto u", "cafeteria", "cafet", "cafe",
  "gare", "aeroport", "supermarche", "magasin", "poste", "banque", "mairie", "prefecture", "hopital", "pharmacie", "stade",
  "gymnase", "gym", "piscine", "cinema", "salle de sport", "salle de classe", "salle de reunion", "salle de cours",
  "centre-ville", "centre ville", "marche", "parc", "boulangerie", "garage", "crous", "caf",
].sort((a, b) => b.length - a.length); // les plus longs d'abord (« salle de sport » avant « salle »)
// Lieux suivis d'un numéro ou d'une lettre (« salle 204 », « amphi A », « bâtiment B2 ») : reconnus même sans « à ».
const LIEUX_NUMEROTES = "(?:salle|amphi|amphitheatre|batiment|bat\\.?|local)";
const IDENTIFIANT = "(?:[a-z]?\\d+[a-z]?|[a-z])";
const SIGLES = new Set(["bu", "cdi", "ru", "caf", "crous"]);

export function analyserSaisie(texte: string, aujourdhui: Date, ignorer: readonly ChampSaisie[] = []): SaisieAnalysee {
  let reste = ` ${texte.trim()} `;
  const extraits: Partial<Record<ChampSaisie, string>> = {};
  const actif = (c: ChampSaisie) => !ignorer.includes(c);

  /* Cherche un motif (écrit « à plat ») ; s'il est trouvé, le retire du texte et
     renvoie le morceau d'ORIGINE (avec accents) et les groupes capturés. */
  function prendre(motif: RegExp, valide: (g: string[]) => boolean = () => true): { texte: string; g: string[] } | null {
    const m = motif.exec(aplatir(reste));
    if (!m || !valide(m.slice(1).map((x) => x ?? ""))) return null;
    const morceau = reste.slice(m.index, m.index + m[0].length).trim();
    reste = `${reste.slice(0, m.index)} ${reste.slice(m.index + m[0].length)}`;
    return { texte: morceau, g: m.slice(1).map((x) => x ?? "") };
  }
  const noter = (c: ChampSaisie, t: string) => { extraits[c] = extraits[c] ? `${extraits[c]} ${t}` : t; };

  /* ---------- 1. Répétition (avant la date : « chaque lundi » n'est pas « lundi ») ---------- */
  type Regle = { frequence: Recurrence["frequence"]; intervalle?: number; jours?: number[]; jourDuMois?: number };
  let regle: Regle | null = null;
  if (actif("recurrence")) {
    const listeJours = `${RE_JOUR}s?(?:\\s*(?:,|et)\\s*(?:le\\s+|les\\s+)?${RE_JOUR}s?)*`;
    const essais: [RegExp, (g: string[]) => Regle, ((g: string[]) => boolean)?][] = [
      // « le 15 de chaque mois », « le 1er de tous les mois »
      [new RegExp(`\\s(?:le\\s+)?(\\d{1,2})(?:er)?\\s+(?:de\\s+)?(?:chaque|tous\\s+les)\\s+mois${FIN}`),
        (g) => ({ frequence: "mois", jourDuMois: Number(g[0]) }), (g) => Number(g[0]) >= 1 && Number(g[0]) <= 31],
      // « un lundi sur deux »
      [new RegExp(`\\s(?:un|le)\\s+(${RE_JOUR})\\s+sur\\s+(deux|trois|quatre|[2-9])${FIN}`),
        (g) => ({ frequence: "semaine", jours: [JOURS.indexOf(g[0])], intervalle: nombre(g[1]) })],
      // « chaque lundi », « tous les lundis et jeudis », « les mardis »
      [new RegExp(`\\s(?:chaque|tous\\s+les|toutes\\s+les|les)\\s+(${listeJours})${FIN}`),
        (g) => ({ frequence: "semaine", jours: JOURS.filter((j) => g[0].includes(j)).map((j) => JOURS.indexOf(j)) })],
      // « en semaine », « du lundi au vendredi », « chaque jour de semaine »
      [new RegExp(`\\s(?:(?:chaque|tous\\s+les)\\s+jours?\\s+de\\s+(?:la\\s+)?semaine|en\\s+semaine|du\\s+lundi\\s+au\\s+vendredi)${FIN}`),
        () => ({ frequence: "semaine", jours: [0, 1, 2, 3, 4] })],
      // « le week-end », « chaque week-end » (« ce week-end » est une DATE, voir plus bas)
      [new RegExp(`\\s(?:le|les|chaque|tous\\s+les)\\s+week-?\\s?ends?${FIN}`),
        () => ({ frequence: "semaine", jours: [5, 6] })],
      // « tous les jours », « toutes les 2 semaines », « chaque mois », « tous les trois ans »
      [new RegExp(`\\s(?:chaque|tous\\s+les|toutes\\s+les)\\s+(?:([2-9]|1[0-2]|deux|trois|quatre|cinq|six)\\s+)?(jours?|matins?|soirs?|semaines?|mois|ans|annees?)${FIN}`),
        (g) => ({
          intervalle: g[0] ? nombre(g[0]) : 1,
          frequence: /^(jour|matin|soir)/.test(g[1]) ? "jour" : g[1].startsWith("semaine") ? "semaine" : g[1] === "mois" ? "mois" : "annee",
        })],
      [new RegExp(`\\s(?:quotidien(?:ne)?(?:ment)?|au\\s+quotidien)${FIN}`), () => ({ frequence: "jour" })],
      [new RegExp(`\\s(?:hebdo(?:madaire)?(?:ment)?)${FIN}`), () => ({ frequence: "semaine" })],
      [new RegExp(`\\s(?:mensuel(?:le)?(?:ment)?)${FIN}`), () => ({ frequence: "mois" })],
      [new RegExp(`\\s(?:annuel(?:le)?(?:ment)?)${FIN}`), () => ({ frequence: "annee" })],
    ];
    for (const [motif, lire, valide] of essais) {
      const t = prendre(motif, valide);
      if (t) { regle = lire(t.g); noter("recurrence", t.texte); break; }
    }
    // « lundi, mercredi et vendredi chaque semaine » : la liste de jours précise la règle.
    if (regle?.frequence === "semaine" && !regle.jours) {
      const t = prendre(new RegExp(`\\s(?:le\\s+|les\\s+)?(${listeJours})${FIN}`), (g) => /,|et/.test(g[0]));
      if (t) { regle.jours = JOURS.filter((j) => t.g[0].includes(j)).map((j) => JOURS.indexOf(j)); noter("recurrence", t.texte); }
    }
  }

  /* ---------- 2. Heure et durée ---------- */
  let heure = "";
  let dureeMinutes: number | null = null;
  const versHeure = (h: string, m: string) => `${h.padStart(2, "0")}:${m || "00"}`;
  const HEURE = "([01]?\\d|2[0-3])(?:h([0-5]\\d)?|:([0-5]\\d))";

  // 2a. Plage « de 14h à 16h », « 14h-16h30 » : l'heure de début ET la durée.
  if (actif("heure") && actif("duree")) {
    const minutes = (h: string, a: string, b: string) => Number(h) * 60 + Number(a || b || 0);
    // Une plage « à l'envers » (16h-14h) n'est pas prise : elle reste au titre.
    const t = prendre(new RegExp(`\\s(?:de\\s+)?${HEURE}\\s*(?:a|-|–|jusqu'a)\\s*${HEURE}${FIN}`),
      (g) => minutes(g[3], g[4], g[5]) > minutes(g[0], g[1], g[2]));
    if (t) {
      const [h1, m1a, m1b, h2, m2a, m2b] = t.g;
      heure = versHeure(h1, m1a || m1b);
      dureeMinutes = minutes(h2, m2a, m2b) - minutes(h1, m1a, m1b);
      noter("heure", t.texte);
      noter("duree", t.texte);
    }
  }

  // 2b. Durées sans ambiguïté (minutes, mot « heure », « pendant… », « 1 h » avec espace).
  if (actif("duree") && dureeMinutes === null) {
    const essais: [RegExp, (g: string[]) => number][] = [
      [new RegExp(`\\s(?:pendant\\s+|durant\\s+|pour\\s+|en\\s+)?(?:une\\s+)?demi[- ]heure${FIN}`), () => 30],
      [new RegExp(`\\s(?:pendant\\s+|durant\\s+|pour\\s+|en\\s+)?un\\s+quart\\s+d'heure${FIN}`), () => 15],
      // « 2 heures 30 », « une heure et demie », « 1h et demie », « 1 h 15 min »
      [new RegExp(`\\s(?:pendant\\s+|durant\\s+|pour\\s+|en\\s+)?(\\d{1,2}|une|deux|trois|quatre|cinq|six)\\s*heures?\\s+(?:et\\s+)?(demie|[0-5]?\\d(?:\\s*min(?:utes?)?)?)${FIN}`),
        (g) => nombre(g[0]) * 60 + (g[1] === "demie" ? 30 : parseInt(g[1], 10))],
      [new RegExp(`\\s(?:pendant\\s+|durant\\s+|pour\\s+|en\\s+)?(\\d{1,2})\\s*h\\s+(?:et\\s+)?(demie|[0-5]?\\d\\s*min(?:utes?)?)${FIN}`),
        (g) => Number(g[0]) * 60 + (g[1] === "demie" ? 30 : parseInt(g[1], 10))],
      [new RegExp(`\\s(?:pendant\\s+|durant\\s+|pour\\s+|en\\s+)?(\\d{1,2}|une|deux|trois|quatre|cinq|six)\\s*heures?${FIN}`), (g) => nombre(g[0]) * 60],
      [new RegExp(`\\s(?:pendant\\s+|durant\\s+|pour\\s+|en\\s+)?(\\d{1,3})\\s*(?:min|mn|minutes?)${FIN}`), (g) => Number(g[0])],
      // « pendant 2h », « en 1h30 » : le mot avant lève l'ambiguïté avec une heure.
      [new RegExp(`\\s(?:pendant|durant|pour|en)\\s+(\\d{1,2})h([0-5]\\d)?${FIN}`), (g) => Number(g[0]) * 60 + Number(g[1] || 0)],
      // « 1 h », « 2 h 30 » : l'espace avant « h » est l'usage pour une durée (« 14h » = une heure de la journée).
      [new RegExp(`\\s(\\d{1,2})\\s+h(?:\\s*([0-5]\\d))?${FIN}`), (g) => Number(g[0]) * 60 + Number(g[1] || 0)],
    ];
    for (const [motif, minutes] of essais) {
      // Une valeur absurde (« 0 min », « 30 heures ») n'est pas prise : elle reste au titre.
      const t = prendre(motif, (g) => minutes(g) > 0 && minutes(g) <= 24 * 60);
      if (t) { dureeMinutes = minutes(t.g); noter("duree", t.texte); break; }
    }
  }

  /* 2c. Les « 14h », « 9h30 », « 14:30 » restants. Une heure collée (« 2h ») est ambiguë :
     on la lit comme une DURÉE si elle fait moins de 4 h et n'est pas précédée de « à »
     (personne ne planifie une tâche à 2 h du matin, mais « Sport 2h » est courant),
     ou si l'heure de la journée est déjà connue (« 14h 2h »). Sinon c'est l'heure. */
  {
    const motif = new RegExp(`\\s(a\\s+)?${HEURE}${FIN}`, "g");
    const plat = aplatir(reste);
    const trouves: { debut: number; fin: number; champ: ChampSaisie; valeur: string | number }[] = [];
    for (let m = motif.exec(plat); m; m = motif.exec(plat)) {
      const [, a, h, mh, mp] = m;
      const commeHeure = !heure && actif("heure") && !trouves.some((x) => x.champ === "heure");
      const commeDuree = dureeMinutes === null && actif("duree") && !trouves.some((x) => x.champ === "duree") && !a && !mp;
      let champ: ChampSaisie | null = null;
      if (commeDuree && (!commeHeure || Number(h) < 4) && Number(h) > 0) champ = "duree";
      else if (commeHeure) champ = "heure";
      if (champ) {
        trouves.push({
          debut: m.index, fin: m.index + m[0].length, champ,
          valeur: champ === "heure" ? versHeure(h, mh || mp) : Number(h) * 60 + Number(mh || 0),
        });
      }
    }
    for (const x of [...trouves].reverse()) { // de la fin vers le début : les positions restent justes
      noter(x.champ, reste.slice(x.debut, x.fin).trim());
      if (x.champ === "heure") heure = x.valeur as string; else dureeMinutes = x.valeur as number;
      reste = `${reste.slice(0, x.debut)} ${reste.slice(x.fin)}`;
    }
  }

  /* ---------- 3. Date ---------- */
  let date: string | null = null;
  if (actif("date")) {
    const essais: [RegExp, () => string][] = [
      [new RegExp(`\\ssans\\s+date${FIN}`), () => ""],
      [new RegExp(`\\sapres[- ]demain${FIN}`), () => versISO(ajouterJours(aujourdhui, 2))],
      [new RegExp(`\\sdemain(?:\\s+(?:matin|soir|midi|apres-midi))?${FIN}`), () => versISO(ajouterJours(aujourdhui, 1))],
      [new RegExp(`\\s(?:aujourd'hui|auj|ce\\s+soir|ce\\s+matin|ce\\s+midi|cet\\s+apres-midi)${FIN}`), () => versISO(aujourdhui)],
      [new RegExp(`\\sce\\s+week-?\\s?end${FIN}`), () => versISO(ajouterJours(aujourdhui, (5 - jourDe(aujourdhui) + 7) % 7))],
    ];
    for (const [motif, calcul] of essais) {
      const t = prendre(motif);
      if (t) { date = calcul(); noter("date", t.texte); break; }
    }
    if (date === null) {
      const t = prendre(new RegExp(`\\s(?:(?:a\\s+partir\\s+de|des|des\\s+le|a\\s+partir\\s+du)\\s+)?(?:ce\\s+|le\\s+)?(${RE_JOUR})(?:\\s+(?:prochain|matin|soir|midi|apres-midi))?${FIN}`));
      if (t) {
        const cible = JOURS.indexOf(t.g[0]);
        date = versISO(ajouterJours(aujourdhui, (cible - jourDe(aujourdhui) + 7) % 7));
        noter("date", t.texte);
      }
    }
  }

  /* ---------- 4. Priorité ---------- */
  let priorite: Priorite | null = null;
  if (actif("priorite")) {
    const essais: [RegExp, Priorite][] = [
      [new RegExp(`\\s(?:en\\s+)?priorite\\s+(?:haute|elevee|max(?:imale)?)${FIN}`), "haute"],
      [new RegExp(`\\s(?:en\\s+)?priorite\\s+(?:moyenne|normale)${FIN}`), "moyenne"],
      [new RegExp(`\\s(?:en\\s+)?priorite\\s+(?:basse|faible)${FIN}`), "basse"],
      [new RegExp(`\\s(?:pas|peu)\\s+(?:tres\\s+|si\\s+)?(?:urgent|important|prioritaire|presse)e?s?${FIN}`), "basse"],
      [new RegExp(`\\s(?:facultatif|facultative|optionnel(?:le)?|si\\s+possible|si\\s+j'ai\\s+le\\s+temps|bonus)${FIN}`), "basse"],
      [new RegExp(`\\s(?:tres\\s+|super\\s+)?(?:important|urgent|prioritaire|essentiel|crucial|indispensable)e?s?${FIN}`), "haute"],
      [new RegExp(`\\s!{1,3}${FIN}`), "haute"],
    ];
    for (const [motif, p] of essais) {
      const t = prendre(motif);
      if (t) { priorite = p; noter("priorite", t.texte); break; }
    }
  }

  /* ---------- 5. Lieu ---------- */
  let lieu = "";
  if (actif("lieu")) {
    const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    const lieux = LIEUX.map((l) => l.replace(/ /g, "\\s+")).join("|");
    const essais: [RegExp, (morceau: string, g: string[]) => string][] = [
      // « @Café_du_coin » : n'importe quel lieu.
      [new RegExp(`\\s@([^\\s,;]+)${FIN}`), (m) => m.slice(1).replace(/_/g, " ")],
      // En ligne.
      [new RegExp(`\\s(?:en|sur)\\s+(ligne|visio|teams|zoom|meet|discord|skype)${FIN}`),
        (m) => m.replace(/^(?:en|sur)\s+/i, "")],
      // « chez Paul », « chez le dentiste », « chez l'orthodontiste »
      [new RegExp(`\\schez\\s+(?:(?:le|la|les|mon|ma|mes|ton|ta)\\s+|l')?[^\\s,;]+${FIN}`), (m) => m],
      // « salle 204 », « en amphi A », « au bâtiment B2 »
      [new RegExp(`\\s(?:(?:a|au|en|dans)\\s+(?:la\\s+|le\\s+|l')?)?${LIEUX_NUMEROTES}\\s+${IDENTIFIANT}${FIN}`),
        (m) => m.replace(/^(?:à|a|au|en|dans)\s+(?:la\s+|le\s+|l['’])?/i, "")],
      // « à la bibliothèque », « au bureau », « à la BU 2 »
      [new RegExp(`\\s(?:a|au|aux|en|dans)\\s+(?:(?:la|le|les)\\s+|l')?(?:${lieux})${FIN}`),
        (m) => m.replace(/^(?:à|a|au|aux|en|dans)\s+(?:(?:la|le|les)\s+|l['’])?/i, "")],
      // « bibliothèque » seule : le seul lieu sans ambiguïté sans « à » (« Réviser bibliothèque »).
      [new RegExp(`\\s(?:bibliotheque|mediatheque|bibli)${FIN}`), (m) => m],
    ];
    for (const [motif, nommer] of essais) {
      const t = prendre(motif);
      if (t) {
        const nom = nommer(t.texte, t.g).trim();
        lieu = SIGLES.has(aplatir(nom)) ? nom.toUpperCase() : majuscule(nom);
        noter("lieu", t.texte);
        break;
      }
    }
  }

  /* ---------- 6. Règle de répétition complète (il faut connaître la date) ----------
     Une tâche répétée a toujours une date de début : la date écrite, sinon aujourd'hui,
     puis on avance jusqu'au premier jour qui colle à la règle (« chaque jeudi » saisi
     un mardi commence jeudi). « sans date » + répétition : la répétition l'emporte. */
  let recurrence: Recurrence | null = null;
  if (regle) {
    let debut = date ? depuisISO(date) : aujourdhui;
    const jourDuMois = regle.jourDuMois;
    if (jourDuMois) {
      // Prochain « le 15 » (ce mois-ci s'il n'est pas passé) ; un 31 tombe en fin de mois court.
      const dans = (a: number, m: number) => new Date(a, m, Math.min(jourDuMois, new Date(a, m + 1, 0).getDate()));
      let d = dans(debut.getFullYear(), debut.getMonth());
      if (d < debut) d = dans(debut.getFullYear(), debut.getMonth() + 1);
      debut = d;
    }
    const jours = regle.frequence === "semaine" && regle.jours?.length ? [...new Set(regle.jours)].sort() : [];
    for (let i = 0; i < 7 && jours.length && !jours.includes(jourDe(debut)); i++) debut = ajouterJours(debut, 1);
    date = versISO(debut);
    recurrence = {
      frequence: regle.frequence, intervalle: regle.intervalle ?? 1,
      joursSemaine: jours.length ? jours : [jourDe(debut)],
      modeMois: "jour", fin: { type: "jamais" }, exceptions: [], faites: [],
    };
  }

  // Titre : ce qui reste, sans espaces doubles ni ponctuation orpheline aux extrémités.
  const titre = reste.replace(/\s+/g, " ").replace(/\s+([,.;!?])/g, "$1").trim()
    .replace(/^[,;:.\-–]+\s*|\s*[,;:\-–]+$/g, "").trim();
  return { titre, date, heure, dureeMinutes, priorite, lieu, recurrence, extraits };
}

/* Durée lisible : 90 → « 1 h 30 », 45 → « 45 min », 120 → « 2 h ». */
export function libelleDuree(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}
