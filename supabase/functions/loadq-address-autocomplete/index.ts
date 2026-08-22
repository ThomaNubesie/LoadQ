// loadq-address-autocomplete — server-side proxy for Google Places Autocomplete
// (New). Keeps GOOGLE_MAPS_KEY off the client. POST { input, session? } ->
// { predictions: [{ description, place_id }] }. Biased to Canada.
const GKEY = Deno.env.get("GOOGLE_MAPS_KEY")!;
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const b = await req.json().catch(() => ({} as any));

    // action=details: resolve a place_id to full address + postal code + lat/lng.
    if (b.action === "details" && b.place_id) {
      const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(String(b.place_id))}`, {
        headers: { "X-Goog-Api-Key": GKEY, "X-Goog-FieldMask": "formattedAddress,addressComponents,location" },
      });
      const j = await r.json();
      if (j.error) return json({ error: j.error?.message }, 200);
      const comps = j.addressComponents ?? [];
      const postal = comps.find((c: any) => (c.types ?? []).includes("postal_code"))?.longText ?? null;
      return json({
        formatted_address: j.formattedAddress ?? "",
        postal_code: postal,
        lat: j.location?.latitude ?? null,
        lng: j.location?.longitude ?? null,
      });
    }

    const input = String(b.input || "").trim();
    if (input.length < 3) return json({ predictions: [] });
    const body: Record<string, unknown> = { input, regionCode: "CA", languageCode: b.lang === "fr" ? "fr" : "en" };
    if (b.session) body.sessionToken = String(b.session);
    const r = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": GKEY,
        "X-Goog-FieldMask": "suggestions.placePrediction.placeId,suggestions.placePrediction.text.text" },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (j.error) return json({ predictions: [], error: j.error?.message }, 200);
    const predictions = (j.suggestions ?? [])
      .map((s: any) => s.placePrediction)
      .filter(Boolean)
      .map((p: any) => ({ description: p.text?.text ?? "", place_id: p.placeId ?? "" }))
      .filter((p: any) => p.description);
    return json({ predictions });
  } catch (e) {
    return json({ predictions: [], error: String(e) }, 200);
  }
});
