import express from "express";
import dotenv from "dotenv";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import multer from "multer";
import nodemailer from "nodemailer";
import Database from "better-sqlite3";
import crypto from "crypto";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

dotenv.config();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* ============================================================
   CONFIG
   ============================================================ */
const GEMINI_KEY = process.env.GEMINI_API_KEY;
const TAVILY_KEY = process.env.TAVILY_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const GEMINI_BASE = process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com/v1beta";
const TAVILY_URL = process.env.TAVILY_URL || "https://api.tavily.com/search";
const MAX_TOKENS = parseInt(process.env.MAX_TOKENS || "4000", 10);
const PORT = process.env.PORT || 3000;
const PROD = process.env.NODE_ENV === "production";

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  JWT_SECRET = crypto.randomBytes(32).toString("hex");
  console.warn("⚠  JWT_SECRET missing in .env — generated a temporary one. Sessions will reset on every restart. Set JWT_SECRET in production.");
}

const DATA_DIR = path.join(__dirname, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/* ============================================================
   DATABASE (SQLite via better-sqlite3 — zero-config, file-based)
   ============================================================ */
const db = new Database(path.join(DATA_DIR, "cmdsignal.db"));
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS otps (
    email TEXT NOT NULL,
    purpose TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_sent INTEGER NOT NULL,
    PRIMARY KEY (email, purpose)
  );
  CREATE TABLE IF NOT EXISTS profiles (
    user_id INTEGER PRIMARY KEY,
    profile_json TEXT,
    prefs_json TEXT,
    cv TEXT,
    resume_text TEXT,
    resume_filename TEXT,
    updated_at TEXT
  );
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    data_json TEXT NOT NULL,
    status TEXT,
    scheduled_at INTEGER,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_items_user ON items (user_id, kind);
`);

/* ============================================================
   EMAIL (nodemailer). If no SMTP configured -> dev mode:
   the OTP is printed to the server console so you can still
   test the full flow locally without an email provider.
   ============================================================ */
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}
const FROM = process.env.MAIL_FROM || "CMD//SIGNAL <no-reply@cmdsignal.app>";
const OTP_DEV_ECHO = process.env.OTP_DEV_ECHO === "true"; // only for local testing

async function sendOtpEmail(email, code) {
  const subject = "Your CMD//SIGNAL verification code";
  const text = `Your verification code is ${code}. It expires in 10 minutes.`;
  const html = `
    <div style="font-family:Inter,system-ui,sans-serif;background:#0C1018;color:#E9EDF6;padding:32px;border-radius:14px;max-width:440px">
      <div style="font-family:'Space Grotesk',sans-serif;font-weight:700;font-size:18px;letter-spacing:-.01em">CMD//SIGNAL</div>
      <p style="color:#8A96AF;font-size:14px;margin:18px 0 6px">Your verification code</p>
      <div style="font-family:ui-monospace,Menlo,monospace;font-size:34px;letter-spacing:.4em;color:#F5B33C;font-weight:700">${code}</div>
      <p style="color:#5A647E;font-size:12px;margin-top:18px">Expires in 10 minutes. If you didn't request this, ignore this email.</p>
    </div>`;
  if (!transporter) {
    console.log(`\n📨  [DEV] OTP for ${email}  ->  ${code}   (no SMTP configured; printing to console)\n`);
    return;
  }
  await transporter.sendMail({ from: FROM, to: email, subject, text, html });
}

/* ============================================================
   APP
   ============================================================ */
const app = express();
app.set("trust proxy", 1); // needed on most hosts (Render/Railway/etc.) for secure cookies + rate-limit
app.use(express.json({ limit: "3mb" }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });

/* ---------- auth helpers ---------- */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const genOtp = () => String(Math.floor(100000 + Math.random() * 900000));
const hash = (s) => bcrypt.hash(s, 10);
const compare = (s, h) => bcrypt.compare(s, h);

function setSession(res, user) {
  const token = jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
  res.cookie("cs_session", token, {
    httpOnly: true,
    secure: PROD,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });
}
function requireAuth(req, res, next) {
  const token = req.cookies?.cs_session;
  if (!token) return res.status(401).json({ error: "Please sign in to continue." });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    req.userId = p.uid;
    req.email = p.email;
    next();
  } catch {
    res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

async function issueOtp(email, purpose) {
  const now = Date.now();
  const existing = db.prepare("SELECT last_sent FROM otps WHERE email=? AND purpose=?").get(email, purpose);
  if (existing && now - existing.last_sent < 60 * 1000) {
    throw new Error("Please wait a minute before requesting another code.");
  }
  const code = genOtp();
  const code_hash = await hash(code);
  db.prepare(
    `INSERT INTO otps (email, purpose, code_hash, expires_at, attempts, last_sent)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(email, purpose) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, last_sent=excluded.last_sent`
  ).run(email, purpose, code_hash, now + 10 * 60 * 1000, 0, now);
  await sendOtpEmail(email, code);
  return OTP_DEV_ECHO ? code : undefined;
}
async function checkOtp(email, purpose, code) {
  const row = db.prepare("SELECT * FROM otps WHERE email=? AND purpose=?").get(email, purpose);
  if (!row) throw new Error("No code found. Request a new one.");
  if (Date.now() > row.expires_at) { db.prepare("DELETE FROM otps WHERE email=? AND purpose=?").run(email, purpose); throw new Error("Code expired. Request a new one."); }
  if (row.attempts >= 5) { db.prepare("DELETE FROM otps WHERE email=? AND purpose=?").run(email, purpose); throw new Error("Too many attempts. Request a new code."); }
  const ok = await compare(String(code || ""), row.code_hash);
  if (!ok) {
    db.prepare("UPDATE otps SET attempts=attempts+1 WHERE email=? AND purpose=?").run(email, purpose);
    throw new Error("Incorrect code. Try again.");
  }
  db.prepare("DELETE FROM otps WHERE email=? AND purpose=?").run(email, purpose);
}

const wrap = (fn) => async (req, res) => {
  try { await fn(req, res); }
  catch (e) { console.error("✗", e.message); res.status(e.status || 502).json({ error: e.message }); }
};

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40, standardHeaders: true, legacyHeaders: false });

/* ============================================================
   AUTH ROUTES
   ============================================================ */
app.post("/api/auth/signup", authLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address.");
  if (password.length < 8) throw new Error("Password must be at least 8 characters.");
  const exists = db.prepare("SELECT id, verified FROM users WHERE email=?").get(email);
  if (exists && exists.verified) throw new Error("An account with this email already exists. Sign in instead.");
  const password_hash = await hash(password);
  if (exists) {
    db.prepare("UPDATE users SET password_hash=? WHERE email=?").run(password_hash, email);
  } else {
    db.prepare("INSERT INTO users (email, password_hash, verified, created_at) VALUES (?,?,0,?)").run(email, password_hash, new Date().toISOString());
  }
  const echo = await issueOtp(email, "verify");
  res.json({ ok: true, next: "verify", email, devCode: echo });
}));

app.post("/api/auth/verify", authLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const code = String(req.body.code || "");
  await checkOtp(email, "verify", code);
  db.prepare("UPDATE users SET verified=1 WHERE email=?").run(email);
  const user = db.prepare("SELECT id, email FROM users WHERE email=?").get(email);
  setSession(res, user);
  res.json({ ok: true, user });
}));

app.post("/api/auth/login", authLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const user = db.prepare("SELECT * FROM users WHERE email=?").get(email);
  if (!user) throw new Error("No account found. Sign up first.");
  const ok = await compare(password, user.password_hash);
  if (!ok) throw new Error("Incorrect email or password.");
  if (!user.verified) {
    const echo = await issueOtp(email, "verify");
    return res.json({ ok: true, next: "verify", email, devCode: echo });
  }
  setSession(res, user);
  res.json({ ok: true, user: { id: user.id, email: user.email } });
}));

app.post("/api/auth/resend", authLimiter, wrap(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw new Error("Enter a valid email address.");
  const echo = await issueOtp(email, "verify");
  res.json({ ok: true, devCode: echo });
}));

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("cs_session");
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const token = req.cookies?.cs_session;
  if (!token) return res.json({ user: null });
  try { const p = jwt.verify(token, JWT_SECRET); res.json({ user: { id: p.uid, email: p.email } }); }
  catch { res.json({ user: null }); }
});

/* ============================================================
   PROFILE + RESUME
   ============================================================ */
app.get("/api/profile", requireAuth, wrap(async (req, res) => {
  const row = db.prepare("SELECT * FROM profiles WHERE user_id=?").get(req.userId);
  if (!row) return res.json({ profile: null, prefs: null, cv: "", resume_text: "", resume_filename: "" });
  res.json({
    profile: row.profile_json ? JSON.parse(row.profile_json) : null,
    prefs: row.prefs_json ? JSON.parse(row.prefs_json) : null,
    cv: row.cv || "",
    resume_text: row.resume_text || "",
    resume_filename: row.resume_filename || "",
  });
}));

app.post("/api/profile", requireAuth, wrap(async (req, res) => {
  const { profile, prefs, cv } = req.body;
  const existing = db.prepare("SELECT user_id FROM profiles WHERE user_id=?").get(req.userId);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare(`UPDATE profiles SET
      profile_json=COALESCE(?, profile_json),
      prefs_json=COALESCE(?, prefs_json),
      cv=COALESCE(?, cv),
      updated_at=? WHERE user_id=?`).run(
      profile ? JSON.stringify(profile) : null,
      prefs ? JSON.stringify(prefs) : null,
      cv != null ? cv : null,
      now, req.userId
    );
  } else {
    db.prepare(`INSERT INTO profiles (user_id, profile_json, prefs_json, cv, updated_at) VALUES (?,?,?,?,?)`).run(
      req.userId,
      profile ? JSON.stringify(profile) : null,
      prefs ? JSON.stringify(prefs) : null,
      cv || "",
      now
    );
  }
  res.json({ ok: true });
}));

/* Resume upload: PDF / DOCX / TXT -> extract text, store text for the AI to use */
app.post("/api/resume", requireAuth, upload.single("resume"), wrap(async (req, res) => {
  if (!req.file) throw new Error("No file received. Attach a PDF, DOCX, or TXT résumé.");
  const name = req.file.originalname || "resume";
  const buf = req.file.buffer;
  const ext = (name.split(".").pop() || "").toLowerCase();
  let text = "";
  try {
    if (ext === "pdf") {
      const mod = await import("pdf-parse");
      const pdf = mod.default || mod;
      text = (await pdf(buf)).text || "";
    } else if (ext === "docx") {
      const mammoth = (await import("mammoth")).default;
      text = (await mammoth.extractRawText({ buffer: buf })).value || "";
    } else if (ext === "txt" || ext === "md") {
      text = buf.toString("utf8");
    } else {
      throw new Error("Unsupported file type. Use PDF, DOCX, or TXT.");
    }
  } catch (e) {
    throw new Error("Couldn't read that file — try exporting a clean PDF/DOCX, or paste the text directly. (" + e.message + ")");
  }
  text = text.replace(/\n{3,}/g, "\n\n").trim();
  if (text.length < 30) throw new Error("That file had almost no readable text (maybe a scanned image). Paste the text directly instead.");

  // save file + extracted text
  const safe = req.userId + "_" + Date.now() + "_" + name.replace(/[^a-z0-9._-]/gi, "_");
  fs.writeFileSync(path.join(UPLOAD_DIR, safe), buf);
  const existing = db.prepare("SELECT user_id FROM profiles WHERE user_id=?").get(req.userId);
  const now = new Date().toISOString();
  if (existing) {
    db.prepare("UPDATE profiles SET resume_text=?, resume_filename=?, cv=COALESCE(NULLIF(cv,''), ?), updated_at=? WHERE user_id=?")
      .run(text, name, text, now, req.userId);
  } else {
    db.prepare("INSERT INTO profiles (user_id, resume_text, resume_filename, cv, updated_at) VALUES (?,?,?,?,?)")
      .run(req.userId, text, name, text, now);
  }
  res.json({ ok: true, filename: name, chars: text.length, text });
}));

/* ============================================================
   SAVED ITEMS (pipeline / outreach / monitoring persistence)
   ============================================================ */
app.get("/api/items", requireAuth, wrap(async (req, res) => {
  const kind = req.query.kind;
  const rows = kind
    ? db.prepare("SELECT * FROM items WHERE user_id=? AND kind=? ORDER BY created_at DESC").all(req.userId, kind)
    : db.prepare("SELECT * FROM items WHERE user_id=? ORDER BY created_at DESC").all(req.userId);
  res.json({ items: rows.map((r) => ({ id: r.id, kind: r.kind, status: r.status, scheduled_at: r.scheduled_at, created_at: r.created_at, data: JSON.parse(r.data_json) })) });
}));
app.post("/api/items", requireAuth, wrap(async (req, res) => {
  const { kind, data, status = null, scheduled_at = null, id } = req.body;
  if (!kind || !data) throw new Error("kind and data are required.");
  const itemId = id || (kind + "_" + Date.now() + "_" + crypto.randomBytes(3).toString("hex"));
  db.prepare("INSERT OR REPLACE INTO items (id, user_id, kind, data_json, status, scheduled_at, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(itemId, req.userId, kind, JSON.stringify(data), status, scheduled_at, new Date().toISOString());
  res.json({ ok: true, id: itemId });
}));
app.patch("/api/items/:id", requireAuth, wrap(async (req, res) => {
  const { status, data, scheduled_at } = req.body;
  const row = db.prepare("SELECT * FROM items WHERE id=? AND user_id=?").get(req.params.id, req.userId);
  if (!row) throw new Error("Item not found.");
  db.prepare("UPDATE items SET status=COALESCE(?,status), data_json=COALESCE(?,data_json), scheduled_at=COALESCE(?,scheduled_at) WHERE id=? AND user_id=?")
    .run(status ?? null, data ? JSON.stringify(data) : null, scheduled_at ?? null, req.params.id, req.userId);
  res.json({ ok: true });
}));
app.delete("/api/items/:id", requireAuth, wrap(async (req, res) => {
  db.prepare("DELETE FROM items WHERE id=? AND user_id=?").run(req.params.id, req.userId);
  res.json({ ok: true });
}));

/* ============================================================
   ---- AI CORE (unchanged logic from your original, kept intact) ----
   ============================================================ */
async function callGemini(userText, { system, lang } = {}) {
  if (!GEMINI_KEY) throw new Error("GEMINI_API_KEY is missing — add it to your .env file.");
  const sys = (system || "") + (lang && lang !== "en" ? `\nReply in this language: ${lang}. Keep JSON keys in English; only translate human-readable values.` : "");
  const body = {
    contents: [{ role: "user", parts: [{ text: userText }] }],
    generationConfig: { maxOutputTokens: MAX_TOKENS, temperature: 0.4, responseMimeType: "application/json" },
  };
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };
  const r = await fetch(`${GEMINI_BASE}/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": GEMINI_KEY },
    body: JSON.stringify(body),
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`Gemini ${r.status}: ${t.slice(0, 280)}`); }
  const data = await r.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p.text || "").join("\n").trim();
}

