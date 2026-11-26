"use client";

/* =====================================================================
   Ergonomie sur téléphone (choisie par Arthur le 26/11/2026 : option B
   « bandeau de la semaine », avec les gestes de l'option C).

   Sur un écran de 640 px ou moins :
   - en-tête sur une seule ligne, filtres repliés derrière la loupe ;
   - cartes allégées (badges catégorie, priorité et « Urgent » retirés) ;
   - bouton « + » flottant, barre d'onglets en bas, menu « Plus » ;
   - fenêtres en « feuille » qui monte du bas de l'écran ;
   - Agenda = bandeau de la semaine (un point par tâche) + journée choisie,
     mois dépliable en touchant son nom, ligne « En retard » sur aujourd'hui ;
   - balayage des cartes : → cocher, ← reporter (components/Balayable.tsx).
   Sur ordinateur, rien ne change.

   Les deux autres options du prototype restent disponibles pour essai, via
   l'adresse (le choix est mémorisé dans le navigateur) :
     ?mobile=a  barre d'onglets en bas avec les vues habituelles (Google Agenda)
     ?mobile=c  fil « À venir » continu + saisie rapide (Todoist, Things)
     ?mobile=b  revient à l'affichage par défaut
     ?mobile=aucune  ancien affichage téléphone (celui d'avant le 26/11)
   ===================================================================== */

import { useEffect, useMemo, useRef, useState, type PointerEvent as EvPointeur, type ReactNode } from "react";
import { CalendarDays, CalendarRange, Calendar, Ellipsis, Inbox, ChevronUp, Rows3, Sunrise } from "lucide-react";
import { ajouterJours, aujourdhui, debutSemaine, depuisISO, formater, majuscule, versISO } from "@/lib/dates";
import { developper } from "@/lib/recurrence";
import { chargeRestante, comparer, estEnRetard, formaterDuree, passeLesFiltres } from "@/lib/taches";
import { JOURS_COURTS, VUES, type Filtres, type Tache, type Vue } from "@/lib/types";
import { CarteTache, type ActionsAgenda } from "./CarteTache";
import { Logo } from "./Logo";
import {
  IconeAjouter, IconeChecklist, IconeFermer, IconePrecedent, IconeRecherche, IconeSuivant,
  IconeDeplier, IconeBravo, IconeIdee,
} from "./Icones";

export type VarianteMobile = "a" | "b" | "c";
const CLE_VARIANTE = "agendia-ergonomie-mobile";
const LARGEUR_TELEPHONE = "(max-width: 640px)";

