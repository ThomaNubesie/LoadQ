import { supabase } from "./supabase";

// B5 · Courier payment history / T4 summary. A courier (LoadQ driver) reads their
// own Kolis delivery payout receipts — RLS (cpr_read_own) scopes to their rows.
export interface PayoutReceipt {
  id: string;
  parcel_code: string | null;
  amount_cents: number;
  currency: string | null;
  method: string | null;
  trip_from: string | null;
  trip_to: string | null;
  paid_at: string | null;
  t4_year: number | null;
}

export interface T4Year {
  year: number;
  total_cents: number;
  count: number;
}

export const CourierPayAPI = {
  async receipts(): Promise<PayoutReceipt[]> {
    const { data, error } = await supabase
      .from("courier_payout_receipts")
      .select("id, parcel_code, amount_cents, currency, method, trip_from, trip_to, paid_at, t4_year")
      .order("paid_at", { ascending: false, nullsFirst: false });
    if (error) return [];
    return (data as PayoutReceipt[]) ?? [];
  },

  // Per-year totals (T4), most recent year first.
  summarize(rows: PayoutReceipt[]): T4Year[] {
    const by = new Map<number, T4Year>();
    for (const r of rows) {
      const y = r.t4_year ?? (r.paid_at ? new Date(r.paid_at).getUTCFullYear() : 0);
      if (!y) continue;
      const cur = by.get(y) ?? { year: y, total_cents: 0, count: 0 };
      cur.total_cents += r.amount_cents ?? 0;
      cur.count += 1;
      by.set(y, cur);
    }
    return [...by.values()].sort((a, b) => b.year - a.year);
  },
};
