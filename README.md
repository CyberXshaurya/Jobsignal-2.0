# CMD//SIGNAL — v2

AI job-search command center. Detects companies about to hire (funding / leadership / expansion signals), ranks live openings against your profile, finds the humans who can hire you, and drafts timely outreach.

**v2 adds the foundation the original was missing:** per-user accounts, email-OTP sign-in, persistent profiles, résumé upload, and a new per-job tailoring feature called **Fit Lab**. Stack stays free: Node/Express + Google Gemini + Tavily. No paid APIs.

This is **Stage 1** of a planned, honest rebuild. What's done and what's next is at the bottom.

---

## Quick start

```bash
npm install
cp .env.example .env       # then edit .env (see below)
npm run dev                # http://localhost:3000
```

You need two free keys in `.env`:

- `GEMINI_API_KEY` — from Google AI Studio (no card).
- `TAVILY_API_KEY` — from tavily.com (free tier, no card). Powers live web search.

That's enough to run the whole app locally. Email is optional in dev (see next section).

> Note: `better-sqlite3` is a native module and compiles on install. On a clean machine that usually just works; if it fails, you need build tools (`build-essential` / Xcode CLT / windows-build-tools).

---

## How sign-in works (and how to test OTP without email)

Flow: **sign up → a 6-digit code is sent → enter code → you're in.** A JWT is stored in an httpOnly cookie for 7 days.

In development you **don't need a mail server**. With no SMTP configured the OTP is:

1. printed to the **server console**, and
2. (because `OTP_DEV_ECHO=true` in `.env.example`) returned in the API response so the UI can show it.

So locally you can register and log in immediately. **Turn `OTP_DEV_ECHO` off in production** — otherwise codes are exposed to clients.

### Sending real OTP emails

Fill the `SMTP_*` block in `.env`. Easiest free routes:

- **Gmail** → create an *App Password* (Google Account → Security → 2-Step Verification → App passwords). Then `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_USER=you@gmail.com`, `SMTP_PASS=<the app password>`.
- **Brevo / Resend / Mailtrap** — free SMTP tiers, give you host/port/user/pass to paste in.

Once SMTP is set, codes go to the user's inbox and the dev echo is ignored in production.

---

## "Site deploy ho gayi — GitHub par change karunga to site update hogi?"

Short answer: **depends entirely on your host, and your app has a backend, so a few things matter.**

**1. This app cannot run on a pure static host.** GitHub Pages / Netlify-static / Cloudflare Pages only serve files — they can't run `server.js`. Without the Node server, every AI feature (signals, jobs, outreach, auth) is dead. So the app must run on a **Node host**: Render, Railway, Fly.io, Cyclic, or a VPS. (Your original `package.json` had only `express` + `dotenv`; v2 adds real deps, so a plain static deploy was never going to work for the AI parts anyway.)

**2. Will a GitHub push auto-update the live site?**
- **Yes, automatically** — if you deploy via a host with Git integration (Render, Railway, Vercel, Netlify with CI). You connect the repo once; every push to the tracked branch triggers a rebuild + redeploy. Add/delete/change in the repo → site updates on its own in a minute or two.
- **No, manual** — if you run on a bare VPS (you SSH in, `git pull`, restart the process yourself), or if you deploy by manual upload. Pushing to GitHub alone changes nothing until you redeploy.

**3. Two things that bite people on first deploy:**
- **Env vars** live in the host's dashboard, **not** in your repo (`.env` is gitignored, as it should be). Set `GEMINI_API_KEY`, `TAVILY_API_KEY`, `JWT_SECRET`, `NODE_ENV=production`, and SMTP there. Forget these and the app boots but every action 502s.
- **The SQLite file is ephemeral on most free tiers.** `data/app.db` lives on the container's disk, which is wiped on each redeploy/restart on free Render/Railway/Fly. Translation: **users and profiles can vanish on deploy.** Fine for a demo; not for real users. Upgrade path is in the roadmap (swap SQLite → Postgres/Neon, both have free tiers).

If you tell me which host you're leaning toward, I'll give you the exact deploy steps + a one-file config for it.

---

## Security notes (what's already handled)

- Passwords hashed with bcrypt; never stored or logged in plaintext.
- JWT in an **httpOnly, SameSite** cookie (secure flag on in production) — not readable by JS, mitigates XSS token theft.
- OTP: 6 digits, 10-min expiry, max 5 attempts, 60-sec resend cooldown.
- Rate limiting on auth routes (brute-force / spam mitigation).
- All AI + data routes are auth-gated — no profile/signal/outreach calls without a valid session.
- `JWT_SECRET` falls back to a random per-boot value with a console warning if unset, so dev never breaks — but **set a fixed one in production** or every restart logs everyone out.

Not yet hardened (honest list): no email-domain verification beyond the OTP, no CSRF token on top of SameSite, no account lockout beyond rate limiting. Reasonable for Stage 1; called out so you can plan.

---

## The new feature — Fit Lab

Once you have live matches, the **Fit Lab** button (floating, bottom-right) opens a per-job tailoring panel. Pick a job and it returns:

- an honest **fit score** with *what you already match* vs *real gaps*,
- **tailored résumé bullets** rewritten for that job — **no invented metrics**, only your real experience reframed,
- a **proof-of-work hook**: a concrete, specific thing to build/show for *that* company given its current signal — the thing that actually earns a reply,
- a short **cover note** and the **ATS keywords** to mirror.

This is the piece that turns "I have a résumé uploaded" into "I have a sharp, targeted application per role." It's deliberately the differentiator vs every other job tool that just lists openings.

---

## Honest status — what's real now vs what's next

**Stage 1 — done (this drop):**
- Accounts + email-OTP sign-in + 7-day sessions.
- Persistent per-user profile + résumé upload (PDF / DOCX / TXT → parsed text, reused by the AI).
- All original AI features, now auth-gated and saving to your account.
- Fit Lab (new).
- Language switch (English + Hindi) on the auth screens, Fit Lab, and AI output language.

**Known Stage-1 limits (so I'm not overselling):**
- The main app's UI strings are still English; full in-app translation is Stage 2.
- Pipeline + drafts persist in-session and via the items API, but aren't yet fully wired to reload from the server on every revisit — Stage 2.
- Fit Lab is opened from a global panel, not yet a button on each job card — Stage 2.

**Roadmap — what I'd build next, in order:**
- **Stage 2 — Polish the core:** per-card Fit Lab buttons, full UI i18n (more languages), and wire pipeline/drafts to reload from `/api/items` so nothing is lost between sessions.
- **Stage 3 — Real sending:** connect the user's own Gmail via OAuth to actually send outreach (low volume, personalized, with opt-out) + scheduling. *Honest note:* mass cold-emailing strangers has legal limits (CAN-SPAM / GDPR) and hurts deliverability — so this stays low-volume and consent-aware by design, not a spam cannon.
- **Stage 4 — Monitoring:** a dashboard tracking each application/outreach (sent → opened → replied → interview) so the pipeline reflects reality.
- **Stage 5 — Apply assist (carefully):** the "auto-apply to job forms" idea. *Honest note:* unattended bots filling LinkedIn/Indeed forms violate their ToS and get user accounts banned, and break on CAPTCHAs. The safe, durable version is **one-click apply assist** — the app pre-fills what it can from your résumé and you confirm — not a hidden autopilot. That's the version worth shipping.

The reason for stages: a solid, honest foundation you can actually demo and explain in an interview beats a flashy "everything works" that falls over on the first real click. Each stage is independently shippable.
