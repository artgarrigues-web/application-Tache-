"use client";

/* Composant principal de l'agenda : il possède l'état de l'interface
   (vue, date affichée, filtres, formulaire ouvert) et le distribue aux
   composants enfants via leurs "props".

   Flux des données en React (à sens unique) :
     état (useState) ─► props ─► affichage
     clic ─► fonction reçue en prop ─► mise à jour de l'état ─► React réaffiche   */

import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { CarteTache } from "./CarteTache";
import { FournisseurGlisser, ZoneDepot, libelleCible, type Cible, type Glisse } from "./Glisser";
import type { User } from "@supabase/supabase-js";
import { ajouterJours, aujourdhui, debutSemaine, deplacer, depuisISO, plageVisible, titrePeriode, versISO } from "@/lib/dates";
import { analyserId, developper, entreesCourantes } from "@/lib/recurrence";
import { supabase } from "@/lib/supabase";
import { comparer, passeLesFiltres, validerTaches } from "@/lib/taches";
import { FILTRES_INITIAUX, VUES, type DonneesTache, type Filtres, type Portee, type Vue } from "@/lib/types";
import { useTaches } from "@/hooks/useTaches";
import { useIdees } from "@/hooks/useIdees";
import type { ActionsAgenda } from "./CarteTache";
import { Compteurs } from "./Compteurs";
import { FormulaireTache } from "./FormulaireTache";
import { BarreSaisieRapide, SaisieRapide, libelleRepetition, type BrouillonSaisie } from "./SaisieRapide";
import { ChoixPortee } from "./ChoixPortee";
import { SynchroCalendrier } from "./SynchroCalendrier";
import { Planificateur } from "./Planificateur";
import type { ChangementHoraire } from "@/lib/depot";
import type { Planning } from "@/lib/planification";
import { VueChecklist, VueJour, VueListe, VueMois, VueSemaine, VueTri } from "./VuesAgenda";
import { Logo, NomApp } from "./Logo";
import { IconeAjouter, IconeAnnuler, IconeChecklist, IconeExporter, IconeFermer, IconeImporter, IconePlanifier, IconePrecedent, IconeRecherche, IconeSucces, IconeSuivant, IconeSynchro, IconeSupprimer, IconeValide } from "./Icones";
import { LogOut } from "lucide-react";
import {
  AstuceBalayage, BandeauSemaine, BarreBas, BoutonFlottant, EnteteMobile, FilContinu, InvitationJournee, LigneRetard, MenuPlus, titreCourt, useBalayage,
  useVarianteMobile, vueAccueil,
} from "./Mobile";
import type { Tache } from "@/lib/types";
import { ContexteBalayage } from "./Balayable";
import { estEnRetard } from "@/lib/taches";
import { Bell, BellRing, CalendarDays, Sunrise } from "lucide-react";
import * as depot from "@/lib/depot";
import { corbeilleDisponible, rappelsDisponibles, type ReglagesRappels } from "@/lib/depot";
import { enregistrerServiceWorker, etatNotifications, mettrePastille, type EtatNotifications } from "@/lib/notifications";
import { useAgendasExternes } from "@/hooks/useAgendasExternes";
import { ContexteAgendas } from "./Evenements";
import { Rappels } from "./Rappels";
import { Corbeille } from "./Corbeille";
import { AgendasExternes } from "./AgendasExternes";
import { MaJournee, journeePrepareeAujourdhui, masquerInvitationAujourdhui } from "./MaJournee";

const CLE_VUE = "agenda-taches-vue"; // simple préférence d'affichage, gardée dans le navigateur
const CLE_ANNULATION = "agenda-dernier-planning"; // de quoi annuler le dernier planning appliqué

/* Mémoire du dernier planning appliqué : l'horaire AVANT (vide pour une tâche de checklist)
   et APRÈS de chaque tâche déplacée. Gardée dans le navigateur pour survivre à un rechargement. */
interface DernierPlanning { nom: string; avant: ChangementHoraire[]; apres: ChangementHoraire[] }

// date : "AAAA-MM-JJ" imposée, "" = sans date (checklist), undefined = date par défaut de la vue.
// brouillon : valeurs comprises par l'ajout en une phrase, pour pré-remplir le formulaire.
interface EtatFormulaire { tacheId: string | null; date?: string; brouillon?: BrouillonSaisie }

