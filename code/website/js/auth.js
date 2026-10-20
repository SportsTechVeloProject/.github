/* auth.js — Supabase accounts, teams and invites.
   Part of V-Lo. Loaded as a plain script; see vlo.html for the order. */
"use strict";

/* ---------------- accounts: login / signup / team invites ---------------- */
// Same project as the raw-session fetch above. The anon key is meant to be
// public (see the chat where this was explained) — paste your project's
// "anon public" key from Settings -> API. Access is enforced by the Row
// Level Security policies set up in Supabase, not by keeping this secret.
var SUPABASE_URL = "https://amxrrodzdvizndchfeqy.supabase.co";
var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFteHJyb2R6ZHZpem5kY2hmZXF5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk1MzY2MjgsImV4cCI6MjEwNTExMjYyOH0.DK_3jMp83K1DQKW6NVaSK77UNYBtXwfamjkZ3svewO4";

// Read before createClient: Supabase strips the #...type=recovery hash once
// it has turned the password-reset link into a session.
var isRecoveryLink = /type=recovery/.test(window.location.hash);

var sb = (window.supabase && SUPABASE_ANON_KEY.indexOf("PASTE_") !== 0)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

var authMode = "login"; // "login" | "signup"
var pendingInviteId = null;
var currentTeam = null; // { team_id, role, teamName, public_description, private_description }
var currentUser = null;  // Supabase user (id, email) while logged in
var currentProfile = null; // { full_name }
var authNotice = "";     // one-off message for the team page, e.g. after using an invite link

(function readInviteFromUrl() {
  var params = new URLSearchParams(window.location.search);
  var inv = params.get("invite");
  if (!inv) return;
  pendingInviteId = inv;
})();

function authEl(id) { return document.getElementById(id); }

function setAuthStatus(msg) {
  var s = authEl("authStatus");
  if (s) s.textContent = msg || "";
  var resend = authEl("authResendRow");
  if (resend) resend.hidden = true;
}

function openAuthModal() {
  var overlay = authEl("authModalOverlay");
  if (!overlay) return;
  overlay.hidden = false;
  if (!sb) {
    setAuthStatus("Not connected to Supabase yet — the anon key still needs to be filled in (see the code comment near SUPABASE_ANON_KEY).");
  } else if (pendingInviteId) {
    showInvitePreview();
  }
}
function closeAuthModal() { var overlay = authEl("authModalOverlay"); if (overlay) overlay.hidden = true; hidePasswords(); }

function showInvitePreview() {
  if (!sb || !pendingInviteId) return;
  // get_invite works before logging in, so the invite shows on the sign-up screen.
  sb.rpc("get_invite", { invite_id: pendingInviteId })
    .then(function (res) {
      var note = authEl("authInviteNote");
      if (!note) return;
      var invite = res.data && res.data[0];
      if (res.error || !invite) {
        note.hidden = true;
        return;
      }
      note.hidden = false;
      note.textContent = invite.needs_approval
        ? "A member of " + invite.team_name + " suggested you join. Sign up or log in to send a join request."
        : "You've been invited to join " + invite.team_name + " as a " + (invite.role === "member" ? "athlete" : invite.role) + ". Sign up or log in to accept.";
    })
    .catch(function () { /* ignore preview errors, invite is still redeemed on login/signup */ });
}

function setAuthMode(mode) {
  authMode = mode;
  authEl("authModalTitle").textContent = mode === "login" ? "Log in" : "Sign up";
  authEl("authSubmitBtn").textContent = mode === "login" ? "Log in" : "Sign up";
  authEl("authToggleText").textContent = mode === "login" ? "Don't have an account?" : "Already have an account?";
  authEl("authToggleMode").textContent = mode === "login" ? "Sign up" : "Log in";
  authEl("authForgotRow").hidden = mode !== "login";
  authEl("authNameRow").hidden = mode !== "signup";
  authEl("authName").required = mode === "signup";
  setAuthStatus("");
}