async function tavilySearch(query, max = 5) {
  if (!TAVILY_KEY) throw new Error("TAVILY_API_KEY is missing — add it to your .env to enable live web search.");
  const r = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: TAVILY_KEY, query, max_results: max, search_depth: "basic" }),
  });
  if (!r.ok) { const t = await r.text().catch(() => ""); throw new Error(`Tavily ${r.status}: ${t.slice(0, 200)}`); }
  const d = await r.json();
  return (d.results || []).map((x) => `- ${x.title}: ${x.content} (source: ${x.url})`).join("\n");
}
const searchMany = async (queries, per = 4) =>
  (await Promise.all(queries.map((q) => tavilySearch(q, per).catch(() => "")))).filter(Boolean).join("\n");

function extractObjects(text) {
  if (!text) return [];
  const out = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") { depth--; if (depth === 0 && start >= 0) { try { out.push(JSON.parse(text.slice(start, i + 1))); } catch (e) {} start = -1; } }
  }
  return out;
}
const firstObject = (t) => extractObjects(t)[0] || null;

/* ---------- AI ROUTES (now auth-gated + persist where useful) ---------- */
app.post("/api/parse", requireAuth, wrap(async (req, res) => {
  const { cv = "", prefs = {} } = req.body;
  const txt = await callGemini(
    `Parse this candidate into a JSON profile. Output ONLY one JSON object.\n\n` +
    `CV / BACKGROUND:\n${cv}\n\nPREFERENCES:\n` +
    `target_roles: ${prefs.roles || ""}\nlocations: ${prefs.locations || ""}\nwork_mode: ${prefs.mode || ""}\n` +
    `salary_target: ${prefs.salary || ""}\nseniority: ${prefs.seniority || ""}\nindustries: ${prefs.industries || ""}\n` +
    `must_haves: ${prefs.must || ""}\navoid_companies: ${prefs.avoid || ""}\nnotes: ${prefs.notes || ""}\n\n` +
    `Keys: candidate_title, headline, years_experience, seniority, locations (array), work_mode, ` +
    `salary_target, skills (array, max 14), industries (array), preferred_roles (array), ` +
    `strengths (array of 3 short), deal_breakers (array), summary (1 sentence).`,
    { system: "You are a precise CV parsing engine. Reply with strict JSON only." }
  );
  const profile = firstObject(txt);
  if (!profile) throw new Error("Could not parse a profile from that input.");
  // persist
  const existing = db.prepare("SELECT user_id FROM profiles WHERE user_id=?").get(req.userId);
  const now = new Date().toISOString();
  if (existing) db.prepare("UPDATE profiles SET profile_json=?, prefs_json=?, cv=COALESCE(NULLIF(cv,''),?), updated_at=? WHERE user_id=?").run(JSON.stringify(profile), JSON.stringify(prefs), cv, now, req.userId);
  else db.prepare("INSERT INTO profiles (user_id, profile_json, prefs_json, cv, updated_at) VALUES (?,?,?,?,?)").run(req.userId, JSON.stringify(profile), JSON.stringify(prefs), cv, now);
  res.json({ profile });
}));

