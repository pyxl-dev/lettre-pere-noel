#!/usr/bin/env node
// Joueur de scénarios navigateur headless (Playwright), repris de pyxl-dev/pilote (pilote-browser).
// Navigateur isolé : jamais le navigateur personnel de l'utilisateur.
//
// Usage :
//   browser-steps.mjs <url> [--out DIR] [--viewports 1440x900,375x812] [--steps steps.json]
//
// steps.json : liste d'étapes jouées sur chaque viewport, dans l'ordre :
//   {"goto": "/chemin"}                       navigation relative à <url>
//   {"click": "text=Enregistrer"}             sélecteur Playwright (css, text=, role=...)
//   {"fill": ["#nom", "valeur"]}
//   {"press": "Enter"}
//   {"wait": 500}                             millisecondes
//   {"expect": {"selector": "h1", "text": "Studio"}}      présence (+ texte contenu)
//   {"expect": {"selector": ".item", "count": 3}}
//   {"expect": {"url": "#/studio"}}           l'URL contient
//   {"eval": "document.title", "equals": "Hub"}           vérification par code
//   {"shot": "apres-ajout"}                   capture nommée
//   {"aria": "main"}                          snapshot texte (pour un jugement Jev éventuel)
//
// Sortie : JSON sur stdout {ok, results:[{viewport, steps:[...], console_errors, shots}]}.
// Code de sortie 1 si une vérification échoue. Les captures vont dans --out (défaut ./.pilote-shots).
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
if (!args.length || args[0].startsWith("-")) {
  console.error("usage: browser-steps.mjs <url> [--out DIR] [--viewports WxH,...] [--steps steps.json]");
  process.exit(2);
}
const base = args[0];
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i > -1 ? args[i + 1] : def;
};
const out = path.resolve(opt("--out", ".pilote-shots"));
const viewports = opt("--viewports", "1440x900,375x812").split(",").map((v) => {
  const [w, h] = v.split("x").map(Number);
  return { width: w, height: h };
});
const stepsFile = opt("--steps", null);
const steps = stepsFile ? JSON.parse(fs.readFileSync(stepsFile, "utf8")) : [];
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = [];
let ok = true;

for (const vp of viewports) {
  const tag = `${vp.width}x${vp.height}`;
  const mobile = vp.width < 768;
  const context = await browser.newContext({
    viewport: vp,
    deviceScaleFactor: 1,
    isMobile: mobile,
    hasTouch: mobile,
  });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  const shots = [];
  const log = [];
  const shot = async (name) => {
    const f = path.join(out, `${name}-${tag}.png`);
    await page.screenshot({ path: f, fullPage: true });
    shots.push(f);
  };
  try {
    await page.goto(base, { waitUntil: "networkidle", timeout: 30000 });
    await shot("initial");
    for (const s of steps) {
      const entry = { step: s, ok: true };
      try {
        if (s.goto) await page.goto(new URL(s.goto, base).href, { waitUntil: "networkidle" });
        else if (s.click) await page.locator(s.click).first().click({ timeout: 8000 });
        else if (s.fill) await page.locator(s.fill[0]).first().fill(s.fill[1]);
        else if (s.press) await page.keyboard.press(s.press);
        else if (s.wait) await page.waitForTimeout(s.wait);
        else if (s.shot) await shot(s.shot);
        else if (s.aria) entry.aria = await page.locator(s.aria).first().ariaSnapshot();
        else if (s.eval) {
          entry.value = await page.evaluate(s.eval);
          if ("equals" in s && JSON.stringify(entry.value) !== JSON.stringify(s.equals)) entry.ok = false;
        } else if (s.expect) {
          const e = s.expect;
          if (e.url) entry.ok = page.url().includes(e.url);
          if (e.selector) {
            const loc = page.locator(e.selector);
            const n = await loc.count();
            if ("count" in e) entry.ok = n === e.count;
            else entry.ok = n > 0;
            if (entry.ok && e.text) entry.ok = (await loc.first().innerText()).includes(e.text);
            entry.found = n;
          }
        }
      } catch (err) {
        entry.ok = false;
        entry.error = String(err).slice(0, 300);
      }
      if (!entry.ok) ok = false;
      log.push(entry);
    }
    await shot("final");
  } catch (err) {
    ok = false;
    log.push({ step: { goto: base }, ok: false, error: String(err).slice(0, 300) });
  }
  results.push({ viewport: tag, steps: log, console_errors: consoleErrors, shots });
  await context.close();
}
await browser.close();
console.log(JSON.stringify({ ok, results }, null, 2));
process.exit(ok ? 0 : 1);
