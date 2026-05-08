// Try primary CDN, fall back to alternative if it fails
let createClient;

try {
  const mod = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  createClient = mod.createClient;
} catch (err1) {
  console.warn("[supabase] jsdelivr failed, trying esm.sh fallback…", err1.message);
  try {
    const mod = await import("https://esm.sh/@supabase/supabase-js@2");
    createClient = mod.createClient;
  } catch (err2) {
    console.error("[supabase] All CDN imports failed:", err2.message);
    throw new Error("Could not load Supabase library from any CDN.");
  }
}

// Keep these in sync with clutch_app/lib/app/supabase_config.dart
const SUPABASE_URL = "https://utcnzjozildxdeooiboq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_aIVvSqraczLHzkznP926fA_G2DQfAdM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