app.post("/api/jobs", requireAuth, wrap(async (req, res) => {
  const { profile = {} } = req.body;
  const roles = (profile.preferred_roles || [profile.candidate_title]).filter(Boolean).slice(0, 2).join(" OR ");
  const loc = (profile.locations || []).slice(0, 2).join(" ");
  const inds = (profile.industries || []).slice(0, 2).join(" ");
  const results = await searchMany([
    `${roles} jobs hiring ${loc} ${inds} 2026`,
    `${roles} careers openings ${inds} apply`,
  ], 6);
  const txt = await callGemini(
    `From these REAL web search results, extract current job openings that fit the candidate. ` +
    `Output ONLY a JSON array (max 8).\n\nCANDIDATE: ${JSON.stringify({
      title: profile.candidate_title, roles: profile.preferred_roles, skills: profile.skills,
      locations: profile.locations, mode: profile.work_mode, seniority: profile.seniority,
    })}\n\nWEB RESULTS:\n${results}\n\n` +
    `Each object: {"company","role","location","work_mode","salary","source",` +
    `"apply_query" (google query to reach the posting),"posted","match_score" (0-100),` +
    `"reason" (<=16 words),"breakdown":{"skills":0-100,"title":0-100,"location":0-100,"seniority":0-100},` +
    `"signals" (<=8 words)}. Only real companies present in the results. JSON array only.`,
    { system: "You extract structured jobs from web results. Reply with a strict JSON array only." }
  );
  const jobs = extractObjects(txt).filter((j) => j.company && j.role)
    .map((j) => ({ ...j, match_score: Math.round(j.match_score || 0) }))
    .sort((a, b) => b.match_score - a.match_score);
  res.json({ jobs });
}));