// Put every password field back to hidden (and its eye back to closed).
function hidePasswords() {
  document.querySelectorAll(".pw-toggle").forEach(function (btn) { setPasswordVisible(btn, false); });
}
function setPasswordVisible(btn, visible) {
  btn.parentElement.querySelector("input").type = visible ? "text" : "password";
  // SVG elements have no .hidden property, so set the attribute directly.
  btn.querySelector(".eye-open").toggleAttribute("hidden", !visible);
  btn.querySelector(".eye-closed").toggleAttribute("hidden", visible);
  btn.setAttribute("aria-pressed", visible ? "true" : "false");
  btn.setAttribute("aria-label", visible ? "Hide password" : "Show password");
}

// Shown when the visitor arrives from a "reset your password" email.
function showResetForm() {
  openAuthModal();
  setAuthStatus("");
  authEl("authModalTitle").textContent = "Set a new password";
  authEl("authForm").hidden = true;
  authEl("loggedInPanel").hidden = true;
  authEl("authResetForm").hidden = false;
  authEl("authNewPassword").focus();
}

function showLoggedIn(user) {
  authEl("authForm").hidden = true;
  var panel = authEl("loggedInPanel");
  panel.hidden = false;
  var who = currentProfile ? currentProfile.full_name + " (" + user.email + ")" : user.email;
  authEl("loggedInStatus").textContent = "Logged in as " + who + (currentTeam ? " · " + currentTeam.teamName + " · " + currentTeam.role : " · no team yet");
  updateTeamBadge();
  if (typeof onAccountChanged === "function") onAccountChanged();
}

// Pending join requests, for coaches/admins; shown as a count on the team badge.
var pendingJoinCount = 0;

function updateTeamBadge() {
  var badge = authEl("teamBadge");
  if (!badge) return;
  badge.textContent = currentTeam ? currentTeam.teamName : "No team assigned";
  // Team colour and picture (team.js) on the badge.
  badge.style.color = currentTeam && currentTeam.color ? currentTeam.color : "";
  badge.style.borderColor = currentTeam && currentTeam.color ? currentTeam.color : "";
  if (currentTeam && currentTeam.logo_path && typeof teamPictureUrl === "function") {
    var forPath = currentTeam.logo_path;
    teamPictureUrl(forPath).then(function (url) {
      if (!url || !currentTeam || currentTeam.logo_path !== forPath || badge.querySelector(".badge-logo")) return;
      var img = document.createElement("img");
      img.className = "badge-logo";
      img.alt = "";
      img.src = url;
      badge.insertBefore(img, badge.firstChild);
    });
  }
  if (currentTeam && pendingJoinCount) {
    var count = document.createElement("span");
    count.className = "count-badge";
    count.textContent = pendingJoinCount;
    badge.appendChild(count);
    badge.setAttribute("aria-label", currentTeam.teamName + " (" + pendingJoinCount + " join request" + (pendingJoinCount === 1 ? "" : "s") + ")");
  } else {
    badge.removeAttribute("aria-label");
  }
}

// Right after logging in, the database can briefly reject the brand-new login
// token ("JWT issued at future") because Supabase's servers' clocks differ by a
// second or two. Retry a few times instead of wrongly showing "No team assigned".
function fetchMembership(user, attempt) {
  return sb.from("team_members").select("team_id, role, teams(name, public_description, private_description, logo_path, color)")
    .eq("user_id", user.id).limit(1).maybeSingle()
    .then(function (res) {
      if (res.error && attempt < 4) {
        return new Promise(function (resolve) { setTimeout(resolve, 1000 * attempt); })
          .then(function () { return fetchMembership(user, attempt + 1); });
      }
      return res;
    });
}

function loadMembership(user) {
  currentUser = user;
  // Profile second: by then the login token is accepted (see fetchMembership).
  return fetchMembership(user, 1)
    .then(function (teamRes) {
      return sb.from("profiles").select("full_name, avatar_path").eq("id", user.id).maybeSingle().then(function (res) {
        currentProfile = res.data || null;
        return teamRes;
      });
    })
    .then(function (res) {
      if (res.error) {
        // Surfaced so a "no team yet" caused by a query/permissions problem
        // is visible instead of silently looking like "just no membership".
        console.error("loadMembership error:", res.error);
      }
      if (res.data) {
        currentTeam = {
          team_id: res.data.team_id,
          role: res.data.role,
          teamName: res.data.teams.name,
          public_description: res.data.teams.public_description || "",
          private_description: res.data.teams.private_description || "",
          logo_path: res.data.teams.logo_path || null,
          color: res.data.teams.color || null
        };
      } else {
        currentTeam = null;
      }
      showLoggedIn(user);
    });
}

