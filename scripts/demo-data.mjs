// Shared definitions for demo seed / simulate / cleanup scripts.
// All demo users have email matching DEMO_EMAIL_RE, which is how cleanup finds them.

export const DEMO_EMAIL_PREFIX = "demo-loadq+";
export const DEMO_EMAIL_DOMAIN = "example.test";
export const DEMO_EMAIL_RE     = /^demo-loadq\+/;

export const FIRST_NAMES = [
  "Amadou", "Ibrahim", "Mamadou", "Ousmane", "Cheikh", "Moussa", "Abdoulaye",
  "Sékou", "Boubacar", "Lamine", "Issa", "Souleymane", "Kofi", "Kwame", "Yaw",
  "Diallo", "Traoré", "Coulibaly", "Keita", "Sow",
];
export const LAST_NAMES = [
  "Diop", "Ndiaye", "Diallo", "Ba", "Faye", "Sarr", "Touré", "Cissé", "Konaté",
  "Camara", "Sylla", "Bah", "Barry", "Mbaye", "Sané",
];

// Zone allocation: heavy on ottawa-george, light on rest (per user choice)
export const ZONE_ALLOCATION = {
  "ottawa-george":       8,
  "gatineau-mcdo":       2,
  "montreal-jean-talon": 2,
  "montreal-berri":      1,
  "quebec-shell":        1,
  "quebec-mcdo":         1,
  "laval-desjardins":    1,
  "toronto-yorkdale":    1,
  "toronto-scarborough": 1,
  "toronto-union":       1,
};

// Vehicle mix — proportional to real-world distribution for a queue app
export const VEHICLE_POOL = [
  { type: "minibus", make: "Toyota",        model: "HiAce",       seats: 14 },
  { type: "minibus", make: "Nissan",        model: "Urvan",       seats: 14 },
  { type: "minibus", make: "Mercedes-Benz", model: "Sprinter",    seats: 14 },
  { type: "van",     make: "Toyota",        model: "Coaster",     seats: 10 },
  { type: "van",     make: "Toyota",        model: "HiAce Long",  seats: 10 },
  { type: "suv",     make: "Toyota",        model: "Highlander",  seats: 8  },
  { type: "suv",     make: "Honda",         model: "Pilot",       seats: 8  },
  { type: "suv",     make: "Audi",          model: "Q7",          seats: 7  },
  { type: "suv",     make: "Ford",          model: "Explorer",    seats: 7  },
  { type: "suv",     make: "Toyota",        model: "RAV4",        seats: 5  },
  { type: "suv",     make: "Honda",         model: "CR-V",        seats: 5  },
  { type: "bush_taxi", make: "Peugeot",     model: "504",         seats: 7  },
  { type: "sedan",   make: "Toyota",        model: "Corolla",     seats: 4  },
  { type: "sedan",   make: "Honda",         model: "Accord",      seats: 5  },
  { type: "sedan",   make: "Nissan",        model: "Altima",      seats: 5  },
];

export function randomFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function randomPlate() {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const L = () => letters[Math.floor(Math.random() * letters.length)];
  const D = () => Math.floor(Math.random() * 10);
  return `${L()}${L()}${L()} ${D()}${D()}${D()}`;
}

// Generates a deterministic-ish demo phone in E.164 (Canada). Not real.
export function randomPhone(i) {
  const tail = String(100_0000 + i).padStart(7, "0");
  return `+1613555${tail.slice(-4)}`;
}

export function getSupabaseAdmin() {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("EXPO_PUBLIC_SUPABASE_URL missing in .env");
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY missing in .env.local\n" +
      "Get it from: Supabase Dashboard → Project Settings → API Keys → secret key\n" +
      "Add to .env.local (gitignored):\n" +
      "  SUPABASE_SERVICE_ROLE_KEY=sb_secret_..."
    );
  }
  return { url, key };
}

// Node <22 lacks a global WebSocket — Supabase realtime crashes at init.
// We don't need realtime for these scripts, so plug in the `ws` package.
export async function buildAdminClient() {
  const { createClient } = await import("@supabase/supabase-js");
  const ws = (await import("ws")).default;
  const { url, key } = getSupabaseAdmin();
  return createClient(url, key, {
    auth:     { persistSession: false },
    realtime: { transport: ws },
  });
}