app.post("/api/people", requireAuth, wrap(async (req, res) => {
  const { company, role } = req.body;
  const results = await searchMany([
    `${company} recruiter OR "talent acquisition" OR "head of talent" LinkedIn`,
    `${company} hiring manager OR "VP" OR "head of" ${role}`,
  ], 5);
  const txt = await callGemini(
    `From these REAL web search results, identify likely hiring decision-makers at "${company}" for "${role}". ` +
    `Recruiters, talent acquisition, hiring managers, dept heads, or founder/CEO for startups. ` +
    `Public info only. Do NOT invent emails. Output ONLY a JSON array (max 5).\n\nWEB RESULTS:\n${results}\n\n` +
    `Each object: {"name","title","company","relevance" (0-100),"why" (<=12 words),` +
    `"outreach_type" (recruiter|hiring_manager|founder|referral),"linkedin_query"}. JSON array only.`,
    { system: "You extract real people from web results. Reply with a strict JSON array only." }
  );
  const people = extractObjects(txt).filter((p) => p.name);
  res.json({ people });
}));

app.post("/api/outreach", requireAuth, wrap(async (req, res) => {
  const { profile = {}, person = {}, role = "", signal = "", lang = "en" } = req.body;
  const signalLine = signal ? `TIMELY SIGNAL (reference this naturally — it's why you're reaching out now): ${signal}\n` : "";
  const txt = await callGemini(
    `Write a concise, personalized outreach message. Output ONLY JSON: {"subject","body"}.\n\n` +
    `FROM: ${profile.candidate_title}. Strengths: ${(profile.strengths || []).join("; ")}. ` +
    `Skills: ${(profile.skills || []).slice(0, 6).join(", ")}.\n` +
    `TO: ${person.name}, ${person.title} at ${person.company} (outreach type: ${person.outreach_type}).\n` +
    `ROLE: ${role || person.jobRole}.\n` + signalLine + `\n` +
    `Body 70-100 words. ${signal ? "Open by referencing the signal so it feels timely. " : ""}` +
    `One specific reason their team/role fits this candidate. Warm, direct, respectful, no buzzwords, ` +
    `one clear ask, sign off with [Your name]. Subject under 8 words.`,
    { system: "You write sharp, human recruiter-outreach. Reply with strict JSON only.", lang }
  );
  res.json({ draft: firstObject(txt) || { subject: "", body: "" } });
}));

