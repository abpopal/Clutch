import { supabase } from "./supabaseClient.js";

// ── Watchlists CRUD ────────────────────────────────────────────

export async function loadWatchlists(scoutId) {
  const { data, error } = await supabase
    .from("watchlists")
    .select("*, watchlist_athletes(id, athlete_id, notes, priority, added_at)")
    .eq("scout_id", scoutId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createWatchlist(scoutId, { name, description, color }) {
  const { data, error } = await supabase
    .from("watchlists")
    .insert({ scout_id: scoutId, name, description: description || null, color: color || "#2d9bb2" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateWatchlist(watchlistId, updates) {
  const { error } = await supabase
    .from("watchlists")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("watchlist_id", watchlistId);
  if (error) throw error;
}

export async function deleteWatchlist(watchlistId) {
  const { error } = await supabase
    .from("watchlists")
    .delete()
    .eq("watchlist_id", watchlistId);
  if (error) throw error;
}

// ── Watchlist Athletes ─────────────────────────────────────────

export async function addAthleteToWatchlist(watchlistId, athleteId, { notes, priority } = {}) {
  const { data, error } = await supabase
    .from("watchlist_athletes")
    .upsert(
      { watchlist_id: watchlistId, athlete_id: athleteId, notes: notes || null, priority: priority || "normal" },
      { onConflict: "watchlist_id,athlete_id" }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function removeAthleteFromWatchlist(watchlistId, athleteId) {
  const { error } = await supabase
    .from("watchlist_athletes")
    .delete()
    .eq("watchlist_id", watchlistId)
    .eq("athlete_id", athleteId);
  if (error) throw error;
}

export async function updateWatchlistAthlete(watchlistId, athleteId, updates) {
  const { error } = await supabase
    .from("watchlist_athletes")
    .update(updates)
    .eq("watchlist_id", watchlistId)
    .eq("athlete_id", athleteId);
  if (error) throw error;
}
