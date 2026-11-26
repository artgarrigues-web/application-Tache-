/* File d'attente des modifications faites HORS CONNEXION (partie « pure » : aucun accès
   au réseau ni au navigateur, donc testable seule, voir tests/file-attente.test.ts).

   Principe : quand le réseau manque, chaque écriture (créer, modifier, supprimer une ligne)
   est rangée dans une liste ordonnée, la « file ». Au retour du réseau, on la rejoue dans
   l'ordre. Trois idées rendent ce rejeu sûr :

   1. Une opération = UNE ligne d'UNE table (identifiée par son id). Les identifiants des
      nouvelles lignes sont créés par l'application (crypto.randomUUID) : une tâche créée
      dans le métro a déjà son id définitif, on peut donc la modifier ou la supprimer
      avant même qu'elle soit envoyée.
   2. Compactage : plusieurs changements de la même ligne fusionnent en un seul
      (créer puis modifier = créer avec les bonnes valeurs ; créer puis supprimer = rien).
   3. Conflits : pour chaque champ modifié, on retient sa valeur AVANT le changement.
      Au rejeu, si la base a une autre valeur que celle-ci, quelqu'un (l'autre appareil)
      l'a changée entre-temps → règle de la « dernière modification gagne », champ par
      champ, avec un avertissement (voir resoudre()).                                    */

export type Table = "taches" | "idees" | "projets_idees";
export type Valeurs = Record<string, unknown>;
export type Ligne = Valeurs & { id: string };

export interface Operation {
  cle: string;                 // identifiant unique de l'opération (pour la retirer après envoi)
  table: Table;
  type: "inserer" | "modifier" | "supprimer";
  id: string;                  // id de la ligne concernée
  valeurs?: Valeurs;           // inserer : ligne complète ; modifier : seulement les champs changés
  avant?: Valeurs;             // modifier : valeur de chaque champ AVANT le premier changement hors ligne
  quand: Record<string, string>; // modifier : heure (ISO) du dernier changement de chaque champ ; sinon { "*": heure }
}

/* ---------- Comparaison de valeurs ----------
   La base renvoie les heures sous la forme "14:00:00" alors que l'application envoie "14:00" :
   on les normalise avant de comparer, sinon une heure inchangée passerait pour un conflit. */
function normaliser(v: unknown): unknown {
  if (v === undefined || v === "") return null;  // "" (champ vide) et null veulent dire la même chose
  if (typeof v === "string" && /^\d{2}:\d{2}:00$/.test(v)) return v.slice(0, 5);
  if (Array.isArray(v)) return v.map(normaliser);
  if (v && typeof v === "object") {
    const o: Valeurs = {};
    for (const k of Object.keys(v as Valeurs).sort()) o[k] = normaliser((v as Valeurs)[k]);
    return o;
  }
  return v;
}

export function egal(a: unknown, b: unknown): boolean {
  return JSON.stringify(normaliser(a)) === JSON.stringify(normaliser(b));
}

/* ---------- Ajout dans la file, avec compactage ----------
   ligneAvant : la ligne telle que l'appareil la connaît AVANT ce changement (ou null).
   Renvoie la nouvelle file (la file reçue n'est pas modifiée). */