/* ---------- NEW: Fit Lab — résumé↔JD gap + tailored bullets + proof-of-work hook ---------- */
app.post("/api/fitlab", requireAuth, wrap(async (req, res) => {
  const { job = {}, profile = {}, lang = "en" } = req.body;
  const row = db.prepare("SELECT resume_text, cv FROM profiles WHERE user_id=?").get(req.userId);
  const resume = (row?.resume_text || row?.cv || "").slice(0, 8000);
  if (!resume) throw new Error("Upload or paste your résumé first so Fit Lab has something to work with.");
  const txt = await callGemini(
    `You are a senior career strategist. Compare this candidate's résumé to a specific role and produce an action plan. Output ONLY one JSON object.\n\n` +
    `ROLE: ${JSON.stringify({ company: job.company, role: job.role, signals: job.signals, reason: job.reason })}\n\n` +
    `RÉSUMÉ:\n${resume}\n\n` +
    `Object keys:\n` +
    `"fit_score" (0-100, honest),\n` +
    `"have" (array of 3-5 strengths that already match this role),\n` +
    `"gaps" (array of 2-4 missing/weak keywords or skills the posting likely wants),\n` +
    `"tailored_bullets" (array of 3 rewritten résumé bullets, each <=22 words, quantified, tuned to THIS role using only facts implied by the résumé — do NOT fabricate metrics),\n` +
    `"proof_of_work" (a 2-3 sentence concrete idea/observation the candidate could offer this specific company given its current signals — the hook that earns a reply),\n` +
    `"cover_note" (a 90-120 word cover paragraph),\n` +
    `"keywords_to_add" (array of ATS keywords).`,
    { system: "You are a precise, honest career strategist. Never invent numbers. Reply with strict JSON only.", lang }
  );
  const plan = firstObject(txt);
  if (!plan) throw new Error("Couldn't build a plan — try again.");
  res.json({ plan });
}));