function onAuthed(user) {
  var goToDemo = function () {
    closeAuthModal();
    openDemo();
  };
  var afterMembership = function () {
    if (pendingInviteId) {
      sb.rpc("redeem_invite", { invite_id: pendingInviteId }).then(function (res) {
        pendingInviteId = null;
        // Links made by an athlete don't add you straight away: they send a join request.
        if (res.data === "requested") authNotice = "Join request sent. A coach or admin of the team will accept or reject it.";
        else if (res.data === "joined") authNotice = "You've joined the team.";
        else if (res.error) authNotice = "That invite link didn't work: " + res.error.message;
        if (!res.error) {
          // clean the ?invite= param out of the address bar
          var url = new URL(window.location.href);
          url.searchParams.delete("invite");
          window.history.replaceState({}, "", url);
        }
        loadMembership(user).then(goToDemo);
      });
    } else {
      loadMembership(user).then(goToDemo);
    }
  };
  afterMembership();
}

authEl("authToggleMode") && authEl("authToggleMode").addEventListener("click", function () {
  setAuthMode(authMode === "login" ? "signup" : "login");
});

var authFormEl = authEl("authForm");
if (authFormEl) {
  authFormEl.addEventListener("submit", function (e) {
    e.preventDefault();
    if (!sb) { setAuthStatus("Not connected to Supabase yet."); return; }
    var email = authEl("authEmail").value.trim();
    var password = authEl("authPassword").value;
    setAuthStatus(authMode === "login" ? "Logging in…" : "Signing up…");
    var name = authEl("authName").value.trim();
    if (authMode === "signup" && !name) { setAuthStatus("Enter your name."); authEl("authName").focus(); return; }
    var call = authMode === "login"
      ? sb.auth.signInWithPassword({ email: email, password: password })
      // The name is stored with the account; the database copies it into profiles.
      : sb.auth.signUp({ email: email, password: password, options: { data: { full_name: name } } });
    call.then(function (res) {
      if (res.error) {
        var unconfirmed = res.error.code === "email_not_confirmed" || /not confirmed/i.test(res.error.message);
        setAuthStatus(unconfirmed
          ? "Your email isn't confirmed yet. Click the link in the email we sent (check spam too), then log in."
          : res.error.message);
        authEl("authResendRow").hidden = !unconfirmed;
        return;
      }
      // With email confirmation on, sign-up returns the new user but no session:
      // they aren't logged in until they click the link in the email.
      if (!res.data.session) {
        setAuthMode("login");
        setAuthStatus("Almost there: we sent a confirmation link to " + email + ". Click it, then log in here.");
        authEl("authResendRow").hidden = false;
        return;
      }
      onAuthed(res.data.user);
    });
  });
}

document.querySelectorAll(".pw-toggle").forEach(function (btn) {
  btn.addEventListener("click", function () {
    setPasswordVisible(btn, btn.getAttribute("aria-pressed") !== "true");
  });
});

authEl("authResendBtn").addEventListener("click", function () {
  var email = authEl("authEmail").value.trim();
  if (!email) { setAuthStatus("Type your email above first."); return; }
  setAuthStatus("Sending\u2026");
  sb.auth.resend({ type: "signup", email: email }).then(function (res) {
    setAuthStatus(res.error ? res.error.message : "New confirmation email sent to " + email + ". Check your inbox and spam.");
  });
});

