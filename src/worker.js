// Worker : sert public/ et l'API des lettres. Un seul Durable Object garde les deux lettres.
import { DurableObject } from "cloudflare:workers";
import { connect } from "cloudflare:sockets";
import {
  LetterError,
  assertSendable,
  cleanLetter,
  emptyLetter,
  isRevealed,
  other,
  personFromToken,
  profile,
  revealTime,
} from "./logic.js";
import { notify } from "./mail.js";

export class LettersStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS letters (
      person TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      sent_at TEXT,
      mail_status TEXT,
      mail_error TEXT
    )`);
  }

  row(person) {
    return this.sql.exec("SELECT * FROM letters WHERE person = ?", person).toArray()[0] || null;
  }

  get(person) {
    const r = this.row(person);
    if (!r) return null;
    return { letter: JSON.parse(r.body), updatedAt: r.updated_at, sentAt: r.sent_at, mailStatus: r.mail_status };
  }

  // Enregistre un brouillon. Refusé une fois la lettre envoyée.
  saveDraft(person, letter) {
    const r = this.row(person);
    if (r?.sent_at) return { error: "sealed" };
    const now = new Date().toISOString();
    this.sql.exec(
      "INSERT INTO letters (person, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(person) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at",
      person,
      JSON.stringify(letter),
      now,
    );
    return { updatedAt: now };
  }

  // Scelle la lettre. Deux envois concurrents : un seul gagne (le DO sérialise les appels).
  seal(person, letter) {
    const r = this.row(person);
    if (r?.sent_at) return { error: "sealed", sentAt: r.sent_at };
    const now = new Date().toISOString();
    this.sql.exec(
      "INSERT INTO letters (person, body, updated_at, sent_at) VALUES (?, ?, ?, ?) ON CONFLICT(person) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at, sent_at = excluded.sent_at",
      person,
      JSON.stringify(letter),
      now,
      now,
    );
    return { sentAt: now };
  }

  markMail(person, status, error) {
    this.sql.exec("UPDATE letters SET mail_status = ?, mail_error = ? WHERE person = ?", status, error || null, person);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-robots-tag": "noindex, nofollow",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

function store(env) {
  return env.LETTERS.get(env.LETTERS.idFromName("lettres"));
}

function tokenOf(request) {
  const h = request.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7).trim() : "";
}

async function readJson(request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 64 * 1024) throw new LetterError("Lettre trop longue.");
  try {
    return await request.json();
  } catch {
    throw new LetterError("Requête illisible.");
  }
}

async function api(request, env, url) {
  const me = personFromToken(env, tokenOf(request));
  if (!me) return json({ error: "Lien inconnu. Utilise le lien personnel reçu." }, 401);
  const you = other(me);
  const db = store(env);
  const meP = profile(env, me);
  const youP = profile(env, you);

  if (url.pathname === "/api/state" && request.method === "GET") {
    const mine = await db.get(me);
    const theirs = await db.get(you);
    const revealed = isRevealed(env);
    return json({
      now: new Date().toISOString(),
      revealAt: new Date(revealTime(env)).toISOString(),
      revealed,
      me: { name: meP.name },
      partner: { name: youP.name },
      mine: mine
        ? { letter: mine.letter, sentAt: mine.sentAt, updatedAt: mine.updatedAt }
        : { letter: emptyLetter(meP.name), sentAt: null, updatedAt: null },
      theirs: {
        sentAt: theirs?.sentAt || null,
        // Le contenu de l'autre lettre ne quitte le serveur qu'après l'ouverture.
        letter: revealed && theirs?.sentAt ? theirs.letter : null,
      },
    });
  }

  if (url.pathname === "/api/letter" && request.method === "PUT") {
    const letter = cleanLetter(await readJson(request));
    const r = await db.saveDraft(me, letter);
    if (r.error) return json({ error: "Ta lettre est déjà envoyée et scellée." }, 409);
    return json(r);
  }

  if (url.pathname === "/api/send" && request.method === "POST") {
    const letter = cleanLetter(await readJson(request));
    assertSendable(letter);
    const r = await db.seal(me, letter);
    if (r.error) return json({ error: "Ta lettre est déjà envoyée et scellée.", sentAt: r.sentAt }, 409);
    const mail = await notify(env, { from: meP, to: youP }, { connect, fetch: (...args) => fetch(...args) });
    await db.markMail(me, mail.status, mail.error);
    if (mail.error) console.error(`[mail] échec : ${mail.error}`);
    return json({ sentAt: r.sentAt, mail: mail.status });
  }

  return json({ error: "Introuvable." }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(request, env, url);
      } catch (e) {
        if (e instanceof LetterError) return json({ error: e.message }, 400);
        console.error(e);
        return json({ error: "Erreur du Pôle Nord. Réessaie dans un instant." }, 500);
      }
    }
    const res = await env.ASSETS.fetch(request);
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) out.headers.set(k, v);
    return out;
  },
};
