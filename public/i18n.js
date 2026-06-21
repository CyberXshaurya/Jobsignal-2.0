/* CMD//SIGNAL — i18n (no build step). Add a language by adding a block to DICT. */
const DICT = {
  en: {
    code: "en", label: "English",
    welcome: "Catch the hire before the job posts.",
    sub: "Sign in to your command center. Detect companies about to hire, rank live openings, find the humans who can hire you, and send timely outreach.",
    email: "Email", password: "Password", code: "6-digit code",
    signin: "Sign in", signup: "Create account", verify: "Verify & continue",
    have_account: "Already have an account?", no_account: "New here?",
    sent_code: "We sent a 6-digit code to", resend: "Resend code", change_email: "Use a different email",
    signing: "Signing in…", creating: "Creating account…", verifying: "Verifying…", sending: "Sending…",
    min_pw: "Password must be at least 8 characters.",
    logout: "Log out", language: "Language",
    upload_resume: "Upload résumé (PDF / DOCX / TXT)", reading_resume: "Reading your résumé…",
    resume_loaded: "Résumé loaded — text added to the box below. Edit anything you like.",
    secured: "Signals first · sending always waits for your approval",
  },
  hi: {
    code: "hi", label: "हिन्दी",
    welcome: "Job post hone se pehle hiring pakdo.",
    sub: "Apne command center mein sign in karo. Wo companies dhoondho jo jald hire karne wali hain, live openings rank karo, hire karne wale logon ko dhoondho, aur sahi waqt par outreach bhejo.",
    email: "Email", password: "Password", code: "6-ank ka code",
    signin: "Sign in", signup: "Account banao", verify: "Verify karke aage badho",
    have_account: "Pehle se account hai?", no_account: "Naye ho?",
    sent_code: "Humne 6-ank ka code bheja hai", resend: "Code dobara bhejo", change_email: "Doosra email use karo",
    signing: "Sign in ho raha hai…", creating: "Account ban raha hai…", verifying: "Verify ho raha hai…", sending: "Bhej rahe hain…",
    min_pw: "Password kam se kam 8 characters ka hona chahiye.",
    logout: "Log out", language: "Bhasha",
    upload_resume: "Résumé upload karo (PDF / DOCX / TXT)", reading_resume: "Aapka résumé padh rahe hain…",
    resume_loaded: "Résumé load ho gaya — text neeche box mein aa gaya. Jo chaaho edit karo.",
    secured: "Pehle signals · bhejne se pehle hamesha aapki manzoori",
  },
};

const I18N = {
  lang: localStorage.getItem("cs_lang") || "en",
  list: () => Object.values(DICT).map((d) => ({ code: d.code, label: d.label })),
  set(code) { if (DICT[code]) { this.lang = code; localStorage.setItem("cs_lang", code); document.documentElement.lang = code; } },
  t(key) { return (DICT[this.lang] && DICT[this.lang][key]) || DICT.en[key] || key; },
};
document.documentElement.lang = I18N.lang;
window.I18N = I18N;
