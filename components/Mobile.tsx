"use client";

/* =====================================================================
   PROTOTYPE — ergonomie sur téléphone (25/11/2026)
   Trois façons d'organiser l'application sur un petit écran, à comparer
   avant d'en garder une. Rien ne change sur ordinateur, ni sur téléphone
   tant qu'on n'a pas choisi une option dans l'adresse :
     ?mobile=a  barre d'onglets en bas + bouton « + » (Google Agenda, TickTick)
     ?mobile=b  bandeau de la semaine + journée détaillée (Apple Calendrier, Fantastical)
     ?mobile=c  fil « À venir » continu + gestes de balayage + saisie rapide (Todoist, Things)
     ?mobile=aucune  revient à l'affichage actuel
   Le choix est mémorisé dans le navigateur (localStorage) : inutile de le
   remettre dans l'adresse à chaque visite.

   Socle commun aux trois options (voir « .mobile » dans globals.css) :
   en-tête sur une seule ligne, filtres repliés derrière la loupe, cartes
   allégées (badges « Priorité moyenne » et catégorie retirés, le bord coloré
   suffit), formulaire en « feuille » qui monte du bas de l'écran, et les
   actions rares (synchro, export, déconnexion…) rangées dans « Plus ».
   ===================================================================== */

import { useEffect, useMemo, useRef, useState, type PointerEvent as EvPointeur, type ReactNode } from "react";
import { CalendarDays, CalendarRange, Calendar, Ellipsis, Inbox, Send, ChevronUp } from "lucide-react";
import { ajouterJours, aujourdhui, debutSemaine, depuisISO, formater, majuscule, versISO } from "@/lib/dates";
import { developper } from "@/lib/recurrence";
import { comparer, estEnRetard, passeLesFiltres } from "@/lib/taches";
import { analyserSaisie } from "@/lib/saisie-rapide";
import { JOURS_COURTS, VUES, type Filtres, type Tache, type Vue } from "@/lib/types";
import { CarteTache, type ActionsAgenda } from "./CarteTache";
import { Logo } from "./Logo";
import {
  IconeAjouter, IconeChecklist, IconeFermer, IconePrecedent, IconeRecherche, IconeSuivant, IconeValide,
  IconeContinuer, IconeDeplier, IconeBravo,
} from "./Icones";

export type VarianteMobile = "a" | "b" | "c";
const CLE_VARIANTE = "agendia-ergonomie-mobile";
const LARGEUR_TELEPHONE = "(max-width: 640px)";

/* L'option active : null sur ordinateur, ou tant qu'aucune option n'a été choisie. */
export function useVarianteMobile(): VarianteMobile | null {
  const [variante, setVariante] = useState<VarianteMobile | null>(null);
  useEffect(() => {
    const demandee = new URLSearchParams(location.search).get("mobile");
    let choisie: string | null = demandee;
    try {
      if (demandee === "aucune") localStorage.removeItem(CLE_VARIANTE);
      else if (demandee) localStorage.setItem(CLE_VARIANTE, demandee);
      choisie = localStorage.getItem(CLE_VARIANTE);
    } catch { /* navigateur privé : seule l'adresse compte */ }
    const ecran = matchMedia(LARGEUR_TELEPHONE);
    const maj = () => setVariante(ecran.matches && (choisie === "a" || choisie === "b" || choisie === "c") ? choisie : null);
    maj();
    ecran.addEventListener("change", maj);
    return () => ecran.removeEventListener("change", maj);
  }, []);
  return variante;
}

/* Titre court de la période (le titre complet « Semaine du 23 novembre au 29 novembre 2026 »
   prend deux lignes sur un téléphone). */
