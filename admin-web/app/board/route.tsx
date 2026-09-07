import { ImageResponse } from "next/og";

// GET /board?zone=<zone_id>  → a 1080×1350 PNG of that zone's live queue.
//
// This is the board itself, not a picture of it: it renders from loadq_board_public()
// at request time, so the tablet at the loading point, the website and Facebook all show
// the same thing without anything having to push updates around.
//
// Cache-Control is two hours by deliberate choice. Rendering per request would hammer the
// database from every tablet refresh; a 2-hour edge cache means the board is current
// within the window that was asked for, and costs one query per zone per two hours no
// matter how many screens are watching.
//
// Driver names come back as INITIALS from the RPC — this route is public and must not
// expose the roster. See loadq_board_public().
export const runtime = "edge";

const SB = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const C = {
  bg: "#15171C", surface: "#1B1E25", card: "#232733", cardAlt: "#2C313F",
  border: "#3E4453", t1: "#FFFFFF", t2: "#AEB6C4", t3: "#7C8697",
  azure: "#4C82F0", orange: "#FF8A1A", yellow: "#F5C842", green: "#3FD08A",
};

type Car = {
  position: number; status: string; driver: string | null;
  make: string | null; model: string | null; year: number | null; color: string | null;
  seats: number | null; seats_boarded: number; seats_taken: number; seats_left: number;
};
type Board = {
  zone_id: string; zone: string; address: string | null;
  from_city: string; to_city: string; cars: number; seats_free: number;
  loading: number; list: Car[];
};

// Mirrors utils/vehicleImage.ts in the mobile app so the board shows the same car the
// driver sees on their own screen.
const MODEL_FAMILY: Record<string, string> = {
  "hiace": "hiace", "urvan": "urvan", "sprinter": "sprinter", "coaster": "coaster",
  "land cruiser": "land-cruiser", "prado": "land-cruiser-prado", "fortuner": "fortuner",
  "corolla": "corolla", "accord": "accord", "logan": "logan",
};
function vehicleImage(make?: string | null, model?: string | null, year?: number | null, color?: string | null) {
  if (!make || !model) return null;
  const key = model.toLowerCase().trim();
  const family = MODEL_FAMILY[key] || key.split(" ")[0];
  const p = new URLSearchParams({
    customer: process.env.NEXT_PUBLIC_IMAGIN_KEY || "img",
    make: make.toLowerCase().trim(), modelFamily: family,
    zoomType: "fullscreen", angle: "01",
  });
  if (year) p.set("modelYear", String(year));
  if (color) p.set("paintId", color.toLowerCase().replace(/\s+/g, "-"));
  return `https://cdn.imagin.studio/getImage?${p}`;
}

// The seat glyph from components/SeatSvg.tsx, same five rectangles. Free seats use a
// lighter stroke than the app's — on a screen read from across a room the app's #3E4453
// at 35% opacity disappears entirely.
function Seat({ state }: { state: "boarded" | "held" | "free" }) {
  const c = state === "boarded" ? C.azure : state === "held" ? C.yellow : "#7E8798";
  const fill = state === "free" ? "transparent" : c;
  const bg = state === "free" ? "transparent" : c + "38";
  return (
    <svg width="19" height="24" viewBox="0 0 36 44">
      <rect x="7" y="0" width="22" height="7" rx="3.5" fill={fill} stroke={c} strokeWidth="2" />
      <rect x="0" y="9" width="5" height="14" rx="2.5" fill={fill} stroke={c} strokeWidth="2" />
      <rect x="7" y="8" width="22" height="18" rx="3" fill={bg} stroke={c} strokeWidth="2" />
      <rect x="31" y="9" width="5" height="14" rx="2.5" fill={fill} stroke={c} strokeWidth="2" />
      <rect x="3" y="28" width="30" height="7" rx="3" fill={fill} stroke={c} strokeWidth="2" />
    </svg>
  );
}

