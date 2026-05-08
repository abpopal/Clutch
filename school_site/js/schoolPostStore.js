import { supabase } from "./supabaseClient.js";

async function fetchFirst(query) {
  const { data, error } = await query.limit(1);
  if (error) throw error;
  return Array.isArray(data) ? (data[0] || null) : (data || null);
}

export async function loadSchoolPosts({ authorUserId }) {
  if (!authorUserId) return [];
  const { data, error } = await supabase
    .from("post")
    .select("post_id,author_user_id,author_role,caption,post_type,created_at,visibility,post_media(media_url,media_type,duration_seconds)")
    .eq("author_user_id", authorUserId)
    .eq("author_role", "school_admin")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return data || [];
}

export async function createSchoolPost({
  authorUserId,
  caption,
  mediaType,
  mediaUrl,
  visibility = "public",
}) {
  const postPayload = {
    author_user_id: authorUserId,
    author_role: "school_admin",
    caption: String(caption || "").trim(),
    post_type: mediaType,
    visibility,
  };

  const { data: post, error: postError } = await supabase
    .from("post")
    .insert(postPayload)
    .select("post_id,author_user_id,author_role,caption,post_type,created_at,visibility")
    .single();

  if (postError) throw postError;

  try {
    const { error: mediaError } = await supabase
      .from("post_media")
      .insert({
        post_id: post.post_id,
        media_url: String(mediaUrl || "").trim(),
        media_type: mediaType,
      });
    if (mediaError) throw mediaError;
  } catch (error) {
    await supabase.from("post").delete().eq("post_id", post.post_id);
    throw error;
  }

  return fetchFirst(
    supabase
      .from("post")
      .select("post_id,author_user_id,author_role,caption,post_type,created_at,visibility,post_media(media_url,media_type,duration_seconds)")
      .eq("post_id", post.post_id)
  );
}
