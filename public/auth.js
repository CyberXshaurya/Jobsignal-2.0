/* CMD//SIGNAL — auth gate. Runs after app.js, controls #root until the user is in. */
(function () {
  const t = (k) => window.I18N.t(k);
  const root = () => document.getElementById("root");
  const A = { mode: "login", email: "", err: "", info: "", busy: false, devCode: "" };

  async function post(path, body) {
    const r = await fetch("/api" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => ({ error: "Bad response from server" }));
    if (!r.ok || data.error) throw new Error(data.error || "Server " + r.status);
    return data;
  }
  const svg = (p) => `<svg style="width:1em;height:1em;vertical-align:-.12em;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24">${p}</svg>`;
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function renderAuth() {
    const sweep = `<div class="sweep" style="width:96px;height:96px;margin:0 auto 22px">
      <div class="ring"></div><div class="ring r2"></div><div class="ring r3"></div><div class="arm"></div>
      <div class="blip" style="top:14px;left:54px"></div>
      <div class="blip" style="top:64px;left:24px;background:var(--cyan);box-shadow:0 0 10px var(--cyan)"></div></div>`;

    let form;
    if (A.mode === "verify") {
      form = `
        <div class="field"><label>${svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7l8 6 8-6"/>')}${t("code")}</label>
          <input id="au-code" class="inp" inputmode="numeric" maxlength="6" placeholder="••••••" value="" style="letter-spacing:.5em;text-align:center;font-family:var(--mono);font-size:18px"></div>
        <button class="solid" style="width:100%;justify-content:center;padding:12px" data-auth="verify" ${A.busy ? "disabled" : ""}>${A.busy ? t("verifying") : t("verify")}</button>
        <div style="text-align:center;margin-top:14px;font-size:12.5px;color:var(--muted)">${t("sent_code")} <b style="color:var(--text)">${esc(A.email)}</b></div>
        <div class="row" style="justify-content:center;gap:14px;margin-top:10px">
          <a data-auth="resend" style="color:var(--signal);font-size:12.5px;cursor:pointer">${t("resend")}</a>
          <a data-auth="back" style="color:var(--faint);font-size:12.5px;cursor:pointer">${t("change_email")}</a>
        </div>
        ${A.devCode ? `<div style="text-align:center;margin-top:12px;font-family:var(--mono);font-size:11px;color:var(--faint)">dev code: <b style="color:var(--cyan)">${esc(A.devCode)}</b></div>` : ""}`;
    } else {
      const isSignup = A.mode === "signup";
      form = `
        <div class="field"><label>${svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M4 7l8 6 8-6"/>')}${t("email")}</label>
          <input id="au-email" class="inp" type="email" autocomplete="email" placeholder="you@email.com" value="${esc(A.email)}"></div>
        <div class="field"><label>${svg('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>')}${t("password")}</label>
          <input id="au-pw" class="inp" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" placeholder="••••••••"></div>
        <button class="solid" style="width:100%;justify-content:center;padding:12px" data-auth="${isSignup ? "signup" : "login"}" ${A.busy ? "disabled" : ""}>
          ${A.busy ? (isSignup ? t("creating") : t("signing")) : (isSignup ? t("signup") : t("signin"))}</button>
        <div style="text-align:center;margin-top:16px;font-size:13px;color:var(--muted)">
          ${isSignup ? t("have_account") : t("no_account")}
          <a data-auth="toggle" style="color:var(--signal);cursor:pointer;margin-left:6px">${isSignup ? t("signin") : t("signup")}</a>
        </div>`;
    }

    root().innerHTML = `<div class="shell">
      <div style="max-width:420px;margin:0 auto;padding:52px 0 80px">
        ${sweep}
        <div class="eyebrow" style="text-align:center;margin-bottom:10px">AI job-search command center</div>
        <h1 style="font-family:var(--disp);font-size:26px;font-weight:700;letter-spacing:-.02em;text-align:center;margin:0 0 8px;line-height:1.15">${esc(t("welcome"))}</h1>
        <p style="color:var(--muted);font-size:13.5px;text-align:center;max-width:360px;margin:0 auto 26px">${esc(t("sub"))}</p>
        <div class="card" style="padding:22px">
          ${A.err ? `<div class="errbar" style="margin-bottom:14px">${svg('<path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/>')}${esc(A.err)}</div>` : ""}
          ${A.info ? `<div class="errbar" style="margin-bottom:14px;background:var(--cyan-dim);border-color:#54c7e833;color:var(--cyan)">${esc(A.info)}</div>` : ""}
          ${form}
        </div>
        <p style="text-align:center;color:var(--faint);font-size:11.5px;margin-top:16px;font-family:var(--mono)">${esc(t("secured"))}</p>
      </div></div>`;
    mountChrome();
  }

  /* floating language + logout */
  function mountChrome(loggedIn) {
    let el = document.getElementById("cs-chrome");
    if (!el) { el = document.createElement("div"); el.id = "cs-chrome"; document.body.appendChild(el); }
    el.style.cssText = "position:fixed;top:14px;right:16px;z-index:60;display:flex;gap:8px;align-items:center";
    const opts = window.I18N.list().map((l) => `<option value="${l.code}" ${l.code === window.I18N.lang ? "selected" : ""}>${l.label}</option>`).join("");
    el.innerHTML = `
      <select id="cs-lang" title="${t("language")}" style="background:var(--surface);border:1px solid var(--line);color:var(--text);border-radius:9px;padding:7px 10px;font-size:12.5px;font-family:var(--sans)">${opts}</select>
      ${loggedIn ? `<button id="cs-logout" class="ghost" style="padding:7px 11px;font-size:12.5px">${t("logout")}</button>` : ""}`;
    document.getElementById("cs-lang").onchange = (e) => {
      window.I18N.set(e.target.value);
      if (window.appState) window.appState.lang = e.target.value;
      if (window.appState && window.appState.step === "app") { window.bootApp(); mountChrome(true); }
      else renderAuth();
    };
    const lo = document.getElementById("cs-logout");
    if (lo) lo.onclick = async () => { try { await post("/auth/logout", {}); } catch (e) {} location.reload(); };
  }

  async function afterLogin() {
    try {
      const p = await fetch("/api/profile").then((r) => r.json());
      if (window.appState) {
        window.appState.lang = window.I18N.lang;
        if (p.prefs) window.appState.prefs = { ...window.appState.prefs, ...p.prefs };
        if (p.cv || p.resume_text) window.appState.cv = p.cv || p.resume_text || "";
        if (p.profile) { window.appState.profile = p.profile; window.appState.step = "app"; window.appState.tab = "signals"; }
      }
    } catch (e) {}
    window.bootApp();
    mountChrome(true);
  }

  function readVal(id) { const el = document.getElementById(id); return el ? el.value.trim() : ""; }

  document.addEventListener("click", async (e) => {
    const t0 = e.target.closest("[data-auth]"); if (!t0) return;
    const act = t0.getAttribute("data-auth");
    A.err = ""; A.info = "";
    if (act === "toggle") { A.mode = A.mode === "signup" ? "login" : "signup"; return renderAuth(); }
    if (act === "back") { A.mode = "login"; A.devCode = ""; return renderAuth(); }

    try {
      if (act === "signup" || act === "login") {
        A.email = readVal("au-email").toLowerCase();
        const pw = readVal("au-pw");
        if (!A.email) { A.err = "Enter your email."; return renderAuth(); }
        if (pw.length < 8) { A.err = t("min_pw"); return renderAuth(); }
        A.busy = true; renderAuth();
        const data = await post("/auth/" + act, { email: A.email, password: pw });
        A.busy = false;
        if (data.next === "verify") { A.mode = "verify"; A.devCode = data.devCode || ""; A.info = `${t("sent_code")} ${A.email}.`; return renderAuth(); }
        if (data.user) return afterLogin();
        renderAuth();
      } else if (act === "verify") {
        const code = readVal("au-code");
        if (code.length < 6) { A.err = "Enter the 6-digit code."; return renderAuth(); }
        A.busy = true; renderAuth();
        const data = await post("/auth/verify", { email: A.email, code });
        A.busy = false;
        if (data.user) return afterLogin();
        renderAuth();
      } else if (act === "resend") {
        const data = await post("/auth/resend", { email: A.email });
        A.devCode = data.devCode || ""; A.info = t("sent_code") + " " + A.email + "."; renderAuth();
      }
    } catch (err) {
      A.busy = false; A.err = err.message; renderAuth();
    }
  });

  // Boot: decide auth vs app. (app.js no longer auto-renders.)
  (async function boot() {
    try {
      const { user } = await fetch("/api/auth/me").then((r) => r.json());
      if (user) return afterLogin();
    } catch (e) {}
    renderAuth();
  })();
})();
