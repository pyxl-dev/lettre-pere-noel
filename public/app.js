// Lettre au Père Noël : application côté navigateur (sans dépendance).

const TOKEN_KEY = "lpn-token";
const SVG_NS = "http://www.w3.org/2000/svg";
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const app = document.getElementById("app");
const stageEl = document.getElementById("stage");
const stageFrame = document.getElementById("stage-frame");
const stageActions = document.getElementById("stage-actions");
const toastEl = document.getElementById("toast");

let token = null;
let state = null;
let view = "write";
let clockOffset = 0;
let draft = null;
let saveTimer = null;
let saving = null;
let skip = false;

const DAY = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", timeZone: "Europe/Paris" });
const DAY_LONG = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Paris" });
const DATE_FULL = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Paris" });

// ---------- Outils DOM ----------

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function s(tag, attrs, ...kids) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) el.setAttribute(k, v);
  el.append(...kids);
  return el;
}

const icon = {
  star: () =>
    s("svg", { class: "star", width: 18, height: 18, viewBox: "0 0 18 18", "aria-hidden": "true" },
      s("path", { d: "M9 1 L11 7 L17 7 L12 11 L14 17 L9 13 L4 17 L6 11 L1 7 L7 7 Z", fill: "#c9a45c" })),
  plus: () =>
    s("svg", { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": "true" },
      s("path", { d: "M7 2 V12 M2 7 H12", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round" })),
  cross: () =>
    s("svg", { width: 14, height: 14, viewBox: "0 0 14 14", "aria-hidden": "true" },
      s("path", { d: "M3 3 L11 11 M11 3 L3 11", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round" })),
  envelope: (color) =>
    s("svg", { width: 18, height: 18, viewBox: "0 0 18 18", "aria-hidden": "true" },
      s("rect", { x: "1.5", y: "4", width: "15", height: "10", rx: "1.5", fill: "none", stroke: color, "stroke-width": "1.5" }),
      s("path", { d: "M2 5 L9 10 L16 5", fill: "none", stroke: color, "stroke-width": "1.5" })),
  send: (color) =>
    s("svg", { width: 18, height: 18, viewBox: "0 0 18 18", "aria-hidden": "true" },
      s("path", { d: "M2 9 L16 2 L12 16 L9 10 Z", fill: "none", stroke: color, "stroke-width": "1.6", "stroke-linejoin": "round" })),
  back: () =>
    s("svg", { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": "true" },
      s("path", { d: "M10 3 L5 8 L10 13", fill: "none", stroke: "currentColor", "stroke-width": "1.8", "stroke-linecap": "round" })),
};

function toast(message, ms = 4200) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => toastEl.classList.remove("show"), ms);
}

function now() {
  return Date.now() + clockOffset;
}

// ---------- API ----------

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function api(path, { method = "GET", body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError("Pas de connexion avec le Pôle Nord. Vérifie ta connexion.", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Erreur ${res.status}`, res.status);
  return data;
}

async function loadState() {
  state = await api("/api/state");
  clockOffset = Date.parse(state.now) - Date.now();
  return state;
}

// ---------- Démarrage ----------

function readToken() {
  const m = /(?:^#|&)t=([^&]+)/.exec(location.hash);
  if (m) {
    const t = decodeURIComponent(m[1]);
    try {
      localStorage.setItem(TOKEN_KEY, t);
    } catch {
      // stockage indisponible : le lien reste nécessaire à chaque visite
    }
    history.replaceState(null, "", location.pathname + location.search);
    return t;
  }
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function notice(title, text) {
  document.querySelector(".topnav").hidden = true;
  document.getElementById("pill").hidden = true;
  app.replaceChildren(h("section", { class: "notice" }, h("h1", {}, title), h("p", {}, text)));
}

async function boot() {
  token = readToken();
  if (!token) {
    notice("Cette boîte aux lettres est privée", "Ouvre le lien personnel que tu as reçu pour écrire ta lettre ou lire celle qui t'attend.");
    return;
  }
  try {
    await loadState();
  } catch (e) {
    if (e.status === 401) {
      try {
        localStorage.removeItem(TOKEN_KEY);
      } catch {
        // rien à nettoyer
      }
      notice("Lien inconnu", "Ce lien ne correspond à aucune boîte aux lettres. Utilise le lien personnel reçu par mail.");
    } else {
      notice("Le Pôle Nord ne répond pas", e.message);
    }
    return;
  }
  view = state.mine.sentAt ? "box" : "write";
  document.querySelector(".topnav").hidden = false;
  render();
  setInterval(tick, 1000);
}

document.addEventListener("click", (e) => {
  const nav = e.target.closest("[data-nav]");
  if (!nav || !state) return;
  e.preventDefault();
  const target = nav.dataset.nav;
  if (target === "home") go(state.mine.sentAt ? "box" : "write");
  else if (target === "write") go(state.mine.sentAt ? "read-mine" : "write");
  else go(target);
});

async function go(next) {
  if (view === "write" && next !== "write") await flushSave();
  view = next;
  render();
  app.focus({ preventScroll: true });
  scrollTo({ top: 0 });
}

function render() {
  document.getElementById("nav-write").textContent = state.mine.sentAt ? "Ma lettre" : "Écrire ma lettre";
  for (const a of document.querySelectorAll(".topnav a")) a.removeAttribute("aria-current");
  const current = view === "box" || view === "read-theirs" ? "nav-box" : "nav-write";
  document.getElementById(current).setAttribute("aria-current", "page");
  updatePill();
  if (view === "write") renderWrite();
  else if (view === "box") renderBox();
  else if (view === "read-mine") renderReader(state.mine.letter, "Ta lettre", state.mine.sentAt);
  else if (view === "read-theirs") renderReader(state.theirs.letter, `La lettre de ${state.partner.name}`, state.theirs.sentAt);
}

// ---------- Compte à rebours ----------

function remaining() {
  return Math.max(0, Date.parse(state.revealAt) - now());
}

function updatePill() {
  const pill = document.getElementById("pill");
  pill.hidden = false;
  const ms = remaining();
  if (ms === 0) {
    pill.replaceChildren(h("strong", {}, "Les lettres sont ouvertes"));
    return;
  }
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor(ms / 3600000);
  const left = days > 1 ? `dans ${days} jours` : days === 1 ? "dans 1 jour" : hours > 1 ? `dans ${hours} heures` : "dans moins d'une heure";
  pill.replaceChildren("Ouverture des lettres le ", h("strong", {}, DAY.format(new Date(state.revealAt))), ` · ${left}`);
}

let refreshing = false;
async function tick() {
  if (!state) return;
  updatePill();
  const cd = document.querySelector(".countdown");
  if (cd) fillCountdown(cd);
  if (!state.revealed && remaining() === 0 && !refreshing && stageEl.hidden) {
    refreshing = true;
    try {
      await loadState();
      if (view === "box") render();
    } catch {
      // nouvel essai à la prochaine seconde
    } finally {
      refreshing = false;
    }
  }
}

function fillCountdown(cd) {
  const ms = remaining();
  const parts = [Math.floor(ms / 86400000), Math.floor(ms / 3600000) % 24, Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60];
  cd.querySelectorAll("b").forEach((b, i) => {
    b.textContent = String(parts[i]).padStart(2, "0");
  });
}

// ---------- Lettre en lecture ----------

function letterDate(sentAt) {
  return `Pôle Nord, le ${DATE_FULL.format(sentAt ? new Date(sentAt) : new Date(now()))}`;
}

function paperView(letter, { date, links = true, extraClass = "" } = {}) {
  const items = h("ol", { class: "items" },
    letter.items.map((it) =>
      h("li", { class: "item" },
        icon.star(),
        h("span", { class: "text" }, it.text),
        it.note || it.link
          ? h("span", { class: "meta" },
              it.note ? h("span", { class: "chip" }, it.note) : null,
              it.link
                ? links
                  ? h("a", { class: "chip", href: safeHref(it.link), target: "_blank", rel: "noopener noreferrer" }, "voir le lien")
                  : h("span", { class: "chip" }, "lien")
                : null)
          : null)));
  return h("article", { class: `paper read ${extraClass}` },
    h("p", { class: "date" }, date),
    h("p", { class: "dear" }, "Cher Père Noël,"),
    letter.intro ? h("p", { class: "line hand" }, letter.intro) : null,
    items,
    letter.ps ? h("p", { class: "line hand" }, letter.ps) : null,
    h("p", { class: "signature" }, letter.signature));
}

function safeHref(link) {
  try {
    const u = new URL(link);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : "#";
  } catch {
    return "#";
  }
}

function renderReader(letter, title, sentAt) {
  app.replaceChildren(
    h("section", { class: "reader" },
      h("div", { class: "reader-head" },
        h("a", { class: "back", href: "#", "data-nav": "box" }, icon.back(), "Boîte aux lettres"),
        h("h1", {}, title)),
      paperView(letter, { date: letterDate(sentAt) })));
}

// ---------- Écrire ----------

function autosize(el) {
  // Hauteur arrondie à un nombre entier de lignes pour rester calé sur le papier ligné.
  const lh = parseFloat(getComputedStyle(el).lineHeight) || 38;
  el.style.height = "auto";
  el.style.height = `${Math.max(1, Math.round(el.scrollHeight / lh)) * lh}px`;
}

function renderWrite() {
  draft = structuredClone(state.mine.letter);
  if (!draft.items.length) draft.items.push({ text: "", link: "", note: "" });

  const status = h("span", { class: "save-status", role: "status" }, state.mine.updatedAt ? "Brouillon enregistré" : "");
  const list = h("ol", { class: "items" });

  const intro = h("textarea", { class: "hand ruled", rows: 1, "aria-label": "Début de la lettre", maxlength: 600, placeholder: "Cette année j'ai été plutôt sage…" });
  intro.value = draft.intro;
  intro.addEventListener("input", () => {
    draft.intro = intro.value;
    autosize(intro);
    scheduleSave(status);
  });

  const ps = h("textarea", { class: "hand ruled", rows: 1, "aria-label": "Post-scriptum", maxlength: 600, placeholder: "P.S. …" });
  ps.value = draft.ps;
  ps.addEventListener("input", () => {
    draft.ps = ps.value;
    autosize(ps);
    scheduleSave(status);
  });

  const signature = h("input", { class: "signature", type: "text", "aria-label": "Signature", maxlength: 60, autocomplete: "off" });
  signature.value = draft.signature;
  signature.addEventListener("input", () => {
    draft.signature = signature.value;
    scheduleSave(status);
  });

  const renderItems = (focusIndex) => {
    list.replaceChildren(...draft.items.map((it, i) => itemRow(it, i, status, renderItems)));
    list.querySelectorAll("textarea.text").forEach(autosize);
    if (focusIndex != null) list.querySelectorAll(".text")[focusIndex]?.focus();
  };
  renderItems();

  const add = h("button", {
    type: "button",
    class: "btn-add",
    onclick: () => {
      if (draft.items.length >= 30) return toast("30 souhaits au plus. Le traîneau a ses limites.");
      draft.items.push({ text: "", link: "", note: "" });
      renderItems(draft.items.length - 1);
    },
  }, icon.plus(), "Ajouter un souhait");

  const foldBtn = h("button", { type: "button", class: "btn btn-wax", onclick: () => foldAndSend(foldBtn, status) },
    icon.envelope("#fff8ee"), "Plier et mettre sous enveloppe");

  const paper = h("section", { class: "paper", "aria-label": "Ta lettre au Père Noël" },
    h("p", { class: "date" }, letterDate(null)),
    h("h1", {}, "Cher Père Noël,"),
    intro,
    list,
    h("div", { class: "add-row" }, add),
    ps,
    signature,
    h("div", { class: "paper-foot" }, status, foldBtn));

  const partner = state.partner.name;
  const theirs = state.theirs.sentAt
    ? [h("p", { class: "status" }, "Envoyée, scellée"), h("p", {}, `S'ouvre le ${DAY.format(new Date(state.revealAt))}`)]
    : [h("p", { class: "status" }, "Pas encore envoyée"), h("p", {}, "Tu recevras un mail quand elle arrivera.")];
  const side = h("aside", { class: "side" },
    h("div", { class: "card" },
      h("h2", {}, `La lettre de ${partner}`),
      h("div", { class: "mini" }, h("div", { class: "mini-env" }, envSmall({ empty: !state.theirs.sentAt })), h("div", {}, theirs))),
    h("div", { class: "card" },
      h("h2", {}, "Comment ça marche"),
      h("ol", {},
        h("li", {}, "Tu écris tes souhaits."),
        h("li", {}, "La lettre se plie et file dans l'enveloppe."),
        h("li", {}, `${partner} reçoit un mail : une lettre l'attend.`),
        h("li", {}, `Le ${DAY.format(new Date(state.revealAt))}, chacun ouvre celle de l'autre.`))));

  app.replaceChildren(h("section", { class: "write" }, paper, side));
  autosize(intro);
  autosize(ps);
}

function itemRow(it, i, status, rerender) {
  const text = h("textarea", { class: "text", rows: 1, maxlength: 200, placeholder: "Un souhait…", "aria-label": `Souhait ${i + 1}`, autocomplete: "off" });
  text.value = it.text;
  text.addEventListener("input", () => {
    it.text = text.value.replace(/\n/g, " ");
    autosize(text);
    scheduleSave(status);
  });
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (draft.items.length >= 30) return;
      draft.items.splice(i + 1, 0, { text: "", link: "", note: "" });
      rerender(i + 1);
    }
  });
  const link = h("input", { class: "link", type: "url", maxlength: 500, placeholder: "lien (facultatif)", "aria-label": `Lien du souhait ${i + 1}`, autocomplete: "off" });
  link.value = it.link;
  link.addEventListener("input", () => {
    it.link = link.value;
    scheduleSave(status);
  });
  const note = h("input", { class: "note", type: "text", maxlength: 40, placeholder: "prix, taille…", "aria-label": `Précision du souhait ${i + 1}`, autocomplete: "off" });
  note.value = it.note;
  note.addEventListener("input", () => {
    it.note = note.value;
    scheduleSave(status);
  });
  const remove = h("button", {
    type: "button",
    class: "icon-btn",
    "aria-label": `Retirer le souhait ${i + 1}`,
    onclick: () => {
      draft.items.splice(i, 1);
      if (!draft.items.length) draft.items.push({ text: "", link: "", note: "" });
      rerender(Math.min(i, draft.items.length - 1));
      scheduleSave(status);
    },
  }, icon.cross());
  return h("li", { class: "item" }, icon.star(), text, h("span", { class: "meta" }, link, note, remove));
}

function payload() {
  return {
    intro: draft.intro,
    ps: draft.ps,
    signature: draft.signature,
    items: draft.items.filter((it) => it.text.trim() || it.link.trim() || it.note.trim()),
  };
}

function scheduleSave(status) {
  status.classList.remove("error");
  status.textContent = "Enregistrement…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => save(status), 700);
}

// Les sauvegardes passent l'une après l'autre : un vieux brouillon n'écrase jamais un plus récent.
async function save(status) {
  saveTimer = null;
  const previous = saving || Promise.resolve();
  const run = previous.then(async () => {
    const body = payload();
    try {
      const r = await api("/api/letter", { method: "PUT", body });
      state.mine.letter = body;
      state.mine.updatedAt = r.updatedAt;
      if (status) {
        status.classList.remove("error");
        status.textContent = "Brouillon enregistré";
      }
      return true;
    } catch (e) {
      if (status) {
        status.classList.add("error");
        status.textContent = e.message;
      }
      if (e.status === 409) {
        try {
          await loadState();
          view = "box";
          render();
        } catch {
          // l'erreur est déjà affichée
        }
      }
      return false;
    }
  });
  saving = run;
  return run;
}

async function flushSave(status) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    return save(status);
  }
  if (saving) return saving;
  return true;
}

// ---------- Animations ----------

const speed = (ms) => (skip || reduceMotion ? 1 : ms);

function anim(el, frames, ms, easing = "ease-in-out") {
  return el.animate(frames, { duration: speed(ms), easing, fill: "forwards" }).finished;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, speed(ms)));
}

function pocketLines() {
  return s("svg", { viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": "true" },
    s("path", { d: "M0 100 L41 52 M100 100 L59 52", stroke: "#c7b897", "stroke-width": "1.5", fill: "none", "vector-effect": "non-scaling-stroke" }));
}

// Petite enveloppe fermée (boîte aux lettres, encart).
function envSmall({ label = "", empty = false } = {}) {
  return h("div", { class: `env${empty ? " empty" : ""}`, "aria-hidden": "true" },
    h("div", { class: "env-back" }),
    h("div", { class: "env-pocket" }, pocketLines()),
    h("div", { class: "env-flap" }),
    h("div", { class: "env-seal" }),
    label ? h("div", { class: "env-label" }, label) : null);
}

function openStage() {
  skip = false;
  stageActions.replaceChildren();
  stageEl.hidden = false;
  document.body.style.overflow = "hidden";
  return anim(stageEl, [{ opacity: 0 }, { opacity: 1 }], 300);
}

function closeStage() {
  stageEl.hidden = true;
  stageFrame.replaceChildren();
  stageActions.replaceChildren();
  document.body.style.overflow = "";
  for (const a of stageEl.getAnimations()) a.cancel();
}

document.getElementById("stage-skip").addEventListener("click", () => {
  skip = true;
  for (const a of stageEl.getAnimations({ subtree: true })) a.finish();
});

// Construit la scène : lettre découpée en trois volets + enveloppe en deux couches.
function buildScene({ letter, date, label }) {
  const k = Math.min(1, (innerWidth - 32) / 600, (innerHeight - 190) / 800);
  stageFrame.style.width = `${600 * k}px`;
  stageFrame.style.height = `${800 * k}px`;
  const scene = h("div", { class: "scene", "aria-hidden": "true" });
  scene.style.transform = `scale(${k})`;

  const fold = h("div", { class: "fold" });
  const panels = [0, 1, 2].map((i) => {
    const paper = paperView(letter, { date, links: false });
    paper.style.top = `${(-i * 800) / 3}px`;
    const panel = h("div", { class: `panel p${i}` }, h("div", { class: "face front" }, paper), h("div", { class: "face back" }));
    fold.append(panel);
    return panel;
  });

  const flapRear = h("div", { class: "env-flap open" });
  const rear = h("div", { class: "env-rear" }, h("div", { class: "env-back" }), flapRear);
  const flapFront = h("div", { class: "env-flap" });
  const seal = h("div", { class: "env-seal" });
  const halfL = h("div", { class: "env-half left" });
  const halfR = h("div", { class: "env-half right" });
  const front = h("div", { class: "env-front" },
    h("div", { class: "env-pocket" }, pocketLines()),
    flapFront, seal, halfL, halfR,
    h("div", { class: "env-label" }, label));
  const flight = h("div", { class: "flight" }, rear, fold, front);
  scene.append(flight);
  stageFrame.replaceChildren(scene);
  return { flight, fold, panels, rear, front, flapRear, flapFront, seal, halfL, halfR };
}

const IN_ENVELOPE = "translateY(10px) scale(0.8)";

async function closeFlap(sc) {
  await anim(sc.flapRear, [{ transform: "rotateX(180deg)" }, { transform: "rotateX(90deg)" }], 260, "ease-in");
  sc.flapRear.style.visibility = "hidden";
  sc.flapFront.style.visibility = "visible";
  await anim(sc.flapFront, [{ transform: "rotateX(90deg)" }, { transform: "rotateX(0deg)" }], 260, "ease-out");
}

async function openFlap(sc) {
  await anim(sc.flapFront, [{ transform: "rotateX(0deg)" }, { transform: "rotateX(90deg)" }], 260, "ease-in");
  sc.flapFront.style.visibility = "hidden";
  sc.flapRear.style.visibility = "visible";
  await anim(sc.flapRear, [{ transform: "rotateX(90deg)" }, { transform: "rotateX(180deg)" }], 260, "ease-out");
}

// Plie la lettre, la glisse dans l'enveloppe et pose le cachet.
async function foldIntoEnvelope(sc) {
  const [p0, , p2] = sc.panels;
  sc.flapFront.style.visibility = "hidden";
  sc.seal.style.opacity = "0";
  sc.rear.style.opacity = "0";
  sc.front.style.opacity = "0";
  await sleep(250);
  await anim(p2, [{ transform: "rotateX(0deg)" }, { transform: "rotateX(180deg)" }], 750);
  await anim(p0, [{ transform: "rotateX(0deg)" }, { transform: "rotateX(-180deg)" }], 750);
  const rise = [{ opacity: 0, transform: "translateY(160px)" }, { opacity: 1, transform: "translateY(0)" }];
  await Promise.all([
    anim(sc.fold, [{ transform: "translateY(0) scale(1)" }, { transform: "translateY(-250px) scale(0.8)" }], 650),
    anim(sc.rear, rise, 650, "ease-out"),
    anim(sc.front, rise, 650, "ease-out"),
  ]);
  await anim(sc.fold, [{ transform: "translateY(-250px) scale(0.8)" }, { transform: IN_ENVELOPE }], 750, "cubic-bezier(.5,0,.3,1)");
  await closeFlap(sc);
  await anim(sc.seal, [
    { opacity: 0, transform: "translateY(-50%) scale(2.4)" },
    { opacity: 1, transform: "translateY(-50%) scale(1)" },
  ], 520, "cubic-bezier(.3,1.5,.5,1)");
}

async function flyAway(sc) {
  await anim(sc.flight, [{ transform: "translateY(0)" }, { transform: "translateY(16px) rotate(2deg)" }], 220, "ease-out");
  await anim(sc.flight, [
    { transform: "translateY(16px) rotate(2deg)", opacity: 1 },
    { transform: "translate(260px, -900px) rotate(-14deg) scale(0.45)", opacity: 0 },
  ], 1100, "cubic-bezier(.5,0,.75,0)");
}

// Brise le cachet, ouvre l'enveloppe, sort la lettre et la déplie.
async function openEnvelope(sc) {
  const [p0, , p2] = sc.panels;
  sc.flapRear.style.visibility = "hidden";
  p0.style.transform = "rotateX(-180deg)";
  p2.style.transform = "rotateX(180deg)";
  sc.fold.style.transform = IN_ENVELOPE;
  await anim(sc.flight, [{ opacity: 0, transform: "translateY(60px) scale(0.7)" }, { opacity: 1, transform: "none" }], 600, "ease-out");
  await anim(sc.seal, [
    { transform: "translateY(-50%) rotate(0deg)" },
    { transform: "translateY(-50%) rotate(-10deg)" },
    { transform: "translateY(-50%) rotate(9deg)" },
    { transform: "translateY(-50%) rotate(-6deg)" },
    { transform: "translateY(-50%) rotate(0deg)" },
  ], 450);
  sc.seal.style.visibility = "hidden";
  sc.halfL.style.visibility = "visible";
  sc.halfR.style.visibility = "visible";
  await Promise.all([
    anim(sc.halfL, [{ transform: "translateY(-50%)", opacity: 1 }, { transform: "translate(-46px, 110px) rotate(-38deg)", opacity: 0 }], 700, "ease-in"),
    anim(sc.halfR, [{ transform: "translateY(-50%)", opacity: 1 }, { transform: "translate(46px, 110px) rotate(38deg)", opacity: 0 }], 700, "ease-in"),
    sleep(200).then(() => openFlap(sc)),
  ]);
  await anim(sc.fold, [{ transform: IN_ENVELOPE }, { transform: "translateY(-300px) scale(0.8)" }], 850, "ease-out");
  const drop = [{ opacity: 1, transform: "translateY(0)" }, { opacity: 0, transform: "translateY(420px)" }];
  await Promise.all([
    anim(sc.rear, drop, 600, "ease-in"),
    anim(sc.front, drop, 600, "ease-in"),
    anim(sc.fold, [{ transform: "translateY(-300px) scale(0.8)" }, { transform: "translateY(0) scale(1)" }], 750),
  ]);
  await anim(p0, [{ transform: "rotateX(-180deg)" }, { transform: "rotateX(0deg)" }], 700);
  await anim(p2, [{ transform: "rotateX(180deg)" }, { transform: "rotateX(0deg)" }], 700);
  await sleep(350);
}

// ---------- Envoi ----------

async function foldAndSend(btn, status) {
  const letter = payload();
  if (!letter.items.some((it) => it.text.trim())) {
    toast("Ajoute au moins un souhait avant de plier ta lettre.");
    document.querySelector(".items .text")?.focus();
    return;
  }
  btn.disabled = true;
  clearTimeout(saveTimer);
  saveTimer = null;
  const ok = await save(status);
  btn.disabled = false;
  if (!ok) return;

  await openStage();
  const partner = state.partner.name;
  const sc = buildScene({ letter: payload(), date: letterDate(null), label: `pour ${partner}` });
  await foldIntoEnvelope(sc);

  const choice = await new Promise((resolve) => {
    const send = h("button", { type: "button", class: "btn btn-gold", onclick: () => resolve(send) }, icon.send("#10203a"), "Envoyer au Père Noël");
    const undo = h("button", { type: "button", class: "btn btn-ghost", onclick: () => resolve(null) }, "Reprendre ma lettre");
    const hint = h("p", { id: "stage-hint" }, `Un mail prévient ${partner}. Ensuite, ta lettre ne se modifie plus.`);
    stageActions.replaceChildren(send, undo, hint);
    send.focus();
  });
  if (!choice) {
    closeStage();
    return;
  }

  let result;
  // Une fois « Envoyer » cliqué, on ne peut plus reprendre la lettre : seul le bouton d'envoi reste.
  stageActions.replaceChildren(choice, document.getElementById("stage-hint"));
  for (;;) {
    choice.disabled = true;
    choice.lastChild.textContent = "Envoi au Pôle Nord…";
    try {
      result = await api("/api/send", { method: "POST", body: payload() });
      break;
    } catch (e) {
      if (e.status === 409) {
        result = { mail: "already" };
        break;
      }
      if (e.status === 400) {
        document.getElementById("stage-hint").textContent = e.message;
        choice.remove();
        stageActions.append(h("button", { type: "button", class: "btn btn-ghost", onclick: closeStage }, "Corriger ma lettre"));
        return;
      }
      document.getElementById("stage-hint").textContent = e.message;
      choice.disabled = false;
      choice.lastChild.textContent = "Réessayer l'envoi";
      await new Promise((r) => choice.addEventListener("click", r, { once: true }));
    }
  }
  stageActions.replaceChildren();
  await flyAway(sc);
  closeStage();
  try {
    await loadState();
  } catch {
    state.mine.sentAt = result.sentAt || new Date(now()).toISOString();
  }
  view = "box";
  render();
  if (result.mail === "sent" || result.mail === "logged") toast(`Lettre envoyée au Père Noël. ${partner} a reçu un mail.`);
  else if (result.mail === "already") toast("Ta lettre était déjà partie.");
  else toast(`Lettre envoyée et scellée. Le mail pour ${partner} n'est pas parti : pense à le dire toi-même.`, 7000);
}

// ---------- Boîte aux lettres ----------

function renderBox() {
  const me = state.me.name;
  const partner = state.partner.name;
  const revealDay = DAY_LONG.format(new Date(state.revealAt));
  const revealed = remaining() === 0 && state.revealed;

  const mine = state.mine.sentAt
    ? h("div", { class: "slot" },
        h("button", { type: "button", class: "env-btn", "aria-label": "Relire ta lettre", onclick: () => go("read-mine") }, envSmall({ label: `de ${me}` })),
        h("h2", {}, "Ta lettre"),
        h("p", {}, `Envoyée le ${DAY.format(new Date(state.mine.sentAt))}. Clique dessus pour la relire.`),
        mailRetry())
    : h("div", { class: "slot" },
        h("div", { class: "env-btn" }, envSmall({ empty: true })),
        h("h2", {}, "Ta lettre"),
        h("p", {}, "Elle n'est pas encore partie."),
        h("a", { class: "btn btn-wax", href: "#", "data-nav": "write" }, "Continuer ma lettre"));

  let theirs;
  if (!state.theirs.sentAt) {
    theirs = h("div", { class: "slot" },
      h("div", { class: "env-btn" }, envSmall({ empty: true })),
      h("h2", {}, `La lettre de ${partner}`),
      h("p", {}, revealed ? `${partner} n'a pas écrit de lettre.` : `${partner} n'a pas encore envoyé sa lettre. Tu recevras un mail.`));
  } else if (!revealed) {
    const btn = h("button", {
      type: "button",
      class: "env-btn",
      "aria-label": `La lettre de ${partner}, scellée jusqu'au ${revealDay}`,
      onclick: () => {
        btn.classList.remove("shake");
        void btn.offsetWidth;
        btn.classList.add("shake");
        toast(`Patience : cette lettre s'ouvre le ${revealDay}.`);
      },
    }, envSmall({ label: `pour ${me}` }));
    theirs = h("div", { class: "slot" }, btn, h("h2", {}, `La lettre de ${partner}`), h("p", {}, `Scellée jusqu'au ${revealDay}.`));
  } else {
    theirs = h("div", { class: "slot ready" },
      h("button", { type: "button", class: "env-btn", "aria-label": `Ouvrir la lettre de ${partner}`, onclick: () => reveal() }, envSmall({ label: `pour ${me}` })),
      h("h2", {}, `La lettre de ${partner}`),
      h("p", {}, "Elle est arrivée. Clique sur l'enveloppe pour l'ouvrir."));
  }

  const head = revealed
    ? [h("h1", {}, "Les lettres sont ouvertes"), h("p", { class: "sub" }, "C'est le grand jour. Bonne lecture !")]
    : [h("h1", {}, "La boîte aux lettres"), h("p", { class: "sub" }, `Les lettres s'ouvrent le ${revealDay} à minuit.`)];

  const countdown = revealed
    ? null
    : h("div", { class: "countdown", role: "timer", "aria-label": "Temps restant avant l'ouverture" },
        ["jours", "heures", "minutes", "secondes"].map((unit) => h("div", {}, h("b", {}, "00"), h("span", {}, unit))));

  app.replaceChildren(h("section", { class: "box" }, h("div", {}, head), countdown, h("div", { class: "slots" }, theirs, mine)));
  if (countdown) fillCountdown(countdown);
}

// Le mail de notification n'est pas parti : on propose de le renvoyer.
function mailRetry() {
  if (["sent", "logged", "skipped"].includes(state.mine.mailStatus)) return null;
  const btn = h("button", {
    type: "button",
    class: "btn btn-ghost",
    onclick: async () => {
      btn.disabled = true;
      try {
        const r = await api("/api/send", { method: "POST", body: state.mine.letter });
        state.mine.mailStatus = r.mail;
      } catch (e) {
        if (e.status !== 409) {
          toast(e.message);
          btn.disabled = false;
          return;
        }
        state.mine.mailStatus = "sent";
      }
      if (state.mine.mailStatus === "sent" || state.mine.mailStatus === "logged") toast(`Mail envoyé à ${state.partner.name}.`);
      else toast("Le mail ne part toujours pas. Réessaie plus tard.");
      render();
    },
  }, `Renvoyer le mail à ${state.partner.name}`);
  return h("div", {}, h("p", {}, `Le mail pour ${state.partner.name} n'est pas parti.`), btn);
}

async function reveal() {
  if (!state.theirs.letter) {
    await loadState();
    if (!state.theirs.letter) return render();
  }
  await openStage();
  const sc = buildScene({ letter: state.theirs.letter, date: letterDate(state.theirs.sentAt), label: `pour ${state.me.name}` });
  await openEnvelope(sc);
  closeStage();
  view = "read-theirs";
  render();
  app.focus({ preventScroll: true });
  scrollTo({ top: 0 });
}

// Un nouveau lien collé dans un onglet déjà ouvert ne recharge pas la page : on le fait.
addEventListener("hashchange", () => {
  if (/(?:^#|&)t=/.test(location.hash)) location.reload();
});

boot();
