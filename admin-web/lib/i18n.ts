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