export function titreCourt(vue: Vue, d: Date): string {
  if (vue === "jour") return majuscule(formater(d, { weekday: "short", day: "numeric", month: "short" }));
  if (vue === "semaine") {
    const lundi = debutSemaine(d);
    const dimanche = ajouterJours(lundi, 6);
    const memeMois = lundi.getMonth() === dimanche.getMonth();
    return `${lundi.getDate()}${memeMois ? "" : " " + formater(lundi, { month: "short" })} – ${formater(dimanche, { day: "numeric", month: "short" })}`;
  }
  if (vue === "mois") return majuscule(formater(d, { month: "long", year: "numeric" }));
  if (vue === "liste") return "À venir";
  return VUES.find((v) => v.id === vue)?.libelle ?? "";
}

/* ---------- En-tête sur une ligne ---------- */
interface PropsEntete {
  titre: string;
  navigable: boolean;
  onPrecedent: () => void;
  onSuivant: () => void;
  onAujourdhui: () => void;
  rechercheOuverte: boolean;
  onRecherche: () => void;
  onTitre?: () => void;      // option B : le titre (mois) déplie le calendrier du mois
  titreDeplie?: boolean;
}

export function EnteteMobile(p: PropsEntete) {
  return (
    <header className="entete-mobile">
      <Logo taille={28} />
      {p.onTitre ? (
        <button type="button" className="titre-mobile titre-depliable" aria-expanded={p.titreDeplie} onClick={p.onTitre}>
          {p.titre} {p.titreDeplie ? <ChevronUp aria-hidden="true" /> : <IconeDeplier />}
        </button>
      ) : <h1 className="titre-mobile">{p.titre}</h1>}
      {p.navigable && (
        <>
          <button type="button" className="btn-rond btn-auj" onClick={p.onAujourdhui}>Auj.</button>
          <button type="button" className="btn-rond" aria-label="Période précédente" onClick={p.onPrecedent}><IconePrecedent /></button>
          <button type="button" className="btn-rond" aria-label="Période suivante" onClick={p.onSuivant}><IconeSuivant /></button>
        </>
      )}
      <button type="button" className={`btn-rond${p.rechercheOuverte ? " actif" : ""}`} aria-label="Rechercher et filtrer"
        aria-expanded={p.rechercheOuverte} onClick={p.onRecherche}><IconeRecherche /></button>
    </header>
  );
}

/* ---------- Barre d'onglets en bas (pouce) ---------- */
const ONGLETS: Record<VarianteMobile, { vue: Vue; libelle: string; icone: ReactNode }[]> = {
  a: [
    { vue: "jour", libelle: "Jour", icone: <CalendarDays aria-hidden="true" /> },
    { vue: "semaine", libelle: "Semaine", icone: <CalendarRange aria-hidden="true" /> },
    { vue: "mois", libelle: "Mois", icone: <Calendar aria-hidden="true" /> },
    { vue: "checklist", libelle: "Checklist", icone: <IconeChecklist /> },
  ],
  b: [
    { vue: "jour", libelle: "Agenda", icone: <CalendarDays aria-hidden="true" /> },
    { vue: "checklist", libelle: "Checklist", icone: <IconeChecklist /> },
  ],
  c: [
    { vue: "liste", libelle: "À venir", icone: <Inbox aria-hidden="true" /> },
    { vue: "mois", libelle: "Calendrier", icone: <Calendar aria-hidden="true" /> },
    { vue: "checklist", libelle: "Checklist", icone: <IconeChecklist /> },
  ],
};

export function vueAccueil(v: VarianteMobile): Vue {
  return ONGLETS[v][0].vue;
}

export function BarreBas({ variante, vue, onVue, onPlus }: { variante: VarianteMobile; vue: Vue; onVue: (v: Vue) => void; onPlus: () => void }) {
  return (
    <nav className="barre-bas" aria-label="Navigation principale">
      {ONGLETS[variante].map((o) => (
        <button key={o.vue} type="button" className={vue === o.vue ? "actif" : ""} aria-current={vue === o.vue ? "page" : undefined}
          onClick={() => onVue(o.vue)}>
          {o.icone}<span>{o.libelle}</span>
        </button>
      ))}
      <button type="button" onClick={onPlus}><Ellipsis aria-hidden="true" /><span>Plus</span></button>
    </nav>
  );
}