/* ---------- pre-posting hiring-signal engine (unchanged) ---------- */
function signalQuery(kind, focus) {
  const i = focus.industries || focus.roles;
  const heads = {
    funding: `recent funding round seed OR "Series A" OR "Series B" 2026 ${i} startup raised million`,
    leadership: `new CTO OR "VP Engineering" OR "Head of Product" hired OR appointed 2026 ${i}`,
    expansion: `company expanding OR "new office" OR "scaling team" OR "hiring spree" 2026 ${i}`,
  };
  return heads[kind];
}
async function signalScan(kind, focus) {
  const results = await tavilySearch(signalQuery(kind, focus), 5).catch(() => "");
  if (!results) return [];
  const txt = await callGemini(
    `From these REAL web search results, extract fresh hiring signals of type "${kind}" relevant to a candidate ` +
    `targeting ${focus.roles} in ${focus.industries}. ${kind === "funding" ? "New funding implies new hiring." : kind === "leadership" ? "New leaders build teams; departures create backfills." : "Expansion implies hiring."} ` +
    `Output ONLY a JSON array (max 4).\n\nWEB RESULTS:\n${results}\n\n` +
    `Each object: {"company","signal_type":"${kind}","evidence" (<=18 words),"source","date",` +
    `"inferred_roles" (array 1-3),"why_now" (<=12 words),"window" (e.g. "2-4 weeks"),` +
    `"confidence" (0-100),"recency" (0-100),"fit" (0-100)}. Real companies only. JSON array only.`,
    { system: "You are a hiring-signal detection agent. Reply with a strict JSON array only." }
  );
  return extractObjects(txt).filter((s) => s.company).map((s) => ({ ...s, signal_type: s.signal_type || kind }));
}