/* L'option active : null sur ordinateur (ou si l'ancien affichage a été demandé). */
export function useVarianteMobile(): VarianteMobile | null {
  const [variante, setVariante] = useState<VarianteMobile | null>(null);
  useEffect(() => {
    const demandee = new URLSearchParams(location.search).get("mobile");
    let choisie: string | null = demandee;
    try {
      if (demandee) localStorage.setItem(CLE_VARIANTE, demandee);
      choisie = localStorage.getItem(CLE_VARIANTE);
    } catch { /* navigateur privé : seule l'adresse compte */ }
    // Par défaut (rien de choisi) : option B.
    const v: VarianteMobile | null = choisie === "aucune" ? null : choisie === "a" || choisie === "c" ? choisie : "b";
    const ecran = matchMedia(LARGEUR_TELEPHONE);
    const maj = () => setVariante(ecran.matches ? v : null);
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
  indicateur?: ReactNode; // hors connexion : pastille toujours visible dans l'en-tête
  titre: string;
  navigable: boolean;
  onPrecedent: () => void;
  onSuivant: () => void;
  onAujourdhui: () => void;
  rechercheOuverte: boolean;
  onRecherche: () => void;
  onTitre?: () => void;      // option B : le titre (mois) déplie le calendrier du mois
  titreDeplie?: boolean;
  boutonAujourdhui?: boolean; // option B : « Auj. » seul, quand le jour affiché n'est pas aujourd'hui
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
      {!p.navigable && p.boutonAujourdhui && (
        <button type="button" className="btn-rond btn-auj" onClick={p.onAujourdhui}>Aujourd&apos;hui</button>
      )}
      {p.navigable && (
        <>
          <button type="button" className="btn-rond btn-auj" onClick={p.onAujourdhui}>Auj.</button>
          <button type="button" className="btn-rond" aria-label="Période précédente" onClick={p.onPrecedent}><IconePrecedent /></button>
          <button type="button" className="btn-rond" aria-label="Période suivante" onClick={p.onSuivant}><IconeSuivant /></button>
        </>
      )}
      {p.indicateur}
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
    // Rubriques visibles plutôt que cachées dans « Plus » : NN/g, « Hamburger Menus », 2016.
    { vue: "tri", libelle: "Tri", icone: <Rows3 aria-hidden="true" /> },
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
export function MenuPlus({ vue, compteurs, onVue, actions, onFermer, raccourcis = [] }: {
  vue: Vue; compteurs: ReactNode; onVue: (v: Vue) => void; onFermer: () => void;
  actions: { libelle: string; icone: ReactNode; onClick: () => void; danger?: boolean; detail?: string }[];
  // Grandes tuiles en haut du menu (Ma journée, Rappels, Agendas, Corbeille).
  raccourcis?: { libelle: string; detail: string; icone: ReactNode; onClick: () => void; accent?: boolean }[];
}) {
  const fermerPuis = (f: () => void) => () => { onFermer(); f(); };
  return (
    <FeuilleBas titre="Plus" onFermer={onFermer}>
      {raccourcis.length > 0 && (
        <div className="tuiles-plus">
          {raccourcis.map((r) => (
            <button key={r.libelle} type="button" className={`tuile-plus${r.accent ? " accent" : ""}`} onClick={fermerPuis(r.onClick)}>
              <span className="tuile-icone">{r.icone}</span>
              <span className="tuile-texte"><strong>{r.libelle}</strong><small>{r.detail}</small></span>
            </button>
          ))}
        </div>
      )}
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
            {a.icone}<span>{a.libelle}{a.detail && <small className="detail-action">{a.detail}</small>}</span>
          </button>
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

/* ---------- Astuce : faire découvrir le balayage (une seule fois) ----------
   Les gestes sans indice visuel passent inaperçus (NN/g, « Contextual Swipe », 2017) :
   au premier affichage, la première carte glisse toute seule vers la droite en montrant
   « Fait », et un encadré explique les deux gestes. « Compris » ne le remontre plus. */
const CLE_ASTUCE = "agendia-astuce-balayage-vue";

export function AstuceBalayage({ actif }: { actif: boolean }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!actif) return;
    try { if (localStorage.getItem(CLE_ASTUCE) === "1") return; } catch { /* navigateur privé : on montre l'astuce */ }
    let fin: ReturnType<typeof setTimeout> | undefined;
    const debut = setTimeout(() => { // laisse le temps à la première carte de s'afficher
      const carte = document.querySelector("main .balayable");
      if (!carte) return;
      setVisible(true);
      carte.classList.add("demo-balayage");
      fin = setTimeout(() => carte.classList.remove("demo-balayage"), 3400);
    }, 700);
    return () => { clearTimeout(debut); clearTimeout(fin); };
  }, [actif]);
  if (!visible || !actif) return null; // seulement dans la vue Agenda
  const fermer = () => {
    setVisible(false);
    try { localStorage.setItem(CLE_ASTUCE, "1"); } catch { /* tant pis : elle reviendra */ }
  };
  return (
    <div className="astuce-balayage" role="status">
      <IconeIdee />
      <p><strong>Astuce :</strong> balaie une tâche vers la droite pour la cocher, vers la gauche pour la reporter.</p>
      <button type="button" className="btn" onClick={fermer}>Compris</button>
    </div>
  );
}

/* ---------- Invitation « Ma journée » (en haut d'aujourd'hui, une fois par jour) ----------
   Un rituel s'installe mieux quand l'application le propose au bon moment (Microsoft
   To Do, Sunsama) : le matin, au premier coup d'œil. « Plus tard » la masque jusqu'à demain. */
export function InvitationJournee({ enRetard, suggestions, onOuvrir, onMasquer }: {
  enRetard: number; suggestions: number; onOuvrir: () => void; onMasquer: () => void;
}) {
  const morceaux = [enRetard ? `${enRetard} en retard` : "", suggestions ? `${suggestions} dans la Checklist` : ""].filter(Boolean);
  return (
    <section className="invitation-journee" aria-label="Préparer ma journée">
      <span className="invitation-icone" aria-hidden="true"><Sunrise /></span>
      <button type="button" className="invitation-texte" onClick={onOuvrir}>
        <strong>Prépare ta journée</strong>
        <small>{morceaux.length ? morceaux.join(" · ") : "Choisis tes tâches et place-les dans ta journée"} · 1 min</small>
      </button>
      <button type="button" className="btn invitation-go" onClick={onOuvrir}>Ouvrir</button>
      <button type="button" className="btn-icone" aria-label="Plus tard (masquer jusqu'à demain)" title="Plus tard" onClick={onMasquer}><IconeFermer /></button>
    </section>
  );
}

/* ---------- Ligne « En retard » (au-dessus de la journée d'aujourd'hui) ---------- */
/* Deux intertitres de carnet : « En retard » (repliable), puis « Journée » pour séparer
   les retards des tâches du jour. Le rouge reste sur les cases et les dates, pas sur un cadre. */
export function LigneRetard({ taches, actions }: { taches: Tache[]; actions: ActionsAgenda }) {
  const [ouverte, setOuverte] = useState(true);
  if (taches.length === 0) return null;
  return (
    <>
      <section className="ligne-retard" aria-labelledby="titre-retard">
        <div className="entete-section-jour">
          <h3 id="titre-retard" className="titre-section-jour">
            En retard <span className="compte-section">{taches.length}</span>
          </h3>
          <button type="button" className="lien" aria-expanded={ouverte} onClick={() => setOuverte((o) => !o)}>
            {ouverte ? "Masquer" : "Afficher"}
          </button>
        </div>
        {ouverte && (
          <div className="liste-taches">
            {taches.map((t) => <CarteTache key={t.id} tache={t} actions={actions} avecDate />)}
          </div>
        )}
      </section>
      <h3 className="titre-section-jour">Journée</h3>
    </>
  );
}

/* ---------- Option B : bandeau de la semaine + calendrier du mois dépliable ---------- */
function points(taches: Tache[], nbEvenements = 0) {
  return (
    <span className="points-jour" aria-hidden="true">
      {taches.slice(0, nbEvenements ? 2 : 3).map((t) => (
        <i key={t.id} className={`${t.faite ? "fait" : ""}${t.couleur ? ` couleur-${t.couleur}` : ` cat-${t.categorie}`}`} />
      ))}
      {nbEvenements > 0 && <i className="point-evenement" />}
    </span>
  );
}

export function BandeauSemaine({ dateRef, onChoisir, taches, filtres, moisOuvert, onFermerMois, evenements }: {
  dateRef: Date; onChoisir: (d: Date) => void; taches: Tache[]; filtres: Filtres; moisOuvert: boolean; onFermerMois: () => void;
  evenements?: Map<string, unknown[]>; // agendas externes : un point gris le jour où il y a des événements
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
        {points(parDate.get(isoJ) ?? [], evenements?.get(isoJ)?.length ?? 0)}
      </button>
    );
  };

  return (
    <>
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
    </section>
    <TitreJour date={dateRef} taches={parDate.get(iso) ?? []} />
    </>
  );
}

/* Titre de la journée affichée, comme le haut d'une page d'agenda : « Aujourd'hui » en
   petit, la date en grand (Fraunces), puis le bilan en une phrase. Il défile avec la page ;
   le ruban, lui, reste collé en haut et garde le jour choisi en bleu. */
function TitreJour({ date, taches }: { date: Date; taches: Tache[] }) {
  const ecart = Math.round((depuisISO(versISO(date)).getTime() - depuisISO(versISO(aujourdhui())).getTime()) / 864e5);
  const repere = ecart === 0 ? "Aujourd'hui" : ecart === 1 ? "Demain" : ecart === -1 ? "Hier" : "";
  const aFaire = taches.filter((t) => !t.faite).length;
  const faites = taches.length - aFaire;
  const charge = chargeRestante(taches);
  const bilan = taches.length === 0 ? "Rien de prévu" : [
    aFaire ? `${aFaire} à faire` : "Tout est fait",
    faites ? `${faites} faite${faites > 1 ? "s" : ""}` : "",
    // « 1 h prévue », « 1 h 30 prévue » (l'heure commande l'accord), mais « 45 min prévues », « 6 h prévues ».
    charge ? `${formaterDuree(charge)} prévue${(charge >= 60 && charge < 120) || charge === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");
  return (
    <header className="titre-jour">
      {repere && <p className="titre-jour-repere">{repere}</p>}
      <h2>{majuscule(formater(date, { weekday: "long", day: "numeric", month: "long" }))}</h2>
      <p className="titre-jour-bilan">{bilan}</p>
    </header>
  );
}

const JOURS_A_VENIR = 14;

export function FilContinu({ taches, filtres, actions }: { taches: Tache[]; filtres: Filtres; actions: ActionsAgenda }) {
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
        {t.map((x) => <CarteTache key={x.id} tache={x} actions={actions} avecDate={options.avecDate} />)}
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

/* ---------- Option C : saisie rapide ----------
   Déplacée dans components/SaisieRapide.tsx (pastilles de correction, version ordinateur). */
