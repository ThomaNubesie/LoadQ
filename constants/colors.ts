// LoadQ theme — LIGHT / CREAM.
// Azure is the primary action color; a warm cream background with white cards and
// soft borders; bright-orange used as an accent (chips, pins, highlights). The
// intense LoadQ orange lives only on the app-store icon asset.
//
// FALLBACK — previous dark-charcoal + orange palette (kept so we can revert fast):
//   bg:#15171C surface:#1B1E25 card:#232733 cardAlt:#2C313F border:#3E4453
//   accent:#FF6B00 accentText:#20140A accentP:#EA6A1E accentPText:#20140A
//   blue:#3B82F6 yellow:#F5C842 red:#EF4444 purple:#8B5CF6 green:#22C083
//   t1:#FFFFFF t2:#AEB6C4 t3:#7C8697
// (Azure-on-dark interim: accent/accentP:#4C82F0 accentText/PText:#FFFFFF.)
export const Colors = {
  bg:          "#FAF6EF",  // warm cream
  surface:     "#F3EEE4",  // deeper cream — sheets / insets
  card:        "#FFFFFF",
  cardAlt:     "#F0EADF",
  border:      "#E7E0D3",
  // Azure — primary actions; white text sits on it.
  accent:      "#2F6FE0",
  accentText:  "#FFFFFF",
  accentP:     "#2F6FE0",
  accentPText: "#FFFFFF",
  // Bright-orange accent (chips, pins, highlights) + a readable orange for text on cream.
  accentWarm:     "#FF8A1A",
  accentWarmText: "#C56A08",
  blue:       "#2F6FE0",
  yellow:     "#C98A00",
  red:        "#E24C4C",
  purple:     "#7C5CEF",
  green:      "#12A150",
  t1:         "#1B2130",  // near-black primary text
  t2:         "#5A6273",
  t3:         "#98A0AE",
};