app.post("/api/signals", requireAuth, wrap(async (req, res) => {
  const { profile = {} } = req.body;
  const focus = {
    roles: [].concat(profile.preferred_roles || [], profile.candidate_title || []).filter(Boolean).join(", "),
    industries: (profile.industries || []).join(", ") || (profile.candidate_title || ""),
  };
  const kinds = ["funding", "leadership", "expansion"];
  const results = await Promise.all(kinds.map((k) => signalScan(k, focus).catch(() => [])));
  const map = new Map();
  for (const arr of results) {
    for (const s of arr) {
      const key = String(s.company).toLowerCase().trim();
      if (!key) continue;
      const item = { type: s.signal_type, evidence: s.evidence, source: s.source, date: s.date };
      if (!map.has(key)) {
        map.set(key, {
          company: s.company, signals: [item], inferred_roles: s.inferred_roles || [],
          why_now: s.why_now || "", window: s.window || "",
          confidence: s.confidence || 0, recency: s.recency || 0, fit: s.fit || 0,
        });
      } else {
        const e = map.get(key);
        e.signals.push(item);
        e.confidence = Math.max(e.confidence, s.confidence || 0);
        e.recency = Math.max(e.recency, s.recency || 0);
        e.fit = Math.max(e.fit, s.fit || 0);
        e.inferred_roles = [...new Set([...(e.inferred_roles || []), ...(s.inferred_roles || [])])].slice(0, 4);
        if (!e.why_now && s.why_now) e.why_now = s.why_now;
        if (!e.window && s.window) e.window = s.window;
      }
    }
  }
  const signals = [...map.values()].map((s) => {
    const multi = s.signals.length > 1 ? 6 : 0;
    const score = Math.min(100, Math.round(0.4 * s.confidence + 0.3 * s.recency + 0.3 * s.fit) + multi);
    return { ...s, score };
  }).sort((a, b) => b.score - a.score);
  res.json({ signals });
}));

app.get("/api/health", (req, res) => res.json({ ok: true, model: MODEL, hasKey: !!GEMINI_KEY, hasSearch: !!TAVILY_KEY, email: transporter ? "smtp" : "dev-console" }));

/* SPA fallback */
app.get("*", (req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

app.listen(PORT, () => {
  console.log(`\n  CMD//SIGNAL  →  http://localhost:${PORT}`);
  console.log(`  model:  ${MODEL} (Google Gemini)`);
  console.log(`  gemini: ${GEMINI_KEY ? "loaded ✓" : "MISSING ✗  → add GEMINI_API_KEY to .env"}`);
  console.log(`  tavily: ${TAVILY_KEY ? "loaded ✓" : "MISSING ✗  → add TAVILY_API_KEY to .env"}`);
  console.log(`  email:  ${transporter ? "SMTP ✓" : "dev mode (OTP prints to this console)"}`);
  console.log(`  db:     ${path.join("data", "cmdsignal.db")}\n`);
});
