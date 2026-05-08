import { supabase } from "./supabaseClient.js";
import { normalizeRole } from "./roleUtils.js";
import { createSchoolJoinRequest, loadSchoolOptions } from "./schoolApprovalStore.js";

document.addEventListener("DOMContentLoaded", () => {
  const authForm = document.querySelector("#auth-form");
  const authError = document.querySelector("#auth-error");
  const modeTabs = Array.from(document.querySelectorAll(".tab"));
  const signupFields = Array.from(document.querySelectorAll(".signup-only"));

  const emailInput = document.querySelector("#auth-email");
  const passwordInput = document.querySelector("#auth-password");
  const nameInput = document.querySelector("#auth-name");
  const roleInput = document.querySelector("#auth-role");
  const schoolInput = document.querySelector("#auth-school");
  const schoolField = document.querySelector(".signup-school-only");
  const authSubmit = document.querySelector("#auth-submit");

  if (!authForm || !authSubmit) return;

  let currentMode = "login";

  // ── Password Reset ────────────────────────────────────────────
  const forgotLink = document.querySelector("#forgot-password-link");
  const resetSection = document.querySelector("#reset-section");
  const resetEmailInput = document.querySelector("#reset-email");
  const resetSubmitBtn = document.querySelector("#reset-submit-btn");
  const resetStatus = document.querySelector("#reset-status");
  const backToLoginLink = document.querySelector("#back-to-login-link");

  forgotLink?.addEventListener("click", (e) => {
    e.preventDefault();
    authForm.hidden = true;
    if (resetSection) resetSection.hidden = false;
    if (resetEmailInput && emailInput?.value) resetEmailInput.value = emailInput.value;
  });

  backToLoginLink?.addEventListener("click", (e) => {
    e.preventDefault();
    if (resetSection) resetSection.hidden = true;
    authForm.hidden = false;
  });

  resetSubmitBtn?.addEventListener("click", async () => {
    const email = resetEmailInput?.value?.trim();
    if (!email) {
      if (resetStatus) { resetStatus.textContent = "Enter your email address."; resetStatus.className = "auth-error-msg"; }
      return;
    }
    resetSubmitBtn.disabled = true;
    resetSubmitBtn.textContent = "Sending…";
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login.html`,
      });
      if (error) throw error;
      if (resetStatus) {
        resetStatus.textContent = "Reset link sent — check your email.";
        resetStatus.className = "auth-error-msg success";
      }
    } catch (err) {
      if (resetStatus) {
        resetStatus.textContent = err.message || "Failed to send reset link.";
        resetStatus.className = "auth-error-msg";
      }
    } finally {
      resetSubmitBtn.disabled = false;
      resetSubmitBtn.textContent = "Send reset link";
    }
  });

  function roleNeedsSchool(role) {
    return ["athlete", "coach"].includes(normalizeRole(role));
  }

  async function fetchFirst(query) {
    const { data, error } = await query.limit(1);
    if (error) throw error;
    return Array.isArray(data) ? (data[0] || null) : (data || null);
  }

  function setStatus(message, type = "error") {
    authError.textContent = message || "";
    authError.classList.remove("error", "success");
    authError.classList.add(type);
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
    syncRoleFields();
    setStatus("");
  }

  function syncRoleFields() {
    const role = normalizeRole(roleInput?.value || "");
    const needsSchool = currentMode === "signup" && roleNeedsSchool(role);
    if (schoolField) schoolField.hidden = !needsSchool;
    if (schoolInput) schoolInput.required = needsSchool;
  }

  async function createRoleRows(userId, role, name) {
    const existingUser = await fetchFirst(
      supabase
        .from("users")
        .select("user_id")
        .eq("auth_uid", userId)
    );

    let appUserId = existingUser?.user_id || null;

    if (!appUserId) {
      const { data: userRow, error: userInsertError } = await supabase
        .from("users")
        .insert({ auth_uid: userId, role })
        .select("user_id")
        .single();

      if (userInsertError && userInsertError.code !== "23505") throw userInsertError;
      if (!userRow?.user_id) {
        const retryUser = await fetchFirst(
          supabase
            .from("users")
            .select("user_id")
            .eq("auth_uid", userId)
        );
        appUserId = retryUser?.user_id || null;
      } else {
        appUserId = userRow.user_id;
      }
    }

    if (!appUserId) return null;

    async function ensureRoleRecord(table, payload) {
      const existing = await fetchFirst(
        supabase
          .from(table)
          .select("user_id")
          .eq("user_id", appUserId)
      );
      if (existing) return;
      const { error } = await supabase.from(table).insert(payload);
      if (error && error.code !== "23505") throw error;
    }

    if (role === "school_admin" || role === "school") {
      await ensureRoleRecord("schools", { user_id: appUserId, name: name || "School" });
    } else if (role === "coach") {
      await ensureRoleRecord("coaches", { user_id: appUserId });
    } else if (role === "athlete") {
      await ensureRoleRecord("athletes", { user_id: appUserId });
    } else if (role === "scout") {
      await ensureRoleRecord("scouts", { user_id: appUserId });
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
          .eq("auth_uid", data.session.user.id)
          .maybeSingle();
        await syncUserDirectory(appUser?.user_id, data.session.user.user_metadata?.name, data.session.user.email);
        window.location.href = "index.html";
        return;
      }

      const selectedRole = roleInput.value.trim().toLowerCase();
      if (!selectedRole) {
        setStatus("Choose your role to create an account.", "error");
        roleInput.focus();
        return;
      }
      const rawRole = selectedRole.trim().toLowerCase();
      const role = normalizeRole(rawRole);
      const selectedSchoolId = schoolInput?.value?.trim() || "";
      const selectedSchoolName = schoolInput?.selectedOptions?.[0]?.textContent?.trim() || "";
      if (roleNeedsSchool(role) && !selectedSchoolId) {
        setStatus("Choose a school before creating this account.", "error");
        schoolInput?.focus();
        return;
      }
      const metadata = {
        role: rawRole,
        name: nameInput.value.trim(),
        selected_school_id: selectedSchoolId || null,
        selected_school_name: selectedSchoolName || null,
        verification_status: ["athlete", "coach", "school_admin", "school"].includes(role) ? "pending" : "unverified",
        unread_notifications: 4,
      };

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: { data: metadata },
      });

      if (signUpError) throw signUpError;
      if (!signUpData.user) throw new Error("Sign up failed. Try again.");

      const appUserId = await createRoleRows(signUpData.user.id, rawRole, metadata.name);
      if (appUserId && roleNeedsSchool(role) && selectedSchoolId) {
        await createSchoolJoinRequest({
          userId: appUserId,
          requesterRole: role,
          schoolId: selectedSchoolId,
          schoolName: selectedSchoolName,
          displayName: metadata.name,
          email,
        });
      }
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
  roleInput?.addEventListener("change", syncRoleFields);
  authForm.addEventListener("submit", handleAuthSubmit);

  void loadSchoolOptions()
    .then((schools) => {
      if (!schoolInput) return;
      schoolInput.innerHTML = [
        `<option value="" selected disabled>Select your school</option>`,
        ...schools.map((school) => `<option value="${school.school_id}">${school.name}${school.location ? ` • ${school.location}` : ""}</option>`),
      ].join("");
    })
    .catch((error) => {
      console.warn("School options load failed", error);
    });

  setMode("login");
});