export function BoutonFlottant({ onClick, libelle = "Nouvelle tâche" }: { onClick: () => void; libelle?: string }) {
  return (
    <button type="button" className="bouton-flottant" aria-label={libelle} title={libelle} onClick={onClick}>
      <IconeAjouter />
    </button>
  );
}

/* ---------- Feuille du bas (fenêtre qui monte du bas de l'écran) ---------- */
export function FeuilleBas({ titre, onFermer, children, className = "" }: { titre: string; onFermer: () => void; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} className={`feuille-bas ${className}`} onClose={onFermer}
      onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }}>
      <div className="feuille-contenu">
        <div className="feuille-poignee" aria-hidden="true" />
        <div className="feuille-titre">
          <h2>{titre}</h2>
          <button type="button" className="btn-icone" aria-label="Fermer" onClick={() => ref.current?.close()}><IconeFermer /></button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/* Menu « Plus » : compteurs, autres vues, actions rares, et (prototype) choix de l'option. */
export function MenuPlus({ variante, vue, compteurs, onVue, actions, onFermer }: {
  variante: VarianteMobile; vue: Vue; compteurs: ReactNode; onVue: (v: Vue) => void; onFermer: () => void;
  actions: { libelle: string; icone: ReactNode; onClick: () => void; danger?: boolean }[];
}) {
  const fermerPuis = (f: () => void) => () => { onFermer(); f(); };
  return (
    <FeuilleBas titre="Plus" onFermer={onFermer}>
      {compteurs}
      <h3 className="feuille-sous-titre">Toutes les vues</h3>
      <div className="grille-vues">
        {VUES.map((v) => (
          <button key={v.id} type="button" className={`btn${vue === v.id ? " btn-principal" : ""}`} onClick={fermerPuis(() => onVue(v.id))}>{v.libelle}</button>
        ))}
      </div>
      <h3 className="feuille-sous-titre">Actions</h3>
      <div className="liste-actions">
        {actions.map((a) => (
          <button key={a.libelle} type="button" className={`ligne-action${a.danger ? " danger" : ""}`} onClick={fermerPuis(a.onClick)}>
            {a.icone}<span>{a.libelle}</span>
          </button>
        ))}
      </div>
      <h3 className="feuille-sous-titre">Prototype : option d&apos;ergonomie</h3>
      <div className="grille-vues">
        {(["a", "b", "c", "aucune"] as const).map((o) => (
          <a key={o} className={`btn${variante === o ? " btn-principal" : ""}`} href={`?mobile=${o}`}>
            {o === "aucune" ? "Actuelle" : `Option ${o.toUpperCase()}`}
          </a>
        ))}
      </div>
    </FeuilleBas>
  );
}

/* ---------- Geste de balayage horizontal ----------
   On suit le doigt (ou la souris) ; si le mouvement est surtout horizontal et dépasse
   le seuil, on appelle onGauche / onDroite. touch-action: pan-y (CSS) laisse le
   navigateur gérer le défilement vertical normalement. */
