import { supabase } from "./supabase";

// The driver's engagement — the articles they accept before joining the queue.
//
// The ARTICLES COME FROM THE SERVER, not from this bundle. Article 7 says the document
// changes with seven days' notice; a copy compiled into the app could never honour that,
// least of all on iOS where a build can sit unreleased for weeks. Editing
// loadq_undertaking_articles changes what every driver sees, immediately.
export type UndertakingArticle = {
  no: string;
  title_fr: string; title_en: string;
  body_fr: string;  body_en: string;
  key: boolean;
};

export type UndertakingState = {
  version: string;
  required: boolean;   // scoped by loadq_settings.undertaking_required_from
  signed: boolean;
  name: string | null;
  articles: UndertakingArticle[];
};

export const UndertakingAPI = {
  async get(): Promise<UndertakingState | null> {
    const { data, error } = await supabase.rpc("loadq_my_undertaking");
    if (error) return null;
    return data as UndertakingState;
  },

  // The typed name is the signature. The server stamps driver, version, method and time —
  // nothing about the record is supplied by the client beyond the name.
  async sign(signedName: string, zoneId?: string | null): Promise<{ error?: string }> {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { error: "not signed in" };
    const { data, error } = await supabase.rpc("loadq_sign_undertaking", {
      p_driver: user.id,
      p_signed_name: signedName,
      p_method: "app",
      p_zone: zoneId ?? null,
    });
    if (error) return { error: error.message };
    if (data && (data as any).ok === false) return { error: (data as any).error };
    return {};
  },
};