export function Agenda({ utilisateur }: { utilisateur: User }) {
  const { taches, charge, erreur, effacerErreur, ajouter, modifier, supprimer, basculerFaite, effacerTerminees, importer, changerHoraires,
    supprimerOccurrence, modifierOccurrence, deplacer: deplacerTache, creerDepuis,
    listerCorbeille, restaurer, supprimerDefinitivement, cocherCase } = useTaches(utilisateur.id);
  const idees = useIdees(utilisateur.id); // catégorie « Projets » de la Checklist

  const [vue, setVue] = useState<Vue>("semaine");
  const [dateRef, setDateRef] = useState<Date>(() => aujourdhui());
  const [filtres, setFiltres] = useState<Filtres>(FILTRES_INITIAUX);
  const [formulaire, setFormulaire] = useState<EtatFormulaire | null>(null);
  const [synchroOuverte, setSynchroOuverte] = useState(false);
  const [planifOuverte, setPlanifOuverte] = useState(false);
  const [dernierPlanning, setDernierPlanning] = useState<DernierPlanning | null>(null);
  const [messagePlanif, setMessagePlanif] = useState("");
  // Suppression d'une occurrence (icône corbeille) : fenêtre « ce jour / les suivants / la série ».
  const [suppressionOccurrence, setSuppressionOccurrence] = useState<{ serieId: string; date: string; titre: string } | null>(null);
  const champFichier = useRef<HTMLInputElement>(null);
  // Message affiché après un glisser-déposer, avec son bouton « Annuler ».
  const [messageDepot, setMessageDepot] = useState<{ texte: string; detail?: string; annuler: (() => Promise<boolean>) | null; cle: number;
    action?: { libelle: string; faire: () => void } } | null>(null);

  /* Prototype ergonomie téléphone (components/Mobile.tsx) : null = affichage habituel. */
  const mobile = useVarianteMobile();
  const [rechercheOuverte, setRechercheOuverte] = useState(false);
  const [plusOuvert, setPlusOuvert] = useState(false);
  const [saisieOuverte, setSaisieOuverte] = useState(false);
  const [moisOuvert, setMoisOuvert] = useState(false); // option B : calendrier du mois déplié
  /* ---------- Rappels, corbeille, agendas externes, « Ma journée » (26/11/2026) ---------- */
  const [reglages, setReglages] = useState<ReglagesRappels>({ rappelDefaut: null, resumeMatin: "" });
  const [etatNotif, setEtatNotif] = useState<EtatNotifications | null>(null);
  const [rappelsOuvert, setRappelsOuvert] = useState(false);
  const [corbeilleOuverte, setCorbeilleOuverte] = useState(false);
  const [agendasOuvert, setAgendasOuvert] = useState(false);
  const [journeeOuverte, setJourneeOuverte] = useState(false);
  const [invitationMasquee, setInvitationMasquee] = useState(true);
  useEffect(() => {
    depot.lireReglagesRappels().then((r) => { if (r) setReglages(r); });
    enregistrerServiceWorker().then(() => etatNotifications().then(setEtatNotif));
    setInvitationMasquee(journeePrepareeAujourdhui());
  }, [utilisateur.id]);
  async function enregistrerReglages(r: ReglagesRappels): Promise<boolean> {
    setReglages(r);
    try { await depot.enregistrerReglagesRappels(r); return true; } catch { return false; }
  }
  /* Ouvrir l'application depuis une notification : « ?jour=AAAA-MM-JJ » montre ce jour,
     « ?ma-journee=1 » ouvre la préparation de la journée. Si AgendIA était déjà ouvert,
     le service worker envoie la même adresse par message (sans recharger la page). */
  useEffect(() => {
    function ouvrir(adresse: string) {
      const p = new URL(adresse, location.origin).searchParams;
      const jour = p.get("jour");
      if (jour && /^\d{4}-\d{2}-\d{2}$/.test(jour)) { setDateRef(depuisISO(jour)); setVue("jour"); }
      if (p.get("ma-journee")) setJourneeOuverte(true);
      if (jour || p.get("ma-journee")) history.replaceState(null, "", location.pathname);
    }
    ouvrir(location.href);
    const auMessage = (e: MessageEvent) => { if (e.data?.type === "agendia-ouvrir") ouvrir(e.data.url); };
    navigator.serviceWorker?.addEventListener("message", auMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", auMessage);
  }, []);

  // En passant sur une option téléphone, on arrive sur son écran d'accueil (comme les apps mobiles).
  useEffect(() => { if (mobile) setVue(vueAccueil(mobile)); }, [mobile]);

  // Retrouve la dernière vue utilisée…
  useEffect(() => {
    const enregistree = localStorage.getItem(CLE_VUE);
    if (VUES.some((v) => v.id === enregistree)) setVue(enregistree as Vue);
  }, []);
  // Retrouve un planning annulable laissé par une visite précédente.
  useEffect(() => {
    try {
      const d = JSON.parse(localStorage.getItem(CLE_ANNULATION) ?? "null");
      if (d && Array.isArray(d.avant) && Array.isArray(d.apres)) setDernierPlanning(d);
    } catch { /* donnée illisible : on l'ignore */ }
  }, []);
  // … et la mémorise à chaque changement.
  useEffect(() => {
    localStorage.setItem(CLE_VUE, vue);
  }, [vue]);

  const plage = plageVisible(vue, dateRef);
  // Les vues Liste et Tri montrent toutes les dates : pas de navigation ‹ ›.
  const navigable = vue !== "liste" && vue !== "tri" && vue !== "checklist";
  // Vues « calendrier » sous lesquelles on affiche aussi la Checklist.
  const vueCalendrier = vue === "jour" || vue === "semaine" || vue === "mois";

  /* Tâches répétées : leurs occurrences sont fabriquées ici, à l'affichage (lib/recurrence.ts).
     - Vues calendrier : toutes les occurrences de la période affichée (pour Mois, toute la
       grille, qui déborde sur les mois voisins) ;
     - Liste, Tri, Checklist, compteurs : une seule entrée « à faire » par série.
     useMemo : ne refait le calcul que si les tâches, les filtres ou la période changent. */
  const isoAujourdhui = versISO(aujourdhui());
  const grille = useMemo(() => {
    if (vue === "mois") {
      const premier = new Date(dateRef.getFullYear(), dateRef.getMonth(), 1);
      const dernier = new Date(dateRef.getFullYear(), dateRef.getMonth() + 1, 0);
      return { debut: versISO(debutSemaine(premier)), fin: versISO(ajouterJours(debutSemaine(dernier), 6)) };
    }
    return plage ?? { debut: isoAujourdhui, fin: isoAujourdhui };
  }, [vue, dateRef, plage?.debut, plage?.fin, isoAujourdhui]); // eslint-disable-line react-hooks/exhaustive-deps
  const courantes = useMemo(() => entreesCourantes(taches, isoAujourdhui), [taches, isoAujourdhui]);
  const agendas = useAgendasExternes(utilisateur.id, grille.debut, grille.fin);
  const infosAgendas = useMemo(() => new Map(agendas.agendas.map((a) => [a.id, { nom: a.nom, couleur: a.couleur }])), [agendas.agendas]);
  // Créneaux occupés par les agendas externes (ni « toute la journée », ni marqués « disponible »).
  const occupe = useMemo(() => agendas.evenements.filter((e) => !e.journee && !e.libre).map((e) => ({ date: e.date, debut: e.heure, fin: e.fin })), [agendas.evenements]);
  const enRetard = useMemo(() => courantes.filter(estEnRetard), [courantes]);
  // Pastille sur l'icône de l'application installée : tâches encore à faire aujourd'hui.
  useEffect(() => {
    if (charge) mettrePastille(developper(taches, isoAujourdhui, isoAujourdhui).filter((t) => t.date === isoAujourdhui && !t.faite).length);
  }, [charge, taches, isoAujourdhui]);
  const listeCalendrier = useMemo(
    () => developper(taches, grille.debut, grille.fin).filter((t) => passeLesFiltres(t, filtres)).sort(comparer),
    [taches, grille, filtres],
  );
  const listeCourante = useMemo(
    () => courantes.filter((t) => passeLesFiltres(t, filtres)).sort(comparer),
    [courantes, filtres],
  );
  const liste = vueCalendrier ? listeCalendrier : listeCourante;
  // Compteurs : « restantes » et « en retard » sur les entrées courantes, avancement sur la période.
  const tachesPeriode = useMemo(() => (plage ? developper(taches, plage.debut, plage.fin) : courantes),
    [taches, plage?.debut, plage?.fin, courantes]); // eslint-disable-line react-hooks/exhaustive-deps
  // Planificateur : il doit voir les occurrences des semaines à venir pour éviter leurs créneaux.
  const tachesPlanif = useMemo(
    () => (planifOuverte ? developper(taches, versISO(ajouterJours(aujourdhui(), -7)), versISO(ajouterJours(aujourdhui(), 70))) : taches),
    [taches, planifOuverte],
  );

  /* ---------- Actions ---------- */
  function dateParDefaut(): string {
    if (vue === "checklist") return ""; // depuis l'onglet Checklist, une nouvelle tâche est sans date
    const iso = versISO(aujourdhui());
    if (!plage || (iso >= plage.debut && iso <= plage.fin)) return iso;
    return plage.debut;
  }

  const actions: ActionsAgenda = {
    cocher: (id) => { basculerFaite(id); },
    /* Cocher une étape ou un élément du matériel. Quand la DERNIÈRE étape est cochée, on
       propose de cocher la tâche (sans le faire d'office : on peut avoir ajouté une étape
       en route, ou vouloir relire avant de clore). */
    cocherCase: async (id, genre, cle) => {
      const apres = await cocherCase(id, genre, cle);
      const etapes = apres?.etapes ?? [];
      if (!apres || genre !== "etape" || apres.faite || etapes.length === 0 || etapes.some((e) => !e.faite)) return;
      setMessageDepot({
        texte: `Toutes les étapes de « ${apres.titre} » sont faites.`, annuler: null, cle: Date.now(),
        action: { libelle: "Cocher la tâche", faire: () => { basculerFaite(id); setMessageDepot({ texte: `« ${apres.titre} » est faite.`, annuler: null, cle: Date.now() }); } },
      });
    },
    modifier: (id) => setFormulaire({ tacheId: id }),
    supprimer: (id) => {
      const occ = analyserId(id);
      if (occ) {
        const serie = taches.find((t) => t.id === occ.serieId);
        if (serie) setSuppressionOccurrence({ ...occ, titre: serie.titre });
      } else mettreALaCorbeille(id);
    },
    ajouterLe: (iso) => setFormulaire({ tacheId: null, date: iso }),
    allerAuJour: (iso) => { setDateRef(depuisISO(iso)); setVue("jour"); },
    planifier: () => setPlanifOuverte(true),
    titreProjet: (id) => idees.projets.find((p) => p.id === id)?.titre,
  };

  /* ---------- Glisser-déposer ----------
     - une tâche (ou une occurrence) : change de jour (et d'heure dans la vue Jour) ;
       une tâche répétée : seul CE jour est déplacé, la série ne bouge pas ;
     - déposée sur « Sans date » : la tâche retourne dans la Checklist ;
     - un projet ou une idée : devient une NOUVELLE tâche datée, catégorie « Projets »,
       liée au projet (badge sur la carte). Le projet et ses idées restent inchangés. */
  async function deposer(g: Glisse, c: Cible) {
    const lieu = libelleCible(c, g);
    if (g.type === "tache") {
      const t = g.tache;
      const heure = c.date === "" ? "" : c.heure ?? t.heure;
      if (t.date === c.date && t.heure === heure) return; // reposée au même endroit
      const annuler = await deplacerTache(t.id, c.date, heure);
      if (annuler) afficherDepot(
        c.date ? `« ${t.titre} » déplacée : ${lieu}.` : `« ${t.titre} » remise dans la Checklist (sans date).`,
        t.occurrence ? "Tâche répétée : seul ce jour a été déplacé, le reste de la série ne change pas." : undefined,
        annuler);
      return;
    }
    const projet = g.projet;
    const texte = g.type === "projet" ? g.projet.titre : g.idee.texte.trim();
    const premiereLigne = texte.split("\n")[0].slice(0, 120);
    const annuler = await creerDepuis({
      titre: premiereLigne, description: texte !== premiereLigne ? texte : "",
      date: c.date, heure: c.heure ?? "", dureeMinutes: null, lieu: "", echeance: "", materiel: "",
      categorie: "projets", priorite: "moyenne", groupe: null, couleur: null, recurrence: null,
      projetId: projet?.id ?? null, rappelMinutes: c.heure ? reglages.rappelDefaut : null,
    });
    if (annuler) afficherDepot(
      `${g.type === "projet" ? "Projet" : "Idée"} « ${premiereLigne} » ajouté${g.type === "idee" ? "e" : ""} ${c.date ? `à l'agenda : ${lieu}` : "à la Checklist (sans date)"}.`,
      "Une tâche liée au projet a été créée ; le projet et ses idées restent dans la Checklist.",
      annuler);
  }

  function afficherDepot(texte: string, detail: string | undefined, annuler: () => Promise<boolean>) {
    setMessageDepot({ texte, detail, annuler, cle: Date.now() });
  }
  // Le message disparaît seul après 8 s (ou au dépôt suivant, qui le remplace).
  useEffect(() => {
    if (!messageDepot) return;
    const minuterie = setTimeout(() => setMessageDepot(null), 8000);
    return () => clearTimeout(minuterie);
  }, [messageDepot]);
  async function annulerDepot() {
    const a = messageDepot?.annuler;
    if (!a) return;
    setMessageDepot({ ...messageDepot, annuler: null, texte: "Annulation…", detail: undefined });
    const ok = await a();
    setMessageDepot(ok ? { texte: "C'est annulé : tout est revenu comme avant.", annuler: null, cle: Date.now() } : null);
  }

  /* Supprimer = mettre à la corbeille, sans fenêtre « Êtes-vous sûr ? » : un message
     propose « Annuler » pendant 8 s, et la tâche reste 30 jours dans la corbeille.
     (Une confirmation à chaque fois finit par être validée sans être lue ; l'annulation
     protège mieux : NN/g, « Confirmation Dialogs », 2018.) */
  async function mettreALaCorbeille(id: string): Promise<boolean> {
    const tache = taches.find((t) => t.id === id);
    if (!tache) return false;
    if (!corbeilleDisponible() && !confirm(`Supprimer définitivement la tâche « ${tache.titre} » ?`)) return false;
    const r = await supprimer(id);
    if (r) annoncerSuppression(`« ${tache.titre} » ${r.enCorbeille ? "mise à la corbeille" : "supprimée"}.`, r);
    return r !== null;
  }
  function annoncerSuppression(texte: string, r: { annuler: () => Promise<boolean>; enCorbeille: boolean }) {
    setMessageDepot({ texte, detail: r.enCorbeille ? "Récupérable 30 jours dans la corbeille." : undefined,
      annuler: r.enCorbeille ? r.annuler : null, cle: Date.now() });
  }
  async function supprimerUneOccurrence(serieId: string, date: string, portee: Portee): Promise<boolean> {
    const titre = taches.find((t) => t.id === serieId)?.titre ?? "";
    const r = await supprimerOccurrence(serieId, date, portee);
    const textes = { occurrence: `Ce jour de « ${titre} » est supprimé.`, suivantes: `« ${titre} » : ce jour et les suivants sont supprimés.`, serie: `La série « ${titre} » est mise à la corbeille.` };
    if (r) annoncerSuppression(textes[portee], { ...r, enCorbeille: portee === "serie" ? r.enCorbeille && corbeilleDisponible() : true });
    return r !== null;
  }

  async function enregistrer(d: DonneesTache, portee: Portee): Promise<boolean> {
    const occ = formulaire?.tacheId ? analyserId(formulaire.tacheId) : null;
    const ok = occ ? await modifierOccurrence(occ.serieId, occ.date, portee, d)
      : formulaire?.tacheId ? await modifier(formulaire.tacheId, d) : await ajouter(d);
    // Si la date choisie n'est pas visible, on déplace l'agenda pour la montrer.
    if (ok && plage && d.date && (d.date < plage.debut || d.date > plage.fin)) setDateRef(depuisISO(d.date));
    return ok;
  }

  /* ---------- Planification automatique ---------- */
  function memoriserAnnulation(d: DernierPlanning | null) {
    setDernierPlanning(d);
    try {
      if (d) localStorage.setItem(CLE_ANNULATION, JSON.stringify(d));
      else localStorage.removeItem(CLE_ANNULATION);
    } catch { /* navigateur privé : l'annulation ne marchera que jusqu'au rechargement */ }
  }

  async function appliquerPlanning(planning: Planning): Promise<boolean> {
    const avant = planning.placements.map((p) => {
      const t = taches.find((x) => x.id === p.tacheId);
      return { id: p.tacheId, date: t?.date ?? "", heure: t?.heure ?? "" };
    });
    const apres = planning.placements.map((p) => ({ id: p.tacheId, date: p.date, heure: p.heure }));
    const ok = await changerHoraires(apres);
    if (ok) {
      memoriserAnnulation({ nom: planning.nom, avant, apres });
      setMessagePlanif("");
      setDateRef(depuisISO(apres[0].date)); // on montre la semaine planifiée
      setVue("semaine");
    }
    return ok;
  }

  /* Annulation : on ne remet en Checklist QUE les tâches dont l'horaire est encore celui
     posé par le planning. Une tâche que tu as déplacée ou modifiée à la main entre-temps
     n'est pas touchée (on ne veut pas écraser ton choix). */
  async function annulerPlanning() {
    if (!dernierPlanning) return;
    const aRemettre = dernierPlanning.apres.filter((a) => {
      const t = taches.find((x) => x.id === a.id);
      return t && t.date === a.date && t.heure === a.heure;
    });
    const ignorees = dernierPlanning.apres.length - aRemettre.length;
    const ids = new Set(aRemettre.map((a) => a.id));
    const ok = await changerHoraires(dernierPlanning.avant.filter((a) => ids.has(a.id)));
    if (ok) {
      memoriserAnnulation(null);
      setMessagePlanif(`Planning annulé : ${aRemettre.length} tâche(s) remise(s) dans la Checklist.` +
        (ignorees ? ` ${ignorees} tâche(s) déplacée(s), modifiée(s) ou supprimée(s) depuis n'ont pas été touchées.` : ""));
    }
  }

  async function effacerFaites() {
    const n = taches.filter((t) => t.faite).length;
    if (n === 0) return alert("Aucune tâche terminée à effacer.");
    if (!confirm(corbeilleDisponible() ? `Mettre ${n} tâche(s) terminée(s) à la corbeille ?` : `Supprimer définitivement ${n} tâche(s) terminée(s) ?`)) return;
    const r = await effacerTerminees();
    if (r) annoncerSuppression(`${n} tâche(s) terminée(s) ${r.enCorbeille ? "mise(s) à la corbeille" : "supprimée(s)"}.`, r);
  }

  function exporter() {
    const blob = new Blob([JSON.stringify(taches, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const lien = document.createElement("a");
    lien.href = url;
    lien.download = `agenda-taches-${versISO(aujourdhui())}.json`;
    lien.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importerFichier(e: ChangeEvent<HTMLInputElement>) {
    const fichier = e.target.files?.[0];
    e.target.value = ""; // permet de réimporter le même fichier plus tard
    if (!fichier) return;
    let liste;
    try {
      liste = validerTaches(JSON.parse(await fichier.text()));
    } catch {
      liste = null;
    }
    if (!liste) return alert("Ce fichier n'est pas un export valide de l'agenda.");
    if (confirm(`Ajouter ${liste.length} tâche(s) à ton agenda ?`)) await importer(liste);
  }

  /* ---------- Prototype téléphone ---------- */
  // Balayage ← d'une carte (téléphone) : une tâche en retard revient à aujourd'hui, les autres passent au lendemain.
  async function reporter(t: Tache) {
    const iso = versISO(aujourdhui());
    const cible = t.date < iso ? iso : versISO(ajouterJours(depuisISO(t.date), 1));
    const annuler = await deplacerTache(t.id, cible, t.heure);
    if (annuler) afficherDepot(`« ${t.titre} » reportée ${cible === iso ? "à aujourd'hui" : "au " + libelleCible({ date: cible, heure: null })}.`, undefined, annuler);
  }
  // Option C, saisie rapide : titre + date + heure, le reste par défaut.
  async function creerRapide(b: BrouillonSaisie): Promise<boolean> {
    const ok = await ajouter({
      description: "", echeance: "", materiel: "", priorite: "moyenne", ...b,
      categorie: filtres.categorie !== "toutes" ? filtres.categorie : "perso", groupe: null,
      couleur: null, projetId: null, rappelMinutes: b.heure ? reglages.rappelDefaut : null,
    });
    if (ok) {
      const ou = !b.date ? " à la Checklist" : b.recurrence ? ` (${libelleRepetition(b.recurrence, b.date).toLowerCase()})` : "";
      setMessageDepot({ texte: `« ${b.titre} » ajoutée${ou}.`, annuler: null, cle: Date.now() });
    }
    return ok;
  }
  // « Corriger dans le formulaire » : le formulaire complet s'ouvre avec ce qui a été compris.
  const ouvrirDepuisSaisie = (b: BrouillonSaisie | null) => setFormulaire(b ? { tacheId: null, date: b.date, brouillon: b } : { tacheId: null });
  const balayageJour = useBalayage(() => setDateRef((d) => ajouterJours(d, 1)), () => setDateRef((d) => ajouterJours(d, -1)));
  const ecranB = mobile === "b" && vue === "jour";
  const ecranC = mobile === "c" && vue === "liste";

  /* ---------- Raccourcis clavier ---------- */
  useEffect(() => {
    function auClavier(e: KeyboardEvent) {
      if (formulaire || synchroOuverte || planifOuverte || journeeOuverte || rappelsOuvert || corbeilleOuverte || agendasOuvert || e.ctrlKey || e.metaKey || e.altKey) return;
      // Pendant un glissement au clavier, les flèches choisissent la zone de dépôt (pas la période).
      if (e.defaultPrevented || document.body.classList.contains("glissement-en-cours")) return;
      const cible = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(cible.tagName)) return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); setFormulaire({ tacheId: null }); }
      else if (e.key === "t" || e.key === "T") setDateRef(aujourdhui());
      else if (e.key === "ArrowLeft" && navigable) setDateRef((d) => deplacer(vue, d, -1));
      else if (e.key === "ArrowRight" && navigable) setDateRef((d) => deplacer(vue, d, 1));
    }
    document.addEventListener("keydown", auClavier);
    return () => document.removeEventListener("keydown", auClavier);
  }, [formulaire, synchroOuverte, planifOuverte, journeeOuverte, rappelsOuvert, corbeilleOuverte, agendasOuvert, vue, navigable]);

  /* ---------- Affichage ---------- */
  const propsVue = { dateRef, liste, actions, evenements: agendas.parDate };
  const suggestionsJournee = useMemo(() => taches.filter((t) => !t.faite && t.date === "").length, [taches]);
  const notifActives = etatNotif === "actives";
  // Pour une occurrence (id "serie~date"), le formulaire reçoit la SÉRIE + la date de l'occurrence.
  const occEnEdition = formulaire?.tacheId ? analyserId(formulaire.tacheId) : null;
  const tacheEnEdition = formulaire?.tacheId
    ? taches.find((t) => t.id === (occEnEdition?.serieId ?? formulaire.tacheId)) ?? null : null;

  async function supprimerDepuisFormulaire(portee: Portee): Promise<boolean> {
    if (!formulaire?.tacheId) return false;
    if (!occEnEdition) return mettreALaCorbeille(formulaire.tacheId);
    return supprimerUneOccurrence(occEnEdition.serieId, occEnEdition.date, portee);
  }

  return (
    <FournisseurGlisser actif={charge && vueCalendrier} onDeposer={deposer}
      onNaviguer={(sens) => setDateRef((d) => deplacer(vue, d, sens))}
      rendreTache={(t, compacte) => <div className={`vue-${vue}`}><CarteTache tache={t} actions={actions} compacte={compacte} fantome /></div>}>
    <div className={`page${mobile ? ` mobile mobile-${mobile}` : ""}${rechercheOuverte ? " recherche-ouverte" : ""}`}>
      {mobile ? (
        <EnteteMobile
          titre={ecranB ? titreCourt("mois", dateRef) : titreCourt(vue, dateRef)}
          navigable={navigable && !ecranB}
          onPrecedent={() => setDateRef(deplacer(vue, dateRef, -1))}
          onSuivant={() => setDateRef(deplacer(vue, dateRef, 1))}
          onAujourdhui={() => setDateRef(aujourdhui())}
          rechercheOuverte={rechercheOuverte}
          onRecherche={() => setRechercheOuverte((o) => !o)}
          onTitre={ecranB ? () => setMoisOuvert((o) => !o) : undefined}
          titreDeplie={moisOuvert}
          boutonAujourdhui={ecranB && versISO(dateRef) !== versISO(aujourdhui())}
        />
      ) : (
      <header className="entete">
        <h1 className="titre-app"><Logo /> <NomApp /></h1>
        <Compteurs taches={courantes} tachesPeriode={tachesPeriode} plage={plage} />
        <div className="actions-entete">
        <button type="button" className={`btn-icone btn-cloche${notifActives ? " active" : ""}`} onClick={() => setRappelsOuvert(true)}
          aria-label={notifActives ? "Rappels activés : réglages" : "Activer les rappels"} title={notifActives ? "Rappels activés" : "Activer les rappels"}>
          {notifActives ? <BellRing aria-hidden="true" /> : <Bell aria-hidden="true" />}
          {!notifActives && etatNotif && etatNotif !== "indisponible" && <span className="point-cloche" aria-hidden="true" />}
        </button>
        <button type="button" className="btn btn-journee" title="Préparer ma journée : retards, choix, planning"
          onClick={() => setJourneeOuverte(true)}>
          <Sunrise aria-hidden="true" /> Ma journée
        </button>
        <button type="button" className="btn" title="Placer automatiquement les tâches de la Checklist dans la semaine"
          onClick={() => setPlanifOuverte(true)}>
          <IconePlanifier /> Planifier ma semaine
        </button>
        <button type="button" className="btn btn-principal" title="Raccourci : touche N"
          onClick={() => setFormulaire({ tacheId: null })}>
          <IconeAjouter /> Nouvelle tâche
        </button>
        </div>
      </header>
      )}

      {/* Ordinateur : ajout en une phrase toujours visible (sur téléphone : bouton « + »). */}
      {!mobile && (
        <BarreSaisieRapide key={dateParDefaut()} dateDefaut={dateParDefaut()} onCreer={creerRapide} onDetails={ouvrirDepuisSaisie} />
      )}

      {erreur && (
        <div className="bandeau-erreur" role="alert">
          <span>Problème de connexion à la base : {erreur}</span>
          <button type="button" className="btn-icone" aria-label="Fermer" onClick={effacerErreur}><IconeFermer /></button>
        </div>
      )}

      {dernierPlanning && (
        <div className="bandeau-info" role="status">
          <span><IconeSucces /> Planning « {dernierPlanning.nom} » appliqué à {dernierPlanning.apres.length} tâche(s).</span>
          <button type="button" className="btn" onClick={annulerPlanning}><IconeAnnuler /> Annuler ce planning</button>
          <button type="button" className="btn-icone" aria-label="Fermer (le planning est gardé)" title="Fermer (le planning est gardé)"
            onClick={() => memoriserAnnulation(null)}><IconeFermer /></button>
        </div>
      )}
      {messagePlanif && (
        <div className="bandeau-info" role="status">
          <span>{messagePlanif}</span>
          <button type="button" className="btn-icone" aria-label="Fermer" onClick={() => setMessagePlanif("")}><IconeFermer /></button>
        </div>
      )}

      <section className="barre-outils">
        {navigable && (
          <div className="navigation">
            {/* Pendant un glissement, garder l'élément au-dessus de ‹ ou › change de période. */}
            <ZoneDepot id="nav:-1" nav={-1} libelle="Période précédente" className="zone-nav">
              <button type="button" className="btn" aria-label="Période précédente" onClick={() => setDateRef(deplacer(vue, dateRef, -1))}><IconePrecedent /></button>
            </ZoneDepot>
            <button type="button" className="btn" onClick={() => setDateRef(aujourdhui())}>Aujourd&apos;hui</button>
            <ZoneDepot id="nav:1" nav={1} libelle="Période suivante" className="zone-nav">
              <button type="button" className="btn" aria-label="Période suivante" onClick={() => setDateRef(deplacer(vue, dateRef, 1))}><IconeSuivant /></button>
            </ZoneDepot>
          </div>
        )}
        <h2>{titrePeriode(vue, dateRef)}</h2>
        <div className="onglets" role="tablist" aria-label="Vue de l'agenda">
          {VUES.map((v) => (
            <button key={v.id} type="button" role="tab" aria-selected={vue === v.id}
              className={vue === v.id ? "actif" : ""} onClick={() => setVue(v.id)}>
              {v.libelle}
            </button>
          ))}
        </div>
      </section>

      <section className="filtres">
        <label className="champ-recherche">
          <IconeRecherche />
          <input type="search" placeholder="Rechercher une tâche…" aria-label="Rechercher"
            value={filtres.recherche} onChange={(e) => setFiltres({ ...filtres, recherche: e.target.value })} />
        </label>
        <select aria-label="Filtrer par catégorie" value={filtres.categorie}
          onChange={(e) => setFiltres({ ...filtres, categorie: e.target.value as Filtres["categorie"] })}>
          <option value="toutes">Toutes les catégories</option>
          <option value="perso">Personnel</option>
          <option value="travail">Travail</option>
          <option value="projets">Projets</option>
        </select>
        <select aria-label="Filtrer par priorité" value={filtres.priorite}
          onChange={(e) => setFiltres({ ...filtres, priorite: e.target.value as Filtres["priorite"] })}>
          <option value="toutes">Toutes les priorités</option>
          <option value="haute">Priorité haute</option>
          <option value="moyenne">Priorité moyenne</option>
          <option value="basse">Priorité basse</option>
        </select>
        <select aria-label="Filtrer par statut" value={filtres.statut}
          onChange={(e) => setFiltres({ ...filtres, statut: e.target.value as Filtres["statut"] })}>
          <option value="toutes">Tous les statuts</option>
          <option value="afaire">À faire</option>
          <option value="faites">Terminées</option>
          <option value="retard">En retard</option>
        </select>
      </section>

      {ecranB && (
        <BandeauSemaine dateRef={dateRef} onChoisir={setDateRef} taches={taches} filtres={filtres}
          moisOuvert={moisOuvert} onFermerMois={() => setMoisOuvert(false)} evenements={agendas.parDate} />
      )}

      <ContexteAgendas.Provider value={infosAgendas}>
      <ContexteBalayage.Provider value={mobile ? reporter : null}>
      {ecranB && charge && !invitationMasquee && versISO(dateRef) === versISO(aujourdhui()) && (
        <InvitationJournee enRetard={enRetard.length} suggestions={suggestionsJournee} onOuvrir={() => setJourneeOuverte(true)}
          onMasquer={() => { masquerInvitationAujourdhui(); setInvitationMasquee(true); }} />
      )}
      {ecranB && charge && versISO(dateRef) === versISO(aujourdhui()) && (
        <LigneRetard taches={listeCourante.filter(estEnRetard)} actions={actions} />
      )}
      <AstuceBalayage actif={!!mobile && charge && vue === "jour"} />
      <main className={`vue vue-${vue}`} {...(ecranB ? balayageJour : {})}>
        {!charge ? <p className="vide">Chargement des tâches…</p>
          : ecranC ? <FilContinu taches={taches} filtres={filtres} actions={actions} />
          : vue === "jour" ? <VueJour {...propsVue} />
          : vue === "semaine" ? <VueSemaine {...propsVue} />
          : vue === "mois" ? <VueMois {...propsVue} />
          : vue === "tri" ? <VueTri {...propsVue} />
          : vue === "checklist" ? <VueChecklist {...propsVue} idees={idees} />
          : <VueListe {...propsVue} />}
      </main>
      </ContexteBalayage.Provider>
      </ContexteAgendas.Provider>

      {/* Sous les vues calendrier (Jour, Semaine, Mois), la Checklist est aussi affichée
          en bas de page : on y arrive en faisant défiler. Même composant et mêmes données
          (liste filtrée + actions) que l'onglet Checklist : rien n'est dupliqué. */}
      {charge && vueCalendrier && (
        <section id="checklist" className="checklist-sous-agenda" aria-labelledby="titre-checklist-sous-agenda">
          <h2 id="titre-checklist-sous-agenda"><IconeChecklist /> Checklist</h2>
          <VueChecklist {...propsVue} liste={listeCourante} sousAgenda idees={idees} />
        </section>
      )}

      <footer className="pied">
        <button type="button" className="btn btn-principal" onClick={() => setSynchroOuverte(true)}><IconeSynchro /> Synchroniser mon calendrier</button>
        <button type="button" className="btn" onClick={() => setAgendasOuvert(true)}><CalendarDays aria-hidden="true" /> Mes agendas (Google, Outlook){agendas.agendas.length > 0 ? ` · ${agendas.agendas.length}` : ""}</button>
        <button type="button" className="btn" onClick={() => setCorbeilleOuverte(true)}><IconeSupprimer /> Corbeille</button>
        <button type="button" className="btn" onClick={exporter}><IconeExporter /> Exporter (JSON)</button>
        <button type="button" className="btn" onClick={() => champFichier.current?.click()}><IconeImporter /> Importer</button>
        <input ref={champFichier} type="file" accept="application/json,.json" hidden onChange={importerFichier} />
        <button type="button" className="btn btn-danger" onClick={effacerFaites}>Effacer les tâches terminées</button>
        <span className="aide">Raccourcis : <kbd>A</kbd> ajout en une phrase · <kbd>N</kbd> nouvelle tâche · <kbd>←</kbd> <kbd>→</kbd> naviguer · <kbd>T</kbd> aujourd&apos;hui · glisser une carte pour la déplacer (<kbd>Échap</kbd> annule)</span>
        <span className="utilisateur">
          {utilisateur.email}
          <button type="button" className="lien" onClick={() => supabase().auth.signOut()}>Se déconnecter</button>
        </span>
      </footer>

      {mobile && (
        <>
          {/* « + » : ajout en une phrase (le formulaire complet reste à un toucher, « Plus de détails »). */}
          <BoutonFlottant onClick={() => (mobile === "a" ? setFormulaire({ tacheId: null }) : setSaisieOuverte(true))} />
          <BarreBas variante={mobile} vue={vue} onVue={(v) => { setVue(v); if (v === "jour" || v === "liste") setDateRef(aujourdhui()); }}
            onPlus={() => setPlusOuvert(true)} />
        </>
      )}
      {plusOuvert && mobile && (
        <MenuPlus vue={vue} onVue={setVue} onFermer={() => setPlusOuvert(false)}
          raccourcis={[
            { libelle: "Ma journée", detail: enRetard.length ? `${enRetard.length} en retard à trier` : "Préparer aujourd'hui", icone: <Sunrise aria-hidden="true" />, onClick: () => setJourneeOuverte(true), accent: true },
            { libelle: "Rappels", detail: notifActives ? "Activés ici" : "À activer", icone: notifActives ? <BellRing aria-hidden="true" /> : <Bell aria-hidden="true" />, onClick: () => setRappelsOuvert(true) },
            { libelle: "Mes agendas", detail: agendas.agendas.length ? `${agendas.agendas.length} branché${agendas.agendas.length > 1 ? "s" : ""}` : "Google, Outlook", icone: <CalendarDays aria-hidden="true" />, onClick: () => setAgendasOuvert(true) },
            { libelle: "Corbeille", detail: "30 jours pour récupérer", icone: <IconeSupprimer />, onClick: () => setCorbeilleOuverte(true) },
          ]}
          compteurs={<Compteurs taches={courantes} tachesPeriode={tachesPeriode} plage={plage} />}
          actions={[
            { libelle: "Planifier ma semaine", icone: <IconePlanifier />, onClick: () => setPlanifOuverte(true) },
            { libelle: "Synchroniser mon calendrier", icone: <IconeSynchro />, onClick: () => setSynchroOuverte(true) },
            { libelle: "Exporter (JSON)", icone: <IconeExporter />, onClick: exporter },
            { libelle: "Importer", icone: <IconeImporter />, onClick: () => champFichier.current?.click() },
            { libelle: "Effacer les tâches terminées", detail: "vers la corbeille", icone: <IconeSupprimer />, onClick: effacerFaites, danger: true },
            { libelle: `Se déconnecter (${utilisateur.email ?? ""})`, icone: <LogOut aria-hidden="true" />, onClick: () => supabase().auth.signOut() },
          ]} />
      )}
      {saisieOuverte && (
        <SaisieRapide onCreer={creerRapide} onDetails={ouvrirDepuisSaisie} onFermer={() => setSaisieOuverte(false)}
          jourAffiche={ecranB ? versISO(dateRef) : undefined} />
      )}

      {/* Le formulaire n'existe dans la page que lorsqu'il est ouvert.
          "key" change à chaque ouverture : React recrée alors un formulaire neuf, avec des champs réinitialisés. */}
      {formulaire && (
        <FormulaireTache
          key={`${formulaire.tacheId ?? "nouvelle"}-${formulaire.date ?? "defaut"}-${formulaire.brouillon?.titre ?? ""}`}
          brouillon={formulaire.brouillon}
          tache={tacheEnEdition}
          occurrence={occEnEdition?.date}
          dateParDefaut={formulaire.date ?? dateParDefaut()}
          categorieParDefaut={filtres.categorie !== "toutes" ? filtres.categorie : "perso"}
          onEnregistrer={enregistrer}
          onSupprimer={supprimerDepuisFormulaire}
          onFermer={() => setFormulaire(null)}
          rappelDefaut={reglages.rappelDefaut}
          notificationsActives={notifActives}
          onReglerRappels={() => setRappelsOuvert(true)}
        />
      )}

      {synchroOuverte && <SynchroCalendrier onFermer={() => setSynchroOuverte(false)} />}
      {suppressionOccurrence && (
        <ChoixPortee titre={suppressionOccurrence.titre} date={suppressionOccurrence.date}
          onChoisir={(p) => supprimerUneOccurrence(suppressionOccurrence.serieId, suppressionOccurrence.date, p)}
          onFermer={() => setSuppressionOccurrence(null)} />
      )}
      {planifOuverte && <Planificateur taches={tachesPlanif} onAppliquer={appliquerPlanning} onFermer={() => setPlanifOuverte(false)}
        occupe={occupe} nbAgendas={agendas.agendas.length} onAgendas={() => { setPlanifOuverte(false); setAgendasOuvert(true); }} />}
      {rappelsOuvert && <Rappels reglages={reglages} disponibles={rappelsDisponibles()} onReglages={enregistrerReglages} onEtat={setEtatNotif} onFermer={() => setRappelsOuvert(false)} />}
      {corbeilleOuverte && <Corbeille lister={listerCorbeille} restaurer={restaurer} supprimerDefinitivement={supprimerDefinitivement}
        disponible={corbeilleDisponible()} onFermer={() => setCorbeilleOuverte(false)} />}
      {agendasOuvert && <AgendasExternes donnees={agendas} onFermer={() => setAgendasOuvert(false)} />}
      {journeeOuverte && (
        <MaJournee taches={taches} enRetard={enRetard} evenements={agendas.parDate.get(isoAujourdhui) ?? []}
          deplacer={deplacerTache} cocher={basculerFaite} appliquer={changerHoraires}
          onTermine={(texte, annuler) => { setInvitationMasquee(true); setDateRef(aujourdhui()); if (!mobile) setVue("jour"); setMessageDepot({ texte, annuler, cle: Date.now() }); }}
          onFermer={() => setJourneeOuverte(false)} />
      )}

      {messageDepot && (
        <div key={messageDepot.cle} className="toast-depot" role="status">
          <IconeSucces />
          <span className="toast-texte">
            {messageDepot.texte}
            {messageDepot.detail && <small>{messageDepot.detail}</small>}
          </span>
          {messageDepot.annuler && <button type="button" className="btn" onClick={annulerDepot}><IconeAnnuler /> Annuler</button>}
          {messageDepot.action && <button type="button" className="btn btn-principal" onClick={messageDepot.action.faire}><IconeValide /> {messageDepot.action.libelle}</button>}
          <button type="button" className="btn-icone" aria-label="Fermer" onClick={() => setMessageDepot(null)}><IconeFermer /></button>
        </div>
      )}
    </div>
    </FournisseurGlisser>
  );
}