var authForgotBtnEl = authEl("authForgotBtn");
if (authForgotBtnEl) {
  authForgotBtnEl.addEventListener("click", function () {
    if (!sb) { setAuthStatus("Not connected to Supabase yet."); return; }
    var emailEl = authEl("authEmail");
    var email = emailEl.value.trim();
    if (!email || !emailEl.checkValidity()) {
      setAuthStatus("Type your email above, then click \u201cForgot password?\u201d again.");
      emailEl.focus();
      return;
    }
    setAuthStatus("Sending reset link\u2026");
    // The link in the email brings the visitor back to this page. A local
    // file:// page can't be a redirect target, so fall back to the Site URL
    // configured in Supabase.
    var opts = window.location.protocol === "file:" ? {} : { redirectTo: window.location.origin + window.location.pathname };
    sb.auth.resetPasswordForEmail(email, opts).then(function (res) {
      if (res.error) { setAuthStatus(res.error.message); return; }
      setAuthStatus("If there's an account for " + email + ", a reset link is on its way. Check your inbox.");
    });
  });
}

var authResetFormEl = authEl("authResetForm");
if (authResetFormEl) {
  authResetFormEl.addEventListener("submit", function (e) {
    e.preventDefault();
    var status = authEl("authResetStatus");
    status.textContent = "Saving\u2026";
    sb.auth.updateUser({ password: authEl("authNewPassword").value }).then(function (res) {
      if (res.error) { status.textContent = res.error.message; return; }
      status.textContent = "";
      authEl("authNewPassword").value = "";
      authResetFormEl.hidden = true;
      hidePasswords();
      setAuthMode("login");
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
      onAuthed(res.data.user);
    });
  });
}

var goToDemoBtnEl = authEl("goToDemoBtn");
if (goToDemoBtnEl) {
  goToDemoBtnEl.addEventListener("click", function () {
    closeAuthModal();
    openDemo();
  });
}

var logoutBtnEl = authEl("logoutBtn");
if (logoutBtnEl) {
  logoutBtnEl.addEventListener("click", function () {
    signOut();
  });
}

// Shared by the login pop-up and account settings.
var signingOut = false;
function signOut() {
  signingOut = true;
  return sb.auth.signOut().then(function () {
    signingOut = false;
    currentTeam = null;
    currentUser = null;
    currentProfile = null;
    updateTeamBadge();
    if (typeof onAccountChanged === "function") onAccountChanged();
    authEl("loggedInPanel").hidden = true;
    authEl("authForm").hidden = false;
    authEl("authEmail").value = "";
    authEl("authPassword").value = "";
    hidePasswords();
    setAuthMode("login");
  });
}

document.querySelectorAll(".open-auth-btn").forEach(function (b) { b.addEventListener("click", openAuthModal); });
var authModalCloseEl = authEl("authModalClose");
if (authModalCloseEl) authModalCloseEl.addEventListener("click", closeAuthModal);
var authModalOverlayEl = authEl("authModalOverlay");
if (authModalOverlayEl) {
  var authPressedOnBackdrop = false;
  authModalOverlayEl.addEventListener("mousedown", function (e) { authPressedOnBackdrop = e.target.id === "authModalOverlay"; });
  authModalOverlayEl.addEventListener("click", function (e) { if (e.target.id === "authModalOverlay" && authPressedOnBackdrop) closeAuthModal(); });
}
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape" && authModalOverlayEl && !authModalOverlayEl.hidden) closeAuthModal();
});

// If already logged in from a previous visit (Supabase keeps the session
// in the browser), pick that session back up automatically. Otherwise, if
// this visit came from an invite link (?invite=...), pop the auth modal
// open right away in signup mode so the invite is actually visible instead
// of silently waiting for the visitor to click "Log in" on their own.
if (sb) {
  sb.auth.onAuthStateChange(function (event, session) {
    if (event === "PASSWORD_RECOVERY") showResetForm();
    // All tabs share one login. If another tab logs in as someone else (or
    // out), this page would otherwise keep showing the old account while its
    // requests go out as the new one, and the database rejects them. Reload so
    // the page matches the login. Our own sign-out sets signingOut first.
    var sessionUserId = session && session.user ? session.user.id : null;
    if (currentUser && !signingOut && sessionUserId !== currentUser.id) {
      window.location.reload();
    }
  });
  sb.auth.getSession().then(function (res) {
    if (isRecoveryLink) {
      // Logged in by the reset link: ask for the new password first.
      showResetForm();
    } else if (res.data && res.data.session) {
      onAuthed(res.data.session.user);
    } else if (pendingInviteId) {
      setAuthMode("signup");
      openAuthModal();
    }
  });
}