export function enfiler(
  file: Operation[],
  op: Omit<Operation, "cle" | "quand" | "avant">,
  ligneAvant: Valeurs | null,
  maintenant: string,
  cle: string,
): Operation[] {
  const memeLigne = (o: Operation) => o.table === op.table && o.id === op.id;
  const derniere = [...file].reverse().find(memeLigne);

  if (op.type === "inserer") {
    return [...file, { ...op, cle, quand: { "*": maintenant } }];
  }

  if (op.type === "supprimer") {
    // Ligne créée hors ligne puis supprimée : la base n'en saura jamais rien.
    if (file.some((o) => memeLigne(o) && o.type === "inserer")) return file.filter((o) => !memeLigne(o));
    if (derniere?.type === "supprimer") return file;
    return [...file.filter((o) => !memeLigne(o)), { ...op, cle, quand: { "*": maintenant } }];
  }

  // Modifier : on ne garde que les champs qui changent vraiment.
  const changes: Valeurs = {};
  for (const [k, v] of Object.entries(op.valeurs ?? {})) {
    if (!ligneAvant || !(k in ligneAvant) || !egal(ligneAvant[k], v)) changes[k] = v;
  }
  if (Object.keys(changes).length === 0) return file;
  if (derniere?.type === "supprimer") return file; // modifier une ligne déjà supprimée : sans effet

  if (derniere?.type === "inserer") {
    // Pas encore envoyée : on corrige directement les valeurs de la création.
    return file.map((o) => (o === derniere ? { ...o, valeurs: { ...o.valeurs, ...changes } } : o));
  }

  const quand: Record<string, string> = {};
  for (const k of Object.keys(changes)) quand[k] = maintenant;

  if (derniere?.type === "modifier") {
    const avant = { ...derniere.avant };
    if (ligneAvant) for (const k of Object.keys(changes)) if (!(k in avant) && k in ligneAvant) avant[k] = ligneAvant[k];
    return file.map((o) => (o === derniere
      ? { ...o, valeurs: { ...o.valeurs, ...changes }, avant, quand: { ...o.quand, ...quand } }
      : o));
  }

  const avant: Valeurs = {};
  if (ligneAvant) for (const k of Object.keys(changes)) if (k in ligneAvant) avant[k] = ligneAvant[k];
  return [...file, { ...op, valeurs: changes, avant, quand, cle }];
}

/* Applique une opération à une copie locale des lignes (prévision de ce que la base
   contiendra une fois la file envoyée). Les champs remplis par la base (cree_le, faite…)
   reçoivent une valeur par défaut. */
export function appliquer(lignes: Map<string, Ligne>, op: Operation, maintenant: string): void {
  if (op.type === "supprimer") { lignes.delete(op.id); return; }
  if (op.type === "inserer") {
    lignes.set(op.id, { faite: false, cree_le: maintenant, ...op.valeurs, id: op.id });
    return;
  }
  const l = lignes.get(op.id);
  if (l) lignes.set(op.id, { ...l, ...op.valeurs });
}

/* ---------- Fusion « à trois » ----------
   base = valeur avant mon changement, mien = ma valeur, autre = valeur actuelle en base.
   - si un seul des deux côtés a changé, on garde ce changement (aucun conflit) ;
   - listes de textes (jours cochés d'une répétition, matériel pris…) : on combine les ajouts
     et retraits des deux côtés ;
   - listes d'objets avec un id (étapes d'une tâche…) : fusion élément par élément ;
   - objets : fusion clé par clé ;
   - sinon (deux valeurs simples différentes) : vrai conflit, tranché par « prefere ».     */
export interface Fusion { valeur: unknown; conflit: boolean }

const estObjet = (v: unknown): v is Valeurs => !!v && typeof v === "object" && !Array.isArray(v);
const aUnId = (v: unknown): v is Valeurs & { id: string } => estObjet(v) && typeof v.id === "string";