export async function GET(req: Request) {
  const zoneId = new URL(req.url).searchParams.get("zone") || "";

  const res = await fetch(`${SB}/rest/v1/rpc/loadq_board_public`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${ANON}`, "Content-Type": "application/json" },
    body: "{}",
    cache: "no-store",
  });
  const boards: Board[] = res.ok ? await res.json() : [];
  const b = boards.find((x) => x.zone_id === zoneId) ?? boards[0];

  const stamp = new Intl.DateTimeFormat("fr-CA", {
    hour: "2-digit", minute: "2-digit", timeZone: "America/Toronto",
  }).format(new Date());

  // No board for this zone: say so plainly rather than rendering an empty frame that
  // looks like a loading failure.
  if (!b) {
    return new ImageResponse(
      (
        <div style={{ width: "100%", height: "100%", background: C.bg, color: C.t2,
                      display: "flex", flexDirection: "column", alignItems: "center",
                      justifyContent: "center", fontSize: 40, fontFamily: "sans-serif" }}>
          <div style={{ color: C.t1, fontSize: 56, fontWeight: 800 }}>Aucune voiture en file</div>
          <div style={{ marginTop: 14 }}>No cars in line right now · loadq.ca</div>
        </div>
      ),
      { width: 1080, height: 1350 },
    );
  }

  const img = new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", background: C.bg, color: C.t1,
                    display: "flex", flexDirection: "column", fontFamily: "sans-serif" }}>
        {/* header */}
        <div style={{ display: "flex", flexDirection: "column", background: C.surface,
                      borderBottom: `3px solid ${C.azure}`, padding: "22px 30px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", fontSize: 30, fontWeight: 800 }}>
              Load<span style={{ color: C.orange }}>Q</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", background: "rgba(63,208,138,.12)",
                          border: `1px solid #2F8F6B`, borderRadius: 20, padding: "5px 13px",
                          fontSize: 20, fontWeight: 700, color: C.green }}>
              ● à jour à {stamp}
            </div>
          </div>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 800, marginTop: 11 }}>
            {b.from_city.toUpperCase()}
            <span style={{ color: C.orange, margin: "0 12px" }}>→</span>
            {b.to_city.toUpperCase()}
          </div>
          <div style={{ display: "flex", fontSize: 20, color: C.t2, marginTop: 4 }}>
            {b.zone}{b.address ? ` · ${b.address}` : ""}
          </div>
        </div>

        {/* cars */}
        <div style={{ display: "flex", flexDirection: "column", padding: "14px 30px", gap: 11 }}>
          {b.list.slice(0, 6).map((c, i) => {
            const loading = c.status === "loading";
            const seats = c.seats ?? 0;
            const src = vehicleImage(c.make, c.model, c.year, c.color);
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 13,
                    background: loading ? "rgba(76,130,240,.09)" : C.card,
                    border: `1px solid ${loading ? C.azure : C.border}`,
                    borderRadius: 14, padding: "12px 16px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center",
                      width: 48, height: 48, borderRadius: 24, background: C.cardAlt,
                      fontSize: 17, fontWeight: 700 }}>
                  {(c.driver || "?").replace(". ", "").slice(0, 2).toUpperCase()}
                </div>
                <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
                  <div style={{ display: "flex", fontSize: 22, fontWeight: 700 }}>{c.driver || "—"}</div>
                  <div style={{ display: "flex", fontSize: 16, color: C.t3, marginTop: 2 }}>
                    {[c.make ? c.make[0] + c.make.slice(1).toLowerCase() : "", c.model, c.year, c.color]
                      .filter(Boolean).join(" · ")}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", marginTop: 8, gap: 5 }}>
                    {Array.from({ length: Math.min(seats, 8) }).map((_, s) => (
                      <Seat key={s} state={s < c.seats_boarded ? "boarded" : s < c.seats_taken ? "held" : "free"} />
                    ))}
                    <span style={{ fontSize: 15, color: C.t2, marginLeft: 8 }}>
                      {c.seats_left} places libres
                    </span>
                  </div>
                </div>
                {src ? <img src={src} width={190} height={119} style={{ borderRadius: 8, background: "#fff" }} /> : null}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end" }}>
                  <div style={{ display: "flex", fontSize: 25, fontWeight: 800 }}>30 $</div>
                  <div style={{ display: "flex", marginTop: 6, fontSize: 14, fontWeight: 700,
                        padding: "5px 11px", borderRadius: 20,
                        background: loading ? "rgba(76,130,240,.2)" : C.cardAlt,
                        color: loading ? C.azure : C.t2 }}>
                    {loading ? "● EN CHARGEMENT" : `N° ${c.position}`}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* footer */}
        <div style={{ display: "flex", alignItems: "center", marginTop: "auto",
                      background: C.surface, borderTop: `3px solid ${C.orange}`, padding: "16px 30px" }}>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: 25, fontWeight: 800 }}>
              {b.cars} voitures · {b.seats_free} places libres
            </div>
            <div style={{ display: "flex", fontSize: 15, color: C.t2, marginTop: 2 }}>
              Premier arrivé, premier servi · First come, first served
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", marginLeft: "auto" }}>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 800, color: C.azure }}>loadq.ca</div>
            <div style={{ display: "flex", fontSize: 19, fontWeight: 800, marginTop: 2 }}>613-862-2639</div>
          </div>
        </div>
      </div>
    ),
    { width: 1080, height: 1350 },
  );

  const out = new Response(img.body, img);
  out.headers.set("Cache-Control", "public, max-age=7200, s-maxage=7200");
  return out;
}
