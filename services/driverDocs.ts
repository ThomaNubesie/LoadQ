import { supabase } from "./supabase";

// The three documents every driver must have approved to be verified. The
// backend (loadq_driver_documents + loadq_driver_doc_submit) keys on exactly
// these doc_type strings.
export type DocType = "drivers_license" | "insurance" | "registration";
export const DOC_TYPES: DocType[] = ["drivers_license", "insurance", "registration"];

export type DocStatus = "not_submitted" | "pending" | "approved" | "rejected" | "expired";

export type DriverDoc = {
  doc_type: DocType;
  status: Exclude<DocStatus, "not_submitted">;
  storage_path: string;
  expires_on: string | null;
  review_notes: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
};

// Consent version + scopes covered by the A1 verification agreement. Bumping
// the version forces drivers to re-consent (e.g. when a new check is added).
export const CONSENT_VERSION = "v1-2026-08";
export const CONSENT_SCOPES = ["drivers_license", "registration", "driving_record", "criminal_record"];

export type ScreeningConsent = { version: string; scopes: string[]; consented_at: string };

export const DriverDocsAPI = {
  // Latest active screening consent for this driver (null if none / revoked).
  async getConsent(): Promise<ScreeningConsent | null> {
    const { data, error } = await supabase.rpc("loadq_screening_consent_status");
    if (error) throw error;
    const rows = (data as ScreeningConsent[]) ?? [];
    return rows[0] ?? null;
  },

  // Record the driver's written consent to licence/registration/record checks.
  // This is the legal basis for the MTO ARP + background-check integrations.
  async recordConsent(): Promise<{ error?: string }> {
    const { error } = await supabase.rpc("loadq_record_screening_consent", {
      p_version: CONSENT_VERSION,
      p_scopes: CONSENT_SCOPES,
      p_user_agent: `loadq-app`,
    });
    return { error: error?.message };
  },

  // All of this driver's documents + the overall verified flag. Returns a row
  // only for docs that have been submitted at least once.
  async getMine(): Promise<{ docs: DriverDoc[]; verified: boolean }> {
    const { data, error } = await supabase.rpc("loadq_driver_docs_get");
    if (error) throw error;
    const rows = (data as (DriverDoc & { verified: boolean })[]) ?? [];
    return { docs: rows, verified: rows.length > 0 ? !!rows[0].verified : false };
  },

  // Upload a captured/picked image to the driver's own folder, then register it
  // (status -> pending). Storage RLS only allows writing under driver-docs/<uid>/…,
  // so the path MUST start with the auth uid.
  async upload(docType: DocType, localUri: string, expiresOn: string | null): Promise<{ error?: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const rawExt = (localUri.split("?")[0].split(".").pop() || "jpg").toLowerCase();
    const ext = rawExt === "jpeg" ? "jpg" : rawExt;
    const path = `${user.id}/${docType}.${ext}`;
    const contentType =
      ext === "png" ? "image/png" :
      ext === "webp" ? "image/webp" :
      ext === "heic" ? "image/heic" :
      ext === "pdf" ? "application/pdf" : "image/jpeg";

    // fetch(localUri).blob() often yields a 0-byte Blob in RN — read via
    // expo-file-system as base64 and convert to an ArrayBuffer instead.
    const FileSystem = await import("expo-file-system/legacy");
    const { decode } = await import("base64-arraybuffer");

    let bytes: ArrayBuffer;
    try {
      const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: "base64" as any });
      bytes = decode(base64);
    } catch (e: any) {
      return { error: `Could not read file: ${e?.message ?? "unknown"}` };
    }
    if (bytes.byteLength === 0) return { error: "File appears to be empty (0 bytes)" };

    const { error: upErr } = await supabase.storage
      .from("driver-docs")
      .upload(path, bytes, { upsert: true, contentType });
    if (upErr) return { error: upErr.message };

    // Register the upload (status -> pending, verified recomputed server-side).
    // Push notifications on submit/approve/reject/expire are fully server-side.
    const { error: rpcErr } = await supabase.rpc("loadq_driver_doc_submit", {
      p_doc_type: docType,
      p_storage_path: path,
      p_expires_on: expiresOn,
      p_doc_number: null,
    });
    if (rpcErr) return { error: rpcErr.message };

    return {};
  },
};
