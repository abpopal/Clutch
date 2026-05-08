import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

// Keep these in sync with clutch_app/lib/app/supabase_config.dart
const SUPABASE_URL = "https://utcnzjozildxdeooiboq.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_aIVvSqraczLHzkznP926fA_G2DQfAdM";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
