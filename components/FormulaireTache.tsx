"use client";

/* Fenêtre d'ajout / de modification d'une tâche (élément HTML natif <dialog>).
   Le composant n'existe que lorsque la fenêtre est ouverte : Agenda l'affiche
   ou non. À son apparition, useEffect appelle showModal() pour l'ouvrir.

   Les champs sont "contrôlés" : leur valeur vient de l'état React (valeurs),
   et chaque frappe met cet état à jour via onChange.                         */

import { useEffect, useRef, useState, type FormEvent } from "react";
import { aujourdhui, versISO } from "@/lib/dates";
import { groupesAutomatiques, listeMateriel } from "@/lib/taches";
import { dateLongue, jourSemaine, normaliserRecurrence, premiereOccurrence } from "@/lib/recurrence";
import { etapesDisponibles, rappelsDisponibles, recurrenceDisponible } from "@/lib/depot";
import { CHOIX_RAPPEL, HEURE_SANS_HEURE, libelleRappel } from "@/lib/rappels";
import { Bell, BellOff } from "lucide-react";
import { IconeAucune, IconeDeplier, IconeOptions, IconeRepeter, IconeValide } from "./Icones";
import { ChampRepetition } from "./ChampRepetition";
import { EditeurListe, type ElementListe } from "./ListesCochables";
import { cleMateriel, creerEtape, MAX_ETAPES, nettoyer, nouvelIdEtape } from "@/lib/etapes";
import { COULEURS, GROUPES, type Categorie, type Couleur, type DonneesTache, type Groupe, type Portee, type Priorite, type Tache } from "@/lib/types";

// Les trois portées possibles quand on ouvre UNE occurrence d'une tâche répétée.
const PORTEES: { id: Portee; libelle: string }[] = [
  { id: "occurrence", libelle: "Ce jour seulement" },
  { id: "suivantes", libelle: "Ce jour et les suivants" },
  { id: "serie", libelle: "Toute la série" },
];

interface Props {
  tache: Tache | null;                  // null = nouvelle tâche ; pour une occurrence : la SÉRIE
  occurrence?: string;                  // date de l'occurrence ouverte (tâche répétée)
  dateParDefaut: string;
  categorieParDefaut: Categorie;
  brouillon?: Partial<DonneesTache>;    // nouvelle tâche pré-remplie (ajout en une phrase → « Corriger »)
  onEnregistrer: (d: DonneesTache, portee: Portee) => Promise<boolean>;
  onSupprimer: (portee: Portee) => Promise<boolean>;
  onFermer: () => void;
  rappelDefaut?: number | null;        // rappel proposé quand on donne une heure à une nouvelle tâche
  notificationsActives?: boolean;      // cet appareil reçoit-il les rappels ?
  onReglerRappels?: () => void;        // ouvre la fenêtre « Rappels et notifications »
}

