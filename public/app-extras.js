/* CMD//SIGNAL — extras: résumé upload + Fit Lab. Self-contained; uses window.appState. */
(function () {
  const t = (k) => window.I18N.t(k);
  const S = () => window.appState || {};
  const esc = (s = "") => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---- inject minimal styles (reusing the existing palette) ----
  const css = document.createElement("style");
  css.textContent = `
    .cs-fab{position:fixed;z-index:55;border-radius:12px;padding:11px 15px;font-size:13px;font-weight:600;
      display:none;align-items:center;gap:8px;box-shadow:0 8px 26px #0008;border:none;cursor:pointer}
    #cs-fab-resume{left:18px;bottom:18px;background:var(--surface2);border:1px solid var(--line2);color:var(--text)}
    #cs-fab-fitlab{right:18px;bottom:18px;background:linear-gradient(140deg,#F5B33c,#e08b1e);color:#1a1304}
    .cs-modal{position:fixed;inset:0;z-index:70;background:#06090fcc;backdrop-filter:blur(6px);display:grid;place-items:center;padding:18px}
    .cs-sheet{background:var(--surface);border:1px solid var(--line2);border-radius:16px;max-width:620px;width:100%;
      max-height:88vh;overflow:auto;padding:22px}
    .cs-sheet h3{font-family:var(--disp);font-size:20px;margin:0 0 4px}
    .cs-x{float:right;background:var(--surface2);border:1px solid var(--line);color:var(--muted);border-radius:9px;
      width:32px;height:32px;cursor:pointer;font-size:16px}
    .cs-block{border:1px solid var(--line);border-radius:11px;padding:13px 15px;margin-top:12px;background:var(--bg2)}
    .cs-lbl{font-family:var(--mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin-bottom:8px}
    .cs-pill{display:inline-block;font-size:11px;font-family:var(--mono);padding:3px 9px;border-radius:7px;margin:3px 4px 0 0;
      border:1px solid var(--line);color:var(--muted);background:#ffffff08}
    .cs-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:90;background:var(--surface2);
      border:1px solid var(--line2);color:var(--text);padding:11px 16px;border-radius:11px;font-size:13px;box-shadow:0 8px 26px #0008}
    .cs-copy{background:var(--surface2);border:1px solid var(--line);color:var(--signal);border-radius:8px;padding:5px 10px;font-size:11.5px;cursor:pointer;float:right}
  `;
  document.head.appendChild(css);

  // hidden file input
  const file = document.createElement("input");
  file.type = "file"; file.accept = ".pdf,.docx,.txt,.md"; file.style.display = "none";
  document.body.appendChild(file);

  // FABs
  const fabResume = document.createElement("button");
  fabResume.id = "cs-fab-resume"; fabResume.className = "cs-fab";
  fabResume.innerHTML = `<svg style="width:1em;height:1em;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg><span></span>`;
  const fabFit = document.createElement("button");
  fabFit.id = "cs-fab-fitlab"; fabFit.className = "cs-fab";
  fabFit.innerHTML = `<svg style="width:1em;height:1em;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round" viewBox="0 0 24 24"><path d="M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z"/></svg>Fit Lab`;
  document.body.append(fabResume, fabFit);

  function refreshFabs() {
    const st = S();
    fabResume.querySelector("span").textContent = t("upload_resume");
    fabResume.style.display = st.step === "intake" ? "inline-flex" : "none";
    fabFit.style.display = (st.step === "app" && (st.jobs || []).length) ? "inline-flex" : "none";
  }
  // re-evaluate whenever the app re-renders #root
  const obs = new MutationObserver(refreshFabs);
  const start = () => { const r = document.getElementById("root"); if (r) { obs.observe(r, { childList: true, subtree: true }); refreshFabs(); } else setTimeout(start, 200); };
  start();

  function toast(msg) {
    const el = document.createElement("div"); el.className = "cs-toast"; el.textContent = msg; document.body.appendChild(el);
    setTimeout(() => el.remove(), 3200);
  }

  // ---- résumé upload ----
  fabResume.onclick = () => file.click();
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    fabResume.querySelector("span").textContent = t("reading_resume"); fabResume.disabled = true;
    try {
      const fd = new FormData(); fd.append("resume", f);
      const r = await fetch("/api/resume", { method: "POST", body: fd });
      const data = await r.json().catch(() => ({ error: "Upload failed" }));
      if (!r.ok || data.error) throw new Error(data.error || "Upload failed");
      if (window.appState) window.appState.cv = data.text || window.appState.cv;
      toast(t("resume_loaded"));
      window.bootApp && window.bootApp();
    } catch (e) { toast(e.message); }
    fabResume.disabled = false; file.value = ""; refreshFabs();
  };

  // ---- Fit Lab ----
  fabFit.onclick = () => openFitLab();
  function modal(html) {
    const m = document.createElement("div"); m.className = "cs-modal";
    m.innerHTML = `<div class="cs-sheet">${html}</div>`;
    m.addEventListener("click", (e) => { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    const x = m.querySelector("[data-x-close]"); if (x) x.onclick = () => m.remove();
    return m;
  }
  function openFitLab() {
    const jobs = (S().jobs || []);
    const opts = jobs.map((j, i) => `<option value="${i}">${esc(j.company)} — ${esc(j.role)}</option>`).join("");
    const m = modal(`
      <button class="cs-x" data-x-close>✕</button>
      <h3>Fit Lab</h3>
      <p style="color:var(--muted);font-size:13px;margin:0 0 14px">Pick a match. Fit Lab compares it to your résumé and builds a tailored plan — honest fit score, the gaps to close, rewritten bullets, and a proof-of-work hook for the outreach.</p>
      <select id="cs-fl-job" class="inp" style="margin-bottom:12px">${opts}</select>
      <button class="solid" id="cs-fl-run" style="width:100%;justify-content:center;padding:11px">Build my plan</button>
      <div id="cs-fl-out" style="margin-top:8px"></div>`);
    m.querySelector("#cs-fl-run").onclick = () => runFit(m);
  }
  async function runFit(m) {
    const idx = parseInt(m.querySelector("#cs-fl-job").value, 10);
    const job = (S().jobs || [])[idx]; if (!job) return;
    const out = m.querySelector("#cs-fl-out");
    out.innerHTML = `<div class="loadwrap" style="padding:34px 0"><div class="scanner"></div><p>Comparing your résumé to ${esc(job.role)} @ ${esc(job.company)}…</p></div>`;
    try {
      const r = await fetch("/api/fitlab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job, profile: S().profile, lang: window.I18N.lang }) });
      const data = await r.json().catch(() => ({ error: "Fit Lab failed" }));
      if (!r.ok || data.error) throw new Error(data.error || "Fit Lab failed");
      out.innerHTML = renderPlan(data.plan, job);
      const cb = out.querySelector("[data-copy-cover]");
      if (cb) cb.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(data.plan.cover_note || ""); cb.textContent = "copied"; };
      const pb = out.querySelector("[data-copy-pow]");
      if (pb) pb.onclick = () => { navigator.clipboard && navigator.clipboard.writeText(data.plan.proof_of_work || ""); pb.textContent = "copied"; };
    } catch (e) { out.innerHTML = `<div class="errbar" style="margin-top:12px">${esc(e.message)}</div>`; }
  }
  function renderPlan(p, job) {
    const list = (arr) => (arr || []).map((x) => `<div style="color:#c3cbdd;font-size:13px;margin:6px 0;padding-left:12px;border-left:2px solid var(--line2)">${esc(x)}</div>`).join("");
    const score = Math.max(0, Math.min(100, Math.round(p.fit_score || 0)));
    const col = score >= 80 ? "var(--mint)" : score >= 60 ? "var(--signal)" : "var(--rose)";
    return `
      <div class="cs-block" style="display:flex;align-items:center;gap:14px">
        <div style="font-family:var(--disp);font-weight:700;font-size:30px;color:${col}">${score}<span style="font-size:13px;color:var(--faint)">/100</span></div>
        <div style="color:var(--muted);font-size:12.5px">honest fit for <b style="color:var(--text)">${esc(job.role)}</b> @ ${esc(job.company)}</div>
      </div>
      <div class="cs-block"><div class="cs-lbl">What already matches</div>${list(p.have)}</div>
      <div class="cs-block"><div class="cs-lbl">Gaps to close</div>${(p.gaps || []).map((g) => `<span class="cs-pill" style="color:var(--rose);border-color:#f4738a44">${esc(g)}</span>`).join("")}</div>
      <div class="cs-block"><div class="cs-lbl">Tailored résumé bullets</div>${list(p.tailored_bullets)}</div>
      <div class="cs-block"><div class="cs-lbl">Proof-of-work hook <button class="cs-copy" data-copy-pow>copy</button></div>
        <div style="color:#e9edf6;font-size:13.5px;line-height:1.6">${esc(p.proof_of_work || "")}</div></div>
      <div class="cs-block"><div class="cs-lbl">Cover note <button class="cs-copy" data-copy-cover>copy</button></div>
        <div style="color:#c8d0e2;font-size:13px;line-height:1.65">${esc(p.cover_note || "")}</div></div>
      ${(p.keywords_to_add && p.keywords_to_add.length) ? `<div class="cs-block"><div class="cs-lbl">ATS keywords to add</div>${p.keywords_to_add.map((k) => `<span class="cs-pill">${esc(k)}</span>`).join("")}</div>` : ""}`;
  }
})();
