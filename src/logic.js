// Règles métier pures (sans Cloudflare) : testées par `node --test`.

export const LIMITS = {
  items: 30,
  itemText: 200,
  itemLink: 500,
  itemNote: 80,
  itemWhere: 300,
  intro: 600,
  ps: 600,
  signature: 60,
};

export const PEOPLE = ["a", "b"];

export function other(person) {
  return person === "a" ? "b" : "a";
}

// Compare deux chaînes en temps constant (longueur exceptée).
export function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Retrouve la personne à partir de son jeton secret. Jeton trop court ou absent : personne.
export function personFromToken(env, token) {
  if (typeof token !== "string" || token.length < 16) return null;
  for (const p of PEOPLE) {
    const expected = env[`PERSON_${p.toUpperCase()}_TOKEN`];
    if (typeof expected === "string" && expected.length >= 16 && safeEqual(token, expected)) return p;
  }
  return null;
}

export function profile(env, person) {
  const P = person.toUpperCase();
  return {
    name: (env[`PERSON_${P}_NAME`] || (person === "a" ? "Personne A" : "Personne B")).trim(),
    email: (env[`PERSON_${P}_EMAIL`] || "").trim(),
    token: env[`PERSON_${P}_TOKEN`] || "",
  };
}

export function revealTime(env) {
  const t = Date.parse(env.REVEAL_AT || "2026-11-20T00:00:00+01:00");
  if (Number.isNaN(t)) throw new Error("REVEAL_AT invalide");
  return t;
}

export function isRevealed(env, now = Date.now()) {
  return now >= revealTime(env);
}

function cleanText(value, max, { multiline = false } = {}) {
  if (value == null) return "";
  if (typeof value !== "string") throw new LetterError("Texte attendu.");
  let s = value.replace(/\r\n?/g, "\n");
  // Retire les caractères de contrôle (sauf saut de ligne si multiligne).
  s = s.replace(multiline ? /[\u0000-\u0009\u000B-\u001F\u007F]/g : /[\u0000-\u001F\u007F]/g, "");
  s = s.trim();
  if (s.length > max) throw new LetterError(`Texte trop long (${max} caractères au plus).`);
  return s;
}

export function cleanLink(value) {
  const s = cleanText(value, LIMITS.itemLink);
  if (!s) return "";
  let url;
  try {
    url = new URL(s);
  } catch {
    throw new LetterError("Lien invalide : il doit commencer par https://");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new LetterError("Lien invalide : il doit commencer par https://");
  }
  return url.href;
}

export class LetterError extends Error {}

// Normalise une lettre reçue du navigateur. Lève LetterError si elle est invalide.
export function cleanLetter(input) {
  if (!input || typeof input !== "object") throw new LetterError("Lettre manquante.");
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (rawItems.length > LIMITS.items) throw new LetterError(`${LIMITS.items} souhaits au plus.`);
  const items = [];
  for (const it of rawItems) {
    if (!it || typeof it !== "object") continue;
    const text = cleanText(it.text, LIMITS.itemText);
    const link = cleanLink(it.link);
    const note = cleanText(it.note, LIMITS.itemNote);
    // « Où le trouver » : absent des lettres écrites avant son ajout, donc facultatif.
    const where = cleanText(it.where, LIMITS.itemWhere, { multiline: true });
    if (!text && !link && !note && !where) continue;
    if (!text) throw new LetterError("Chaque souhait a besoin d'un texte.");
    items.push({ text, link, note, where });
  }
  return {
    intro: cleanText(input.intro, LIMITS.intro, { multiline: true }),
    items,
    ps: cleanText(input.ps, LIMITS.ps, { multiline: true }),
    signature: cleanText(input.signature, LIMITS.signature),
  };
}

// Une lettre ne part que si elle contient au moins un souhait.
export function assertSendable(letter) {
  if (!letter.items.length) throw new LetterError("Ajoute au moins un souhait avant d'envoyer.");
}

export function emptyLetter(name) {
  return {
    intro: "Cette année j'ai été plutôt sage. Voici ce qui me ferait plaisir :",
    items: [],
    ps: "",
    signature: `Bisous, ${name}`,
  };
}

const DATE_FR = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Paris",
});

// Contenu du mail qui prévient le destinataire qu'une lettre l'attend.
export function notificationMail({ env, from, to, now = Date.now() }) {
  const link = `${(env.PUBLIC_URL || "").replace(/\/$/, "")}/#t=${encodeURIComponent(to.token)}`;
  const opened = isRevealed(env, now);
  const day = DATE_FR.format(new Date(revealTime(env)));
  const subject = `${from.name} t'a écrit une lettre au Père Noël`;
  const when = opened
    ? "Les lettres sont déjà ouvertes : tu peux la lire tout de suite."
    : `Elle reste scellée jusqu'au ${day}. Ce jour-là, tu pourras l'ouvrir.`;
  const text = [
    `Bonjour ${to.name},`,
    "",
    `${from.name} vient d'envoyer sa lettre au Père Noël, et elle est arrivée dans ta boîte aux lettres.`,
    when,
    "",
    "Ta boîte aux lettres (lien personnel, ne le partage pas) :",
    link,
    "",
    "Le Pôle Nord",
  ].join("\n");
  const html = `<!doctype html><html lang="fr"><body style="margin:0;background:#10203a;padding:32px 16px;font-family:Georgia,serif">
<div style="max-width:520px;margin:0 auto;background:#f6efe2;color:#1d2b4f;border-radius:6px;padding:32px">
<p style="margin:0 0 16px;font-size:18px">Bonjour ${escapeHtml(to.name)},</p>
<p style="margin:0 0 12px;font-size:16px;line-height:1.5">${escapeHtml(from.name)} vient d'envoyer sa lettre au Père Noël, et elle est arrivée dans ta boîte aux lettres.</p>
<p style="margin:0 0 24px;font-size:16px;line-height:1.5">${escapeHtml(when)}</p>
<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#a8232b;color:#fff8ee;text-decoration:none;font-family:Arial,sans-serif;font-weight:bold;padding:12px 22px;border-radius:999px">Ouvrir ma boîte aux lettres</a></p>
<p style="margin:0;font-size:13px;color:#4a5878;font-family:Arial,sans-serif">Ce lien est personnel : ne le partage pas.</p>
</div></body></html>`;
  return { subject, text, html };
}

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