export function fusionner3(base: unknown, mien: unknown, autre: unknown, prefere: "mien" | "autre"): Fusion {
  if (egal(mien, autre)) return { valeur: mien, conflit: false };
  if (egal(mien, base)) return { valeur: autre, conflit: false };
  if (egal(autre, base)) return { valeur: mien, conflit: false };

  if (Array.isArray(mien) && Array.isArray(autre)) {
    const b = Array.isArray(base) ? base : [];
    const tous = [...b, ...mien, ...autre];
    if (tous.every((x) => x === null || typeof x !== "object")) {
      const dans = (liste: unknown[], x: unknown) => liste.some((y) => egal(x, y));
      const gardes = autre.filter((x) => !(dans(b, x) && !dans(mien, x)));      // retirés par moi
      const ajoutes = mien.filter((x) => !dans(b, x) && !dans(autre, x));       // ajoutés par moi
      return { valeur: [...gardes, ...ajoutes], conflit: false };
    }
    if (tous.every(aUnId)) {
      const parId = (liste: unknown[]) => new Map((liste as (Valeurs & { id: string })[]).map((x) => [x.id, x]));
      const B = parId(b), M = parId(mien), A = parId(autre);
      const ordre = [...A.keys(), ...[...M.keys()].filter((id) => !A.has(id))];
      let conflit = false;
      const valeur: unknown[] = [];
      for (const id of ordre) {
        const eb = B.get(id), em = M.get(id), ea = A.get(id);
        if (em && ea) {
          const f = fusionner3(eb, em, ea, prefere);
          conflit ||= f.conflit;
          valeur.push(f.valeur);
        } else if (ea) {                       // absent chez moi
          if (!eb) valeur.push(ea);            // ajouté ailleurs
          else if (!egal(ea, eb)) { conflit = true; if (prefere === "autre") valeur.push(ea); } // je l'ai retiré, l'autre l'a changé
        } else if (em) {                       // absent en base
          if (!eb) valeur.push(em);            // ajouté par moi
          else if (!egal(em, eb)) { conflit = true; if (prefere === "mien") valeur.push(em); }
        }
      }
      return { valeur, conflit };
    }
  }

  if (estObjet(mien) && estObjet(autre)) {
    const b = estObjet(base) ? base : {};
    let conflit = false;
    const valeur: Valeurs = {};
    for (const k of new Set([...Object.keys(autre), ...Object.keys(mien)])) {
      const inM = k in mien, inA = k in autre, inB = k in b;
      let f: Fusion;
      if (inM && inA) f = fusionner3(b[k], mien[k], autre[k], prefere);
      else if (inA) f = inB && egal(b[k], autre[k]) ? { valeur: undefined, conflit: false } : { valeur: autre[k], conflit: inB };
      else f = inB && egal(b[k], mien[k]) ? { valeur: undefined, conflit: false } : { valeur: mien[k], conflit: inB };
      conflit ||= f.conflit;
      if (f.valeur !== undefined) valeur[k] = f.valeur;
    }
    return { valeur, conflit };
  }

  return { valeur: prefere === "mien" ? mien : autre, conflit: true };
}

/* ---------- Résolution d'une modification au moment de l'envoi ----------
   serveur : la ligne telle qu'elle est en base maintenant ;
   modifieLeServeur : heure de sa dernière modification en base (colonne modifie_le),
   inconnue si la migration n'a pas été appliquée.

   RÈGLE : champ par champ, la modification la plus RÉCENTE gagne.
   - le champ n'a pas bougé en base depuis que je l'ai lu → j'envoie ma valeur ;
   - il a bougé des deux côtés → on fusionne si c'est possible (listes, étapes) ;
     sinon, si la base a été modifiée APRÈS mon changement, je garde la sienne,
     sinon j'envoie la mienne. Dans les deux cas : avertissement.                   */
export interface Resolution {
  aEnvoyer: Valeurs;                                      // champs à écrire en base (peut être vide)
  conflits: { champ: string; gagnant: "moi" | "autre" }[];
}

export function resoudre(op: Operation, serveur: Valeurs, modifieLeServeur: string | null): Resolution {
  const aEnvoyer: Valeurs = {};
  const conflits: Resolution["conflits"] = [];
  for (const [champ, mien] of Object.entries(op.valeurs ?? {})) {
    if (!op.avant || !(champ in op.avant) || !(champ in serveur)) { aEnvoyer[champ] = mien; continue; }
    const base = op.avant[champ], autre = serveur[champ];
    if (egal(autre, base)) { aEnvoyer[champ] = mien; continue; }  // personne d'autre n'y a touché
    if (egal(autre, mien)) continue;                                // même changement des deux côtés
    // Heures comparées en millisecondes (la base écrit "…+00:00", le navigateur "…Z").
    const tServeur = modifieLeServeur ? Date.parse(modifieLeServeur) : NaN;
    const tMoi = Date.parse(op.quand[champ] ?? "");
    const prefere = tServeur > tMoi ? "autre" : "mien";
    const f = fusionner3(base, mien, autre, prefere);
    if (!egal(f.valeur, autre)) aEnvoyer[champ] = f.valeur;
    if (f.conflit) conflits.push({ champ, gagnant: prefere === "mien" ? "moi" : "autre" });
  }
  return { aEnvoyer, conflits };
}
