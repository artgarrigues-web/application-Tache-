/* Saisie rapide (prototype ergonomie mobile, option C) : on tape une phrase
   comme « Réviser maths demain 14h » et l'application en tire le titre, la date
   et l'heure. Inspiré de Todoist et Fantastical, en (beaucoup) plus simple :
   seuls les mots les plus courants sont reconnus, le reste devient le titre.

   Reconnu :
   - « aujourd'hui », « auj », « ce soir » (= aujourd'hui), « demain », « après-demain » ;
   - un jour de la semaine (« lundi »… « dimanche ») : le prochain, aujourd'hui compris ;
   - une heure : « 14h », « 14h30 », « 9h05 », « 14:30 » (précédée ou non de « à ») ;
   - « sans date » : la tâche va dans la Checklist.
   Fonction PURE (pas d'accès à l'écran ni à la base) : facile à tester.          */

/* Copies locales de deux petites fonctions de lib/dates.ts : ce fichier reste ainsi sans
   dépendance d'exécution, et les tests (node --test) peuvent le charger tel quel. */
function ajouterJours(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function versISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface SaisieAnalysee {
  titre: string;
  date: string | null;  // "AAAA-MM-JJ", "" = sans date explicite, null = rien trouvé dans le texte
  heure: string;        // "HH:MM" ou ""
}

const JOURS = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

// Minuscules sans accents, pour comparer « Après-demain » et « apres-demain ».
function simplifier(mot: string): string {
  return mot.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function analyserSaisie(texte: string, aujourdhui: Date): SaisieAnalysee {
  let reste = ` ${texte.trim()} `;
  let date: string | null = null;
  let heure = "";

  // 1. L'heure : « (à) 14h30 », « 14h », « 14:30 ».
  reste = reste.replace(/\s(?:à\s+|a\s+)?([01]?\d|2[0-3])(?:h([0-5]\d)?|:([0-5]\d))(?=\s)/i, (_m, h, m1, m2) => {
    heure = `${String(h).padStart(2, "0")}:${m1 ?? m2 ?? "00"}`;
    return " ";
  });

  // 2. La date : on cherche les expressions mot par mot (la première trouvée gagne).
  const expressions: { motif: RegExp; date: () => string }[] = [
    { motif: /\ssans\s+date(?=\s)/i, date: () => "" },
    { motif: /\sapr[eè]s[- ]demain(?=\s)/i, date: () => versISO(ajouterJours(aujourdhui, 2)) },
    { motif: /\sdemain(?=\s)/i, date: () => versISO(ajouterJours(aujourdhui, 1)) },
    { motif: /\s(?:aujourd'hui|aujourd’hui|auj|ce\s+soir|ce\s+matin)(?=\s)/i, date: () => versISO(aujourdhui) },
  ];
  for (const e of expressions) {
    if (e.motif.test(reste)) {
      date = e.date();
      reste = reste.replace(e.motif, " ");
      break;
    }
  }
  if (date === null) {
    reste = reste.replace(/\s(?:ce\s+|le\s+)?(lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)(?=\s)/i, (_m, jour) => {
      const cible = JOURS.indexOf(simplifier(jour));
      const actuel = (aujourdhui.getDay() + 6) % 7; // 0 = lundi
      date = versISO(ajouterJours(aujourdhui, (cible - actuel + 7) % 7));
      return " ";
    });
  }

  const titre = reste.replace(/\s+/g, " ").trim();
  return { titre, date, heure };
}
