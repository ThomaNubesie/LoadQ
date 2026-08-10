"use client";
import { useEffect, useState } from "react";

// Extensible i18n for the LoadQ admin. Each key maps a language code to its
// string. Adding a new language = add its code to `Lang`/`LANGS` and fill (or
// omit → English fallback) the column — no call sites change. Pages call t("key").
export type Lang = "en" | "fr";
export const LANGS: Lang[] = ["en", "fr"];
export const LANG_LABEL: Record<Lang, string> = { en: "EN", fr: "FR" };

const DICT = {
  // nav
  navZones:       { en: "Zones", fr: "Zones" },
  navQueue:       { en: "Queue", fr: "File" },
  navDocuments:   { en: "Documents", fr: "Documents" },
  navRelocate:    { en: "Relocate", fr: "Déplacer" },
  navRides:         { en: "Rides", fr: "Courses" },
  ridesTitle:       { en: "Rides", fr: "Courses" },
  ridesSub:         { en: "On-route pickup & on-demand dispatch — live requests, payment & driver.", fr: "Ramassage sur le trajet & à la demande — demandes en direct, paiement et chauffeur." },
  ridesNone:        { en: "No ride requests.", fr: "Aucune demande de course." },
  ridesColRoute:    { en: "Pickup → Destination", fr: "Ramassage → Destination" },
  ridesColKind:     { en: "Type", fr: "Type" },
  ridesColStatus:   { en: "Status", fr: "Statut" },
  ridesColPay:      { en: "Payment", fr: "Paiement" },
  ridesColFare:     { en: "Fare", fr: "Tarif" },
  ridesColDriver:   { en: "Driver", fr: "Chauffeur" },
  ridesMarkPaid:    { en: "Mark paid", fr: "Marquer payé" },
  ridesKindRoute:   { en: "On-route", fr: "Sur trajet" },
  ridesKindOnDemand:{ en: "On-demand", fr: "À la demande" },
  ridesOffersOut:   { en: "{n} offer(s) out", fr: "{n} offre(s) en cours" },
  relTitle:         { en: "Relocate", fr: "Déplacer" },
  relSub:           { en: "Move a driver between zones/destinations, or a passenger to another van.", fr: "Déplacez un chauffeur entre zones/destinations, ou un passager vers un autre fourgon." },
  relDriverMode:    { en: "Driver", fr: "Chauffeur" },
  relPassengerMode: { en: "Passenger", fr: "Passager" },
  relPickDriver:    { en: "Pick a driver", fr: "Choisir un chauffeur" },
  relFromZone:      { en: "From zone", fr: "Depuis la zone" },
  relSelectZone:    { en: "Select a zone…", fr: "Choisir une zone…" },
  relNoDrivers:     { en: "No active drivers in this line.", fr: "Aucun chauffeur actif dans cette file." },
  relNoDest:        { en: "no destination", fr: "sans destination" },
  relMoveTo:        { en: "Move to", fr: "Déplacer vers" },
  relToZone:        { en: "To zone", fr: "Vers la zone" },
  relToDest:        { en: "To destination", fr: "Vers la destination" },
  relKeepDest:      { en: "Keep current destination", fr: "Garder la destination actuelle" },
  relPosition:      { en: "Queue position", fr: "Position dans la file" },
  relPosEnd:        { en: "End of line", fr: "Fin de la file" },
  relPassengers:    { en: "Booked passengers", fr: "Passagers réservés" },
  relPaxAuto:       { en: "Auto", fr: "Auto" },
  relPaxKeep:       { en: "Keep with driver", fr: "Garder avec le chauffeur" },
  relPaxRelease:    { en: "Release", fr: "Libérer" },
  relPaxHint:       { en: "Auto keeps riders on a zone move, and releases them when the destination changes.", fr: "Auto garde les passagers lors d’un changement de zone, et les libère si la destination change." },
  relDoMove:        { en: "Relocate", fr: "Déplacer" },
  relMovedDriver:   { en: "Driver relocated.", fr: "Chauffeur déplacé." },
  relPickPassenger: { en: "Find a passenger", fr: "Trouver un passager" },
  relSearchPax:     { en: "Search name or phone…", fr: "Rechercher nom ou téléphone…" },
  relCurrent:       { en: "Current reservation", fr: "Réservation actuelle" },
  relNoReservation: { en: "No active reservation.", fr: "Aucune réservation active." },
  relToDriver:      { en: "To driver", fr: "Vers le chauffeur" },
  relMovedPassenger:{ en: "Passenger relocated.", fr: "Passager déplacé." },
  signOut:        { en: "Sign out", fr: "Déconnexion" },
  loading:        { en: "Loading…", fr: "Chargement…" },

  // documents page
  docsTitle:      { en: "Driver documents", fr: "Documents des chauffeurs" },
  docsSub:        { en: "Review licence, insurance & registration — approve or reject.", fr: "Vérifiez permis, assurance et immatriculation — approuvez ou refusez." },
  refresh:        { en: "Refresh", fr: "Actualiser" },
  fPending:       { en: "Pending", fr: "En attente" },
  fApproved:      { en: "Approved", fr: "Approuvés" },
  fRejected:      { en: "Rejected", fr: "Refusés" },
  fExpired:       { en: "Expired", fr: "Expirés" },
  fAll:           { en: "All", fr: "Tous" },
  colDriver:      { en: "Driver", fr: "Chauffeur" },
  colDocument:    { en: "Document", fr: "Document" },
  colSubmitted:   { en: "Submitted", fr: "Soumis" },
  colExpiry:      { en: "Expiry", fr: "Expiration" },
  colStatus:      { en: "Status", fr: "Statut" },
  emptyQueue:     { en: "No documents here.", fr: "Aucun document ici." },
  selectHint:     { en: "Select a document on the left to review it.", fr: "Sélectionnez un document à gauche pour l’examiner." },

  // doc types
  drivers_license:{ en: "Driver's licence", fr: "Permis de conduire" },
  insurance:      { en: "Insurance", fr: "Assurance" },
  registration:   { en: "Vehicle registration", fr: "Immatriculation" },

  // statuses
  stPending:      { en: "pending", fr: "en attente" },
  stApproved:     { en: "approved", fr: "approuvé" },
  stRejected:     { en: "rejected", fr: "refusé" },
  stExpired:      { en: "expired", fr: "expiré" },

  // review panel
  imageLoading:   { en: "Loading image…", fr: "Chargement de l’image…" },
  imageFailed:    { en: "Could not load image.", fr: "Impossible de charger l’image." },
  openFull:       { en: "Open full size", fr: "Ouvrir en grand" },
  submittedAt:    { en: "Submitted", fr: "Soumis le" },
  plate:          { en: "Plate", fr: "Plaque" },
  expiryLabel:    { en: "Expiry date (optional)", fr: "Date d’expiration (facultatif)" },
  reasonLabel:    { en: "Rejection reason (shown to the driver)", fr: "Motif du refus (visible par le chauffeur)" },
  reasonPh:       { en: "e.g. Photo is blurry — please retake in good light.", fr: "ex. Photo floue — reprenez-la avec un bon éclairage." },
  approve:        { en: "Approve", fr: "Approuver" },
  reject:         { en: "Reject", fr: "Refuser" },
  reasonRequired: { en: "Enter a reason before rejecting.", fr: "Saisissez un motif avant de refuser." },
  approvedMsg:    { en: "Approved.", fr: "Approuvé." },
  rejectedMsg:    { en: "Rejected — the driver has been asked to resubmit.", fr: "Refusé — le chauffeur doit resoumettre." },
  nowVerified:    { en: "✓ Driver is now fully verified.", fr: "✓ Le chauffeur est maintenant entièrement vérifié." },
  currentExpiry:  { en: "Current expiry", fr: "Expiration actuelle" },
} as const;

export type I18nKey = keyof typeof DICT;

let _lang: Lang = "en";
const _listeners = new Set<() => void>();
if (typeof window !== "undefined") {
  const s = window.localStorage.getItem("loadqAdminLang");
  if (s === "en" || s === "fr") _lang = s;
}

export function setLang(l: Lang) {
  _lang = l;
  if (typeof window !== "undefined") window.localStorage.setItem("loadqAdminLang", l);
  _listeners.forEach((fn) => fn());
}

export function useLang() {
  const [lang, setL] = useState<Lang>(_lang);
  useEffect(() => {
    const u = () => setL(_lang);
    _listeners.add(u); u();
    return () => { _listeners.delete(u); };
  }, []);
  const t = (key: I18nKey): string => DICT[key]?.[lang] ?? DICT[key]?.en ?? String(key);
  return { t, lang, setLang };
}
