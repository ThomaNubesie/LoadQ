import { supabase } from "./supabase";

export interface DestinationRow {
  code:       string;
  name:       string;
  is_active:  boolean;
  sort_order: number;
}

export const DestinationsAPI = {
  async list(includeInactive = false): Promise<DestinationRow[]> {
    let q = supabase.from("destinations").select("*").order("sort_order", { ascending: true });
    if (!includeInactive) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as DestinationRow[]) ?? [];
  },

  async setActive(code: string, active: boolean): Promise<{ error?: string }> {
    const { error } = await supabase
      .from("destinations").update({ is_active: active }).eq("code", code);
    return { error: error?.message };
  },
};
