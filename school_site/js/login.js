import { supabase } from "./supabaseClient.js";

document.addEventListener("DOMContentLoaded", () => {
  const authForm = document.querySelector("#auth-form");
  const authError = document.querySelector("#auth-error");
  const modeTabs = Array.from(document.querySelectorAll(".tab"));
  const signupFields = Array.from(document.querySelectorAll(".signup-only"));

  const emailInput = document.querySelector("#auth-email");
  const passwordInput = document.querySelector("#auth-password");
  const nameInput = document.querySelector("#auth-name");
  const roleInput = document.querySelector("#auth-role");
  const sportInput = document.querySelector("#auth-sport");
  const affiliationInput = document.querySelector("#auth-affiliation");
  const locationInput = document.querySelector("#auth-location");
  const gradYearInput = document.querySelector("#auth-grad-year");
  const bioInput = document.querySelector("#auth-bio");
  const authSubmit = document.querySelector("#auth-submit");

  if (!authForm || !authSubmit) return;

  let currentMode = "login";

  function setStatus(message, type = "error") {
    authError.textContent = message || "";
    authError.classList.remove("error", "success");
    authError.classList.add(type);
  }

  function applyRoleSpecificFields() {
    const role = roleInput.value;
    if (gradYearInput) {
      gradYearInput.required = role === "athlete" && currentMode === "signup";
      gradYearInput.parentElement.hidden = currentMode !== "signup" || role !== "athlete";
    }

    if (sportInput) sportInput.required = currentMode === "signup" && role !== "general";
    if (affiliationInput) {
      affiliationInput.required = currentMode === "signup" && ["athlete", "coach", "school", "scout"].includes(role);
    }
  }

  function setMode(mode) {
    currentMode = mode;
    modeTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.mode === mode));

    signupFields.forEach((field) => {
      const input = field.querySelector("input, select, textarea");
      field.hidden = mode !== "signup";
      if (input) input.required = mode === "signup";
    });

    authSubmit.textContent = mode === "login" ? "Login" : "Create account";
    setStatus("");
    applyRoleSpecificFields();
  }

  async function createRoleRows(userId, role, name) {
    const { data: userRow, error: userInsertError } = await supabase
      .from("users")
      .insert({ firebase_uid: userId, role })
      .select("user_id")
      .single();

    if (userInsertError) {
      if (userInsertError.code !== "23505") throw userInsertError;
      const { data: existing, error: lookupError } = await supabase
        .from("users")
        .select("user_id")
        .eq("firebase_uid", userId)
        .single();
      if (lookupError) throw lookupError;
      return existing.user_id;
    }

    const appUserId = userRow?.user_id;
    if (!appUserId) return null;

    let roleInsertError = null;
    if (role === "school") {
      const { error } = await supabase.from("schools").insert({ user_id: appUserId, name: name || "School" });
      roleInsertError = error;
    } else if (role === "coach") {
      const { error } = await supabase.from("coaches").insert({ user_id: appUserId });
      roleInsertError = error;
    } else if (role === "athlete") {
      const { error } = await supabase.from("athletes").insert({ user_id: appUserId });
      roleInsertError = error;
    } else if (role === "scout") {
      const { error } = await supabase.from("scouts").insert({ user_id: appUserId });
      roleInsertError = error;
    }

    if (roleInsertError && roleInsertError.code !== "23505") {
      throw roleInsertError;
    }

    return appUserId;
  }

  async function syncUserDirectory(userId, displayName, email) {
    if (!userId) return;
    const { error } = await supabase.from("user_directory").upsert(
      {
        user_id: userId,
        display_name: displayName || null,
        email: email || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );
    if (error) {
      // Keep auth flow working even if user_directory is not deployed yet.
      console.warn("user_directory sync skipped", error.message);
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    setStatus("");

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    try {
      if (currentMode === "login") {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        if (!data.session) throw new Error("Login failed. Check your credentials.");
        const { data: appUser } = await supabase
          .from("users")
          .select("user_id")
          .eq("firebase_uid", data.session.user.id)
          .maybeSingle();
        await syncUserDirectory(appUser?.user_id, data.session.user.user_metadata?.name, data.session.user.email);
        window.location.href = "index.html";
        return;
      }

      const selectedRole = roleInput.value.toLowerCase();
      const role = selectedRole === "general" ? "viewer" : selectedRole;
      const metadata = {
        role: selectedRole,
        name: nameInput.value.trim(),
        sport: sportInput.value.trim(),
        affiliation: affiliationInput.value.trim(),
        location: locationInput.value.trim(),
        grad_year: gradYearInput.value ? Number(gradYearInput.value) : null,
        bio: bioInput.value.trim(),
        verification_status: ["athlete", "coach", "school"].includes(role) ? "pending" : "unverified",
        unread_notifications: 4,
      };

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: metadata },
      });

      if (signUpError) throw signUpError;
      if (!signUpData.user) throw new Error("Sign up failed. Try again.");

      const appUserId = await createRoleRows(signUpData.user.id, role, metadata.name);
      await syncUserDirectory(appUserId, metadata.name, email);

      const { data: loginData, error: loginError } = await supabase.auth.signInWithPassword({ email, password });
      if (loginError) throw loginError;
      if (!loginData.session) throw new Error("Sign in after signup failed. Please login manually.");

      setStatus("Account created successfully.", "success");
      window.location.href = "index.html";
    } catch (error) {
      console.error("Auth error", error);
      setStatus(error.message || "Authentication failed.", "error");
    }
  }

  modeTabs.forEach((tab) => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
  roleInput?.addEventListener("change", applyRoleSpecificFields);
  authForm.addEventListener("submit", handleAuthSubmit);

  setMode("login");
});
