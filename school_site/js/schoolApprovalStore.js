import { supabase } from "./supabaseClient.js";

const REQUEST_TABLE = "school_join_requests";
const LOCAL_REQUESTS_KEY = "ua-school-join-requests";

function isSchemaMissing(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return ["PGRST204", "PGRST205", "42P01", "42703"].includes(code)
    || message.includes("could not find the table")
    || message.includes("relation")
    || message.includes("does not exist")
    || message.includes("column");
}

function readLocalRequests() {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(window.localStorage.getItem(LOCAL_REQUESTS_KEY) || "[]");
  } catch {
    return [];
  }
}

function writeLocalRequests(rows) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LOCAL_REQUESTS_KEY, JSON.stringify(rows));
}

function sortNewest(rows) {
  return [...rows].sort((left, right) => new Date(right.requested_at || 0).getTime() - new Date(left.requested_at || 0).getTime());
}

function localRequestId() {
  return `school-req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function tryTableQuery(run, fallback) {
  try {
    return await run();
  } catch (error) {
    if (isSchemaMissing(error)) {
      return fallback();
    }
    throw error;
  }
}

export async function loadSchoolOptions() {
  const { data, error } = await supabase
    .from("schools")
    .select("school_id,name,location")
    .order("name", { ascending: true })
    .limit(1000);
  if (error) throw error;
  return data || [];
}

export async function createSchoolJoinRequest({
  userId,
  requesterRole,
  schoolId,
  schoolName = "",
  displayName = "",
  email = "",
}) {
  const payload = {
    user_id: userId,
    requester_role: requesterRole,
    school_id: schoolId,
    school_name: schoolName,
    display_name: displayName,
    email,
    status: "pending",
    requested_at: new Date().toISOString(),
    reviewed_at: null,
    reviewed_by_user_id: null,
  };

  return tryTableQuery(async () => {
    const { data, error } = await supabase
      .from(REQUEST_TABLE)
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  }, () => {
    const requests = readLocalRequests();
    const existing = requests.find((item) => item.user_id === userId && item.school_id === schoolId && item.requester_role === requesterRole && item.status === "pending");
    if (existing) return existing;
    const record = { request_id: localRequestId(), ...payload };
    requests.push(record);
    writeLocalRequests(requests);
    return record;
  });
}

export async function loadPendingSchoolRequests({ schoolId, requesterRole = "" }) {
  return tryTableQuery(async () => {
    let query = supabase
      .from(REQUEST_TABLE)
      .select("*")
      .eq("school_id", schoolId)
      .eq("status", "pending")
      .order("requested_at", { ascending: false });
    if (requesterRole) query = query.eq("requester_role", requesterRole);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }, () => {
    const normalizedRole = String(requesterRole || "").trim().toLowerCase();
    return sortNewest(readLocalRequests().filter((item) => (
      item.school_id === schoolId
      && item.status === "pending"
      && (!normalizedRole || item.requester_role === normalizedRole)
    )));
  });
}

async function applyApprovalSideEffects(request) {
  if (request?.requester_role !== "athlete" || !request?.user_id || !request?.school_id) return;
  const { error } = await supabase
    .from("athletes")
    .update({ school_id: request.school_id })
    .eq("user_id", request.user_id);
  if (error && !isSchemaMissing(error)) throw error;
}

export async function reviewSchoolJoinRequest({
  requestId,
  decision,
  reviewedByUserId,
}) {
  const status = decision === "approve" ? "approved" : "rejected";
  return tryTableQuery(async () => {
    const { data: existing, error: fetchError } = await supabase
      .from(REQUEST_TABLE)
      .select("*")
      .eq("request_id", requestId)
      .limit(1);
    if (fetchError) throw fetchError;
    const request = Array.isArray(existing) ? (existing[0] || null) : existing;
    const { data, error } = await supabase
      .from(REQUEST_TABLE)
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by_user_id: reviewedByUserId || null,
      })
      .eq("request_id", requestId)
      .select("*")
      .single();
    if (error) throw error;
    if (status === "approved") {
      await applyApprovalSideEffects(data || request);
    }
    return data || request;
  }, async () => {
    const requests = readLocalRequests();
    const index = requests.findIndex((item) => item.request_id === requestId);
    if (index < 0) return null;
    const updated = {
      ...requests[index],
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by_user_id: reviewedByUserId || null,
    };
    requests[index] = updated;
    writeLocalRequests(requests);
    if (status === "approved") {
      await applyApprovalSideEffects(updated);
    }
    return updated;
  });
}