export function useBalayage(onGauche: () => void, onDroite: () => void, seuil = 60) {
  const depart = useRef<{ x: number; y: number } | null>(null);
  return {
    onPointerDown: (e: EvPointeur) => { depart.current = { x: e.clientX, y: e.clientY }; },
    onPointerUp: (e: EvPointeur) => {
      const d = depart.current;
      depart.current = null;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (Math.abs(dx) < seuil || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      if (dx < 0) onGauche(); else onDroite();
    },
    onPointerCancel: () => { depart.current = null; },
  };
}

/* ---------- Option B : bandeau de la semaine + calendrier du mois dépliable ---------- */
function points(taches: Tache[]) {
  return (
    <span className="points-jour" aria-hidden="true">
      {taches.slice(0, 3).map((t) => (
        <i key={t.id} className={`${t.faite ? "fait" : ""}${t.couleur ? ` couleur-${t.couleur}` : ` cat-${t.categorie}`}`} />
      ))}
    </span>
  );
}

export function BandeauSemaine({ dateRef, onChoisir, taches, filtres, moisOuvert, onFermerMois }: {
  dateRef: Date; onChoisir: (d: Date) => void; taches: Tache[]; filtres: Filtres; moisOuvert: boolean; onFermerMois: () => void;
}) {
  const iso = versISO(dateRef);
  const isoAuj = versISO(aujourdhui());
  const premier = new Date(dateRef.getFullYear(), dateRef.getMonth(), 1);
  const debutGrille = debutSemaine(premier);
  const finGrille = ajouterJours(debutSemaine(new Date(dateRef.getFullYear(), dateRef.getMonth() + 1, 0)), 6);
  const lundi = debutSemaine(dateRef);
  // Occurrences de toute la grille du mois (elle contient toujours la semaine affichée).
  const debut = versISO(debutGrille < lundi ? debutGrille : lundi);
  const fin = versISO(ajouterJours(lundi, 6) > finGrille ? ajouterJours(lundi, 6) : finGrille);
  const parDate = useMemo(() => {
    const m = new Map<string, Tache[]>();
    for (const t of developper(taches, debut, fin).filter((t) => passeLesFiltres(t, filtres)).sort(comparer)) {
      m.set(t.date, [...(m.get(t.date) ?? []), t]);
    }
    return m;
  }, [taches, filtres, debut, fin]);
  const balayage = useBalayage(() => onChoisir(ajouterJours(dateRef, 7)), () => onChoisir(ajouterJours(dateRef, -7)));

  const caseJour = (j: Date, i: number, horsMois = false) => {
    const isoJ = versISO(j);
    const classes = ["case-ruban", isoJ === iso && "choisi", isoJ === isoAuj && "aujourdhui", horsMois && "hors-mois"].filter(Boolean).join(" ");
    return (
      <button key={isoJ} type="button" className={classes} aria-pressed={isoJ === iso}
        aria-label={formater(j, { weekday: "long", day: "numeric", month: "long" })}
        onClick={() => { onChoisir(j); onFermerMois(); }}>
        {!moisOuvert && <span className="initiale">{JOURS_COURTS[i][0]}</span>}
        <span className="numero">{j.getDate()}</span>
        {points(parDate.get(isoJ) ?? [])}
      </button>
    );
  };

  return (
    <section className="bandeau-semaine" aria-label="Choisir un jour">
      {moisOuvert ? (
        <div className="mini-mois">
          {JOURS_COURTS.map((n) => <span key={n} className="initiale">{n[0]}</span>)}
          {Array.from({ length: Math.round((finGrille.getTime() - debutGrille.getTime()) / 864e5) + 1 }, (_, k) => {
            const j = ajouterJours(debutGrille, k);
            return caseJour(j, k % 7, j.getMonth() !== dateRef.getMonth());
          })}
        </div>
      ) : (
        <div className="ruban" {...balayage}>
          {Array.from({ length: 7 }, (_, i) => caseJour(ajouterJours(lundi, i), i))}
        </div>
      )}
      <p className="jour-choisi">
        {iso === isoAuj ? "Aujourd'hui · " : ""}{majuscule(formater(dateRef, { weekday: "long", day: "numeric", month: "long" }))}
      </p>
    </section>
  );
}

/* ---------- Option C : carte qu'on balaie (→ fait, ← reporter) ---------- */
const SEUIL_ACTION = 90; // px à parcourir pour déclencher l'action

function CarteBalayable({ tache, actions, avecDate, onReporter }: {
  tache: Tache; actions: ActionsAgenda; avecDate?: boolean; onReporter: (t: Tache) => void;
}) {
  const [dx, setDx] = useState(0);
  const depart = useRef<{ x: number; y: number; horizontal: boolean | null } | null>(null);
  const aBouge = useRef(false);
  const retard = !!tache.date && tache.date < versISO(aujourdhui());

  const bas = (e: EvPointeur) => { depart.current = { x: e.clientX, y: e.clientY, horizontal: null }; aBouge.current = false; };
  const deplace = (e: EvPointeur) => {
    const d = depart.current;
    if (!d) return;
    const mx = e.clientX - d.x, my = e.clientY - d.y;
    if (d.horizontal === null && Math.hypot(mx, my) > 8) d.horizontal = Math.abs(mx) > Math.abs(my);
    if (d.horizontal) {
      aBouge.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      setDx(Math.max(-140, Math.min(140, mx)));
    }
  };
  const haut = () => {
    if (dx > SEUIL_ACTION) actions.cocher(tache.id);
    else if (dx < -SEUIL_ACTION && tache.date) onReporter(tache);
    depart.current = null;
    setDx(0);
  };

  return (
    <div className={`balayable${dx ? " en-cours" : ""}`}
      onPointerDown={bas} onPointerMove={deplace} onPointerUp={haut} onPointerCancel={haut}
      // Après un balayage, le « clic » qui suit ne doit pas ouvrir le formulaire.
      onClickCapture={(e) => { if (aBouge.current) { e.stopPropagation(); e.preventDefault(); aBouge.current = false; } }}>
      <div className={`fond-action gauche${dx > SEUIL_ACTION ? " pret" : ""}`} style={{ opacity: dx > 0 ? 1 : 0 }}>
        <IconeValide /> {tache.faite ? "À refaire" : "Fait"}
      </div>
      <div className={`fond-action droite${dx < -SEUIL_ACTION ? " pret" : ""}`} style={{ opacity: dx < 0 ? 1 : 0 }}>
        {tache.date ? (retard ? "Aujourd'hui" : "Demain") : "—"} <IconeContinuer />
      </div>
      <div className="balayable-carte" style={{ transform: dx ? `translateX(${dx}px)` : undefined }}>
        <CarteTache tache={tache} actions={actions} avecDate={avecDate} />
      </div>
    </div>
  );
}

const JOURS_A_VENIR = 14;

export function FilContinu({ taches, filtres, actions, onReporter }: {
  taches: Tache[]; filtres: Filtres; actions: ActionsAgenda; onReporter: (t: Tache) => void;
}) {
  const auj = aujourdhui();
  const isoAuj = versISO(auj);
  const fin = versISO(ajouterJours(auj, JOURS_A_VENIR - 1));
  const liste = useMemo(
    () => developper(taches, versISO(ajouterJours(auj, -60)), versISO(ajouterJours(auj, 60)))
      .filter((t) => t.date && passeLesFiltres(t, filtres)).sort(comparer),
    [taches, filtres, isoAuj], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const retard = liste.filter((t) => estEnRetard(t));
  const plusTard = liste.filter((t) => t.date > fin && !t.faite);
  const duJour = liste.filter((t) => t.date === isoAuj);
  const faitesAuj = duJour.filter((t) => t.faite).length;

  const jours: { iso: string; titre: string; taches: Tache[] }[] = [];
  for (let i = 0; i < JOURS_A_VENIR; i++) {
    const j = ajouterJours(auj, i);
    const iso = versISO(j);
    const t = liste.filter((x) => x.date === iso);
    if (i > 1 && t.length === 0) continue; // on garde toujours Aujourd'hui et Demain, même vides
    const nom = i === 0 ? "Aujourd'hui" : i === 1 ? "Demain" : majuscule(formater(j, { weekday: "long" }));
    jours.push({ iso, titre: `${nom} · ${formater(j, { day: "numeric", month: "short" })}`, taches: t });
  }

  const section = (cle: string, titre: ReactNode, t: Tache[], options: { avecDate?: boolean; classe?: string; vide?: ReactNode; iso?: string } = {}) => (
    <section key={cle} className={`section-fil ${options.classe ?? ""}`}>
      <h3 className="titre-fil">{titre}</h3>
      {t.length === 0 && options.vide}
      <div className="liste-taches">
        {t.map((x) => <CarteBalayable key={x.id} tache={x} actions={actions} avecDate={options.avecDate} onReporter={onReporter} />)}
      </div>
      {options.iso && (
        <button type="button" className="lien-ajout-fil" onClick={() => actions.ajouterLe(options.iso!)}><IconeAjouter /> Ajouter</button>
      )}
    </section>
  );

  return (
    <div className="fil-continu">
      {duJour.length > 0 && (
        <div className="resume-jour">
          <div className="anneau" style={{ ["--part" as string]: `${Math.round((faitesAuj / duJour.length) * 100)}%` }}>
            <span>{faitesAuj}/{duJour.length}</span>
          </div>
          <p><strong>{duJour.length - faitesAuj === 0 ? "Journée terminée" : `${duJour.length - faitesAuj} tâche(s) aujourd'hui`}</strong>
            <small>Balaie une carte → pour la cocher, ← pour la reporter.</small></p>
        </div>
      )}
      {retard.length > 0 && section("retard", `En retard (${retard.length})`, retard, { avecDate: true, classe: "fil-retard" })}
      {jours.map((j, i) => section(j.iso, j.titre, j.taches, {
        classe: i === 0 && j.iso === isoAuj ? "fil-aujourdhui" : "",
        vide: <p className="vide-fil">{i === 0 ? <><IconeBravo /> Rien de prévu.</> : "Rien de prévu."}</p>,
        iso: j.iso,
      }))}
      {plusTard.length > 0 && section("tard", "Plus tard", plusTard, { avecDate: true })}
    </div>
  );
}

/* ---------- Option C : saisie rapide ---------- */
type ChoixDate = "auj" | "demain" | "sans";

export function SaisieRapide({ onCreer, onDetails, onFermer }: {
  onCreer: (titre: string, date: string, heure: string) => Promise<boolean>; onDetails: () => void; onFermer: () => void;
}) {
  const [texte, setTexte] = useState("");
  const [choix, setChoix] = useState<ChoixDate>("auj");
  const [envoi, setEnvoi] = useState(false);
  const auj = aujourdhui();
  const a = analyserSaisie(texte, auj);
  const dateChip = choix === "auj" ? versISO(auj) : choix === "demain" ? versISO(ajouterJours(auj, 1)) : "";
  const date = a.date ?? dateChip;
  const apercu = date ? majuscule(formater(depuisISO(date), { weekday: "long", day: "numeric", month: "long" })) : "Checklist (sans date)";

  async function valider() {
    if (!a.titre || envoi) return;
    setEnvoi(true);
    const ok = await onCreer(a.titre, date, date ? a.heure : "");
    setEnvoi(false);
    if (ok) setTexte("");
  }

  return (
    <FeuilleBas titre="Ajout rapide" onFermer={onFermer} className="feuille-saisie">
      <form className="saisie-rapide" onSubmit={(e) => { e.preventDefault(); valider(); }}>
        <div className="ligne-saisie">
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input autoFocus value={texte} onChange={(e) => setTexte(e.target.value)} placeholder="Ex. : Réviser maths demain 14h"
            aria-label="Nouvelle tâche" enterKeyHint="send" />
          <button type="submit" className="btn btn-principal" aria-label="Ajouter" disabled={!a.titre || envoi}><Send aria-hidden="true" /></button>
        </div>
        <div className="puces-date" role="radiogroup" aria-label="Date">
          {([["auj", "Aujourd'hui"], ["demain", "Demain"], ["sans", "Sans date"]] as const).map(([id, lib]) => (
            <button key={id} type="button" role="radio" aria-checked={a.date === null && choix === id}
              className={a.date === null && choix === id ? "actif" : ""} onClick={() => setChoix(id)}>{lib}</button>
          ))}
        </div>
        <p className="apercu-saisie">
          {a.titre ? <>« <strong>{a.titre}</strong> » → {apercu}{date && a.heure ? ` à ${a.heure}` : ""}</> : "Écris la tâche ; « demain », « vendredi », « 14h » sont compris."}
        </p>
        <button type="button" className="lien" onClick={() => { onFermer(); onDetails(); }}>Plus de détails (durée, lieu, couleur…)</button>
      </form>
    </FeuilleBas>
  );
}