export function FormulaireTache({ tache, occurrence, dateParDefaut, categorieParDefaut, brouillon, onEnregistrer, onSupprimer, onFermer,
  rappelDefaut = null, notificationsActives = false, onReglerRappels }: Props) {
  const dialogue = useRef<HTMLDialogElement>(null);
  /* Occurrence d'une tâche répétée : on choisit d'abord ce que vise la modification.
     Par défaut « ce jour seulement », le choix le moins risqué. */
  const estOccurrence = Boolean(tache?.recurrence && occurrence);
  const [portee, setPortee] = useState<Portee>("occurrence");
  const [enCours, setEnCours] = useState(false);
  /* Mode "simple" ou "complet".
     - Nouvelle tâche : simple (titre, date, heure) ; le bouton en bas à droite
       ("Plus d'options") déplie les autres champs.
     - Modification d'une tâche existante : complet d'emblée, pour tout voir.
     Replier ne vide pas les champs : leurs valeurs restent dans "valeurs"
     et sont enregistrées (valeurs par défaut si on n'y a pas touché). */
  // Pré-rempli depuis une phrase avec des détails (durée, lieu…) : complet aussi, pour les voir.
  const [complet, setComplet] = useState(tache !== null || Boolean(
    brouillon && (brouillon.dureeMinutes || brouillon.lieu || brouillon.recurrence || (brouillon.priorite && brouillon.priorite !== "moyenne"))));
  const [valeurs, setValeurs] = useState<DonneesTache>(() =>
    tache
      ? {
          titre: tache.titre, description: tache.description, date: occurrence ?? tache.date, heure: tache.heure,
          dureeMinutes: tache.dureeMinutes, lieu: tache.lieu, echeance: tache.echeance, materiel: tache.materiel,
          categorie: tache.categorie, priorite: tache.priorite, groupe: tache.groupe, couleur: tache.couleur,
          recurrence: tache.recurrence, projetId: tache.projetId, rappelMinutes: tache.rappelMinutes,
          etapes: tache.etapes ?? [], materielPris: tache.materielPris ?? [],
        }
      : {
          titre: "", description: "", date: dateParDefaut, heure: "",
          dureeMinutes: null, lieu: "", echeance: "", materiel: "",
          categorie: categorieParDefaut, priorite: "moyenne", groupe: null, couleur: null, recurrence: null, projetId: null, rappelMinutes: null,
          etapes: [], materielPris: [],
          ...brouillon,
          ...(brouillon?.heure ? { rappelMinutes: rappelDefaut } : {}),
        },
  );

  /* Rappel : pour une NOUVELLE tâche, le rappel par défaut (réglé dans « Rappels et
     notifications ») est proposé dès qu'on lui donne une heure, tant qu'on n'a pas
     choisi soi-même dans la liste. */
  const rappelChoisi = useRef(tache !== null);
  function changerHeure(heure: string) {
    setValeurs((v) => ({ ...v, heure, rappelMinutes: rappelChoisi.current ? v.rappelMinutes : heure ? rappelDefaut : null }));
  }
  const choixRappel = CHOIX_RAPPEL.some((c) => c.minutes === valeurs.rappelMinutes) || valeurs.rappelMinutes === null
    ? CHOIX_RAPPEL : [...CHOIX_RAPPEL, { minutes: valeurs.rappelMinutes, libelle: libelleRappel(valeurs.rappelMinutes), court: "" }];

  /* Tâche sans date (checklist) : date = "" et pas d'heure.
     On garde la dernière date saisie pour la remettre si on décoche la case. */
  const sansDate = valeurs.date === "";
  const derniereDate = useRef(valeurs.date || dateParDefaut || versISO(aujourdhui()));
  function basculerSansDate(coche: boolean) {
    if (coche) {
      if (valeurs.date) derniereDate.current = valeurs.date;
      setValeurs((v) => ({ ...v, date: "", heure: "" }));
    } else {
      changer("date", derniereDate.current);
    }
  }

  /* La durée est stockée en minutes, mais saisie en heures + minutes (plus naturel).
     On recalcule les deux champs affichés à partir de dureeMinutes… */
  const dureeHeures = valeurs.dureeMinutes ? Math.floor(valeurs.dureeMinutes / 60) : "";
  const dureeMin = valeurs.dureeMinutes ? valeurs.dureeMinutes % 60 : "";
  // … et inversement, à chaque saisie, on recombine les deux en minutes (0 → pas de durée).
  function changerDuree(heures: number, minutes: number) {
    const total = (heures || 0) * 60 + (minutes || 0);
    changer("dureeMinutes", total > 0 ? total : null);
  }

  // Aperçu de ce que donnerait le mode "Automatique" avec les valeurs saisies en ce moment.
  const auto = groupesAutomatiques(valeurs);
  const texteAuto = auto.length
    ? auto.map((id) => GROUPES.find((g) => g.id === id)!.libelle).join(" + ")
    : "aucun groupe";

  // Nombre de détails (champs repliables) déjà remplis, affiché sur la pastille quand elle est fermée.
  const nbDetails = [
    valeurs.description.trim(), valeurs.dureeMinutes, valeurs.lieu.trim(), valeurs.echeance,
    valeurs.materiel.trim(), valeurs.etapes?.length, valeurs.groupe, valeurs.priorite !== "moyenne", valeurs.recurrence && !sansDate,
  ].filter(Boolean).length;

  /* Changer de portée change la date affichée : la date de l'occurrence pour « ce jour »
     et « les suivants », la date de DÉBUT de la série pour « toute la série ». */
  function changerPortee(p: Portee) {
    setPortee(p);
    if (!tache || !occurrence) return;
    changer("date", p === "serie" ? tache.date : occurrence);
  }

  /* Changer la date d'une répétition hebdomadaire « un seul jour » suit la nouvelle date
     (une tâche du mardi déplacée au jeudi devient « chaque jeudi »). */
  function changerDate(date: string) {
    setValeurs((v) => {
      const r = v.recurrence;
      if (r && r.frequence === "semaine" && date && v.date && r.joursSemaine.length === 1 && r.joursSemaine[0] === jourSemaine(v.date)) {
        return { ...v, date, recurrence: { ...r, joursSemaine: [jourSemaine(date)] } };
      }
      return { ...v, date };
    });
  }
  // La répétition ne se règle pas pour « ce jour seulement » (il devient une tâche à part).
  const repetitionModifiable = !sansDate && !(estOccurrence && portee === "occurrence");

  /* Étapes et matériel : les cases se cochent ici seulement pour une tâche UNIQUE.
     Une tâche répétée a une case par jour : on la coche sur la carte du jour voulu. */
  const repetee = Boolean(valeurs.recurrence && !sansDate && !(estOccurrence && portee === "occurrence"));
  const elementsEtapes: ElementListe[] = (valeurs.etapes ?? []).map((e) => ({ cle: e.id, texte: e.texte, coche: e.faite }));
  const lignesMateriel = valeurs.materiel === "" ? [] : valeurs.materiel.split("\n");
  const pris = new Set(valeurs.materielPris ?? []);
  const elementsMateriel: ElementListe[] = lignesMateriel.map((texte, i) => ({ cle: String(i), texte, coche: pris.has(cleMateriel(texte)) }));
  const [brouillonEtape, setBrouillonEtape] = useState("");
  const [brouillonMateriel, setBrouillonMateriel] = useState("");
  function changerEtapes(liste: ElementListe[]) {
    changer("etapes", liste.map((e) => ({ id: e.cle, texte: e.texte, faite: e.coche })));
  }
  function changerMateriel(liste: ElementListe[]) {
    setValeurs((v) => ({
      ...v,
      materiel: liste.map((e) => e.texte.replace(/\n/g, " ")).join("\n").slice(0, 2000),
      materielPris: [...new Set(liste.filter((e) => e.coche && e.texte.trim()).map((e) => cleMateriel(e.texte)))],
    }));
  }

  useEffect(() => {
    const d = dialogue.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Petite fonction générique pour mettre à jour un seul champ.
  function changer<K extends keyof DonneesTache>(champ: K, valeur: DonneesTache[K]) {
    setValeurs((v) => ({ ...v, [champ]: valeur }));
  }

  async function soumettre(e: FormEvent) {
    e.preventDefault(); // empêche le rechargement de la page
    // Texte tapé dans « Ajouter une étape / un élément » sans Entrée : on l'ajoute quand même.
    const etapesSaisies = [...(valeurs.etapes ?? []), ...(brouillonEtape.trim() ? [creerEtape(brouillonEtape)] : [])];
    const materielSaisi = [valeurs.materiel, brouillonMateriel.trim()].filter(Boolean).join("\n");
    const donnees = {
      ...valeurs,
      titre: valeurs.titre.trim(),
      description: valeurs.description.trim(),
      lieu: valeurs.lieu.trim(),
      materiel: listeMateriel(materielSaisi).join("\n"), // retire les lignes vides
    };
    Object.assign(donnees, nettoyer(etapesSaisies, donnees.materiel, valeurs.materielPris ?? []));
    if (!donnees.titre) return;
    if (!donnees.date || (estOccurrence && portee === "occurrence")) {
      donnees.recurrence = null; // sans date, ou jour devenu tâche à part : pas de répétition
    } else if (donnees.recurrence) {
      // Règle « propre », et date de début calée sur la règle (ex. : 1er jour choisi de la semaine).
      donnees.recurrence = normaliserRecurrence(donnees.recurrence, donnees.date);
      donnees.date = premiereOccurrence(donnees.date, donnees.recurrence);
    }
    setEnCours(true);
    const ok = await onEnregistrer(donnees, estOccurrence ? portee : "serie");
    setEnCours(false);
    if (ok) dialogue.current?.close();
  }

  async function supprimer() {
    setEnCours(true);
    const ok = await onSupprimer(estOccurrence ? portee : "serie");
    setEnCours(false);
    if (ok) dialogue.current?.close();
  }

  return (
    <dialog ref={dialogue} aria-labelledby="titre-dialogue" onClose={onFermer}>
      <form className="formulaire" onSubmit={soumettre}>
        <h2 id="titre-dialogue">{tache ? "Modifier la tâche" : "Nouvelle tâche"}</h2>

        {/* Occurrence d'une tâche répétée : que vise la modification (ou la suppression) ? */}
        {estOccurrence && occurrence && (
          <fieldset className="portee-serie">
            <legend><IconeRepeter /> Tâche répétée — occurrence du {dateLongue(occurrence)}. Modifier :</legend>
            <div className="choix-pastilles" role="radiogroup">
              {PORTEES.map((p) => (
                <label key={p.id} className="choix-pastille">
                  <input type="radio" name="portee" checked={portee === p.id} onChange={() => changerPortee(p.id)} />
                  <span>{p.libelle}</span>
                </label>
              ))}
            </div>
            <p className="indice">
              {portee === "occurrence" && "Seul ce jour change ; il devient une tâche à part et ne suivra plus les changements de la série."}
              {portee === "suivantes" && "La série s'arrête la veille et une nouvelle série démarre ce jour-là avec tes changements."}
              {portee === "serie" && "Tous les jours de la série changent, passés compris. La date ci-dessous est celle du début de la série."}
            </p>
          </fieldset>
        )}

        <div className="champ">
          <label htmlFor="champ-titre">Titre *</label>
          <input id="champ-titre" type="text" required maxLength={120} autoFocus
            placeholder="Ex. : Rendre le TP de mécanique"
            value={valeurs.titre} onChange={(e) => changer("titre", e.target.value)} />
        </div>

        {/* Case « Sans date » toujours visible, même en mode simple (demande d'Arthur du 24/11) :
            on peut créer une tâche de Checklist depuis n'importe quelle vue, sans descendre
            jusqu'au bouton « Ajouter une tâche sans date ». Cocher masque la date et l'heure. */}
        <label className="case-sans-date">
          <input type="checkbox" checked={sansDate} onChange={(e) => basculerSansDate(e.target.checked)} />
          Sans date ni heure (checklist)
        </label>

        {!sansDate && <div className="ligne-champs">
          <div className="champ">
            <label htmlFor="champ-date">{estOccurrence && portee === "serie" ? "Début de la série *" : "Date *"}</label>
            <input id="champ-date" type="date" required
              value={valeurs.date} onChange={(e) => changerDate(e.target.value)} />
          </div>
          <div className="champ">
            <label htmlFor="champ-heure">Heure (facultative)</label>
            <input id="champ-heure" type="time"
              value={valeurs.heure} onChange={(e) => changerHeure(e.target.value)} />
          </div>
        </div>}

        {!sansDate && rappelsDisponibles() && (
          <div className="champ champ-rappel">
            <label htmlFor="champ-rappel">Rappel</label>
            <div className="ligne-rappel">
              <span className={`icone-champ${valeurs.rappelMinutes !== null ? " actif" : ""}`} aria-hidden="true">
                {valeurs.rappelMinutes !== null ? <Bell /> : <BellOff />}
              </span>
              <select id="champ-rappel" value={valeurs.rappelMinutes ?? ""}
                onChange={(e) => { rappelChoisi.current = true; changer("rappelMinutes", e.target.value === "" ? null : Number(e.target.value)); }}>
                <option value="">Aucun rappel</option>
                {choixRappel.map((c) => <option key={c.minutes} value={c.minutes}>{c.libelle}</option>)}
              </select>
            </div>
            {valeurs.rappelMinutes !== null && (
              <p className="indice indice-rappel">
                {!valeurs.heure && `Sans heure, le rappel se base sur ${HEURE_SANS_HEURE.replace(":", " h ").replace(" 00", "")}. `}
                {!notificationsActives && onReglerRappels && (
                  <>Les rappels ne sont pas activés sur cet appareil. <button type="button" className="lien" onClick={onReglerRappels}>Activer</button></>
                )}
              </p>
            )}
          </div>
        )}

        {/* Palette de couleurs : visible dès le mode simple.
            Ce sont de vrais boutons radio (un seul choix possible), cachés visuellement
            et remplacés par des pastilles rondes : le clavier (flèches) et les lecteurs
            d'écran fonctionnent comme pour n'importe quel groupe de boutons radio. */}
        <fieldset className="palette">
          <legend>Couleur</legend>
          <div className="palette-pastilles">
            <label className="pastille-couleur sans-couleur" title="Aucune couleur">
              <input type="radio" name="couleur" value="" checked={valeurs.couleur === null}
                onChange={() => changer("couleur", null)} />
              <span className="rond" aria-hidden="true"><IconeAucune /></span>
              <span className="visuellement-cache">Aucune</span>
            </label>
            {COULEURS.map((c) => (
              <label key={c.id} className={`pastille-couleur couleur-${c.id}`} title={c.libelle}>
                <input type="radio" name="couleur" value={c.id} checked={valeurs.couleur === c.id}
                  onChange={() => changer("couleur", c.id as Couleur)} />
                <span className="rond" aria-hidden="true"><IconeValide /></span>
                <span className="visuellement-cache">{c.libelle}</span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* Champs supplémentaires : toujours dans la page, mais repliés.
            L'animation d'ouverture vient du CSS (.options-sup, grille 0fr → 1fr).
            "inert" rend les champs repliés inaccessibles au clavier (Tab) et aux lecteurs d'écran. */}
        <div id="options-sup" className={`options-sup${complet ? " ouvert" : ""}`} inert={!complet}>
        <div className="options-sup-contenu">
        {repetitionModifiable
          ? <ChampRepetition valeur={valeurs.recurrence} date={valeurs.date}
              onChange={(r) => changer("recurrence", r)} indisponible={!recurrenceDisponible()} />
          : sansDate && <p className="indice repetition-impossible"><IconeRepeter /> Choisis une date pour pouvoir répéter la tâche.</p>}

        <div className="champ">
          <label htmlFor="champ-description">Description</label>
          <textarea id="champ-description" rows={3} placeholder="Détails, liens…"
            value={valeurs.description} onChange={(e) => changer("description", e.target.value)} />
        </div>

        <div className="champ">
          <label htmlFor="champ-etapes">Étapes <span className="indice">
            {repetee ? "(la liste vaut pour toute la série ; les cases se cochent jour par jour, sur la carte)" : "(sous-tâches à cocher une par une)"}
          </span></label>
          {etapesDisponibles()
            ? <EditeurListe id="champ-etapes" elements={elementsEtapes} onChange={changerEtapes} creerCle={nouvelIdEtape}
                cochable={!repetee} placeholder="Ajouter une étape" nomElement="l'étape" max={MAX_ETAPES}
                brouillon={brouillonEtape} onBrouillon={setBrouillonEtape} />
            : <p className="indice">Les étapes seront disponibles dès que la base de données aura été mise à jour.</p>}
        </div>

        <div className="ligne-champs">
          <div className="champ">
            <label htmlFor="champ-duree-h">Durée estimée</label>
            <div className="duree-champs">
              <input id="champ-duree-h" type="number" min={0} max={168} inputMode="numeric" placeholder="0"
                aria-label="Heures" value={dureeHeures}
                onChange={(e) => changerDuree(Number(e.target.value), Number(dureeMin))} />
              <span>h</span>
              <input id="champ-duree-m" type="number" min={0} max={59} step={5} inputMode="numeric" placeholder="0"
                aria-label="Minutes" value={dureeMin}
                onChange={(e) => changerDuree(Number(dureeHeures), Math.min(59, Number(e.target.value)))} />
              <span>min</span>
            </div>
          </div>
          <div className="champ">
            <label htmlFor="champ-lieu">Lieu</label>
            <input id="champ-lieu" type="text" maxLength={200} placeholder="Ex. : Bâtiment B, salle 204"
              value={valeurs.lieu} onChange={(e) => changer("lieu", e.target.value)} />
          </div>
        </div>

        <div className="champ">
          <label htmlFor="champ-echeance">Échéance <span className="indice">(facultative : « à faire avant le… », utilisée par la planification automatique)</span></label>
          <input id="champ-echeance" type="date"
            value={valeurs.echeance} onChange={(e) => changer("echeance", e.target.value)} />
        </div>

        <div className="champ">
          <label htmlFor="champ-materiel">Matériel nécessaire <span className="indice">(Entrée pour ajouter ; une liste collée donne un élément par ligne)</span></label>
          <EditeurListe id="champ-materiel" elements={elementsMateriel} onChange={changerMateriel}
            creerCle={() => String(lignesMateriel.length)} cochable={!repetee && etapesDisponibles()}
            placeholder="Ex. : Calculatrice" nomElement="l'élément" max={40}
            brouillon={brouillonMateriel} onBrouillon={setBrouillonMateriel} />
        </div>

        <div className="ligne-champs">
          <div className="champ">
            <label htmlFor="champ-categorie">Catégorie</label>
            <select id="champ-categorie" value={valeurs.categorie}
              onChange={(e) => changer("categorie", e.target.value as Categorie)}>
              <option value="perso">Personnel</option>
              <option value="travail">Travail</option>
              <option value="projets">Projets</option>
            </select>
          </div>
          <div className="champ">
            <label htmlFor="champ-priorite">Priorité</label>
            <select id="champ-priorite" value={valeurs.priorite}
              onChange={(e) => changer("priorite", e.target.value as Priorite)}>
              <option value="haute">Haute</option>
              <option value="moyenne">Moyenne</option>
              <option value="basse">Basse</option>
            </select>
          </div>
        </div>

        <div className="champ">
          <label htmlFor="champ-groupe">Groupe <span className="indice">(onglet Tri)</span></label>
          <select id="champ-groupe" value={valeurs.groupe ?? ""}
            onChange={(e) => changer("groupe", (e.target.value || null) as Groupe | null)}>
            <option value="">Automatique (actuellement : {texteAuto})</option>
            {GROUPES.map((g) => <option key={g.id} value={g.id}>{g.libelle}</option>)}
          </select>
        </div>
        </div>
        </div>

        {/* Séparateur fin avec, à droite, la pastille qui déplie / replie les détails.
            Repliée, elle affiche le nombre de détails déjà remplis (ex. en revenant en arrière). */}
        <div className="bascule-options">
          <button type="button" className={`pastille-options${complet ? " ouvert" : ""}`}
            aria-expanded={complet} aria-controls="options-sup"
            onClick={() => setComplet((c) => !c)}>
            <IconeOptions />
            <span>{complet ? "Moins de détails" : "Plus de détails"}</span>
            {!complet && nbDetails > 0 && <span className="pastille-compte" aria-label={`${nbDetails} rempli(s)`}>{nbDetails}</span>}
            <IconeDeplier className="chevron" />
          </button>
        </div>

        <div className="boutons-dialogue">
          {tache && (
            <button type="button" className="btn btn-danger" id="btn-supprimer-dialogue" disabled={enCours} onClick={supprimer}>
              {estOccurrence ? (portee === "occurrence" ? "Supprimer ce jour" : portee === "suivantes" ? "Supprimer ce jour et les suivants" : "Supprimer la série") : "Supprimer"}
            </button>
          )}
          <button type="button" className="btn" onClick={() => dialogue.current?.close()}>Annuler</button>
          <button type="submit" className="btn btn-principal" disabled={enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
