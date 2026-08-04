import { supabase } from "./supabase";

export interface ZoneRow {
  id:            string;
  name:          string;
  region:        string;
  address:       string | null;
  latitude:      number;
  longitude:     number;
  radius_meters: number;
  timezone:      string;
  is_active:     boolean;
}

export type NewZone = Omit<ZoneRow, "is_active"> & { is_active?: boolean };

export const ZonesAPI = {
  async list(includeInactive = false): Promise<ZoneRow[]> {
    let q = supabase.from("zones").select("*").order("region", { ascending: true }).order("name", { ascending: true });
    if (!includeInactive) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return (data as ZoneRow[]) ?? [];
  },

  async add(zone: NewZone): Promise<{ data?: ZoneRow; error?: string }> {
    const payload = { ...zone, is_active: zone.is_active ?? true };
    const { data, error } = await supabase.from("zones").insert(payload).select().single();
    return { data: data as ZoneRow | undefined, error: error?.message };
  },

  async update(id: string, patch: Partial<NewZone>): Promise<{ data?: ZoneRow; error?: string }> {
    // maybeSingle: an admin editing an *inactive* zone would otherwise get a
    // false "0 rows" error — the SELECT policy only returns is_active rows, so
    // the update succeeds but the returning representation comes back empty.
    const { data, error } = await supabase.from("zones").update(patch).eq("id", id).select().maybeSingle();
    return { data: data as ZoneRow | undefined, error: error?.message };
  },

  async setActive(id: string, active: boolean): Promise<{ error?: string }> {
    const { error } = await supabase.from("zones").update({ is_active: active }).eq("id", id);
    return { error: error?.message };
  },
};
