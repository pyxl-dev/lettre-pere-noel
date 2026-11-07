import { test } from "node:test";
import assert from "node:assert/strict";
import { notify } from "../src/mail.js";
import { profile } from "../src/logic.js";

const env = {
  PERSON_A_NAME: "Alice",
  PERSON_A_TOKEN: "jeton-personne-a-0001",
  PERSON_B_NAME: "Bob",
  PERSON_B_EMAIL: "b@example.test",
  PERSON_B_TOKEN: "jeton-personne-b-0002",
  PUBLIC_URL: "https://noel.example.test",
  MAIL_FROM: "noel@example.test",
};
const from = profile(env, "a");
const to = profile(env, "b");
const refused = () => {
  throw new Error("connexion refusée");
};

test("sans adresse de destinataire, rien ne part", async () => {
  const r = await notify(env, { from, to: { ...to, email: "" } }, { connect: refused, fetch: refused });
  assert.equal(r.status, "skipped");
});

test("rien de configuré : échec explicite, la lettre reste envoyée côté appelant", async () => {
  const r = await notify(env, { from, to }, { connect: refused, fetch: refused });
  assert.equal(r.status, "failed");
  assert.match(r.error, /aucun moyen d'envoi/);
});

test("SMTP en panne : repli sur Resend avec le bon contenu", async () => {
  let call;
  const fetch = async (url, init) => {
    call = { url, init };
    return new Response("{}", { status: 200 });
  };
  const r = await notify({ ...env, SMTP_HOST: "smtp.example.test", RESEND_API_KEY: "re_test" }, { from, to }, { connect: refused, fetch });
  assert.deepEqual(r, { status: "sent", via: "resend" });
  assert.equal(call.url, "https://api.resend.com/emails");
  assert.equal(call.init.headers.authorization, "Bearer re_test");
  const body = JSON.parse(call.init.body);
  assert.deepEqual(body.to, ["b@example.test"]);
  assert.equal(body.from, "Lettre au Père Noël <noel@example.test>");
  assert.ok(body.text.includes("#t=jeton-personne-b-0002"));
});

test("SMTP et Resend en panne : les deux erreurs sont rapportées", async () => {
  const fetch = async () => new Response("quota", { status: 429 });
  const r = await notify({ ...env, SMTP_HOST: "smtp.example.test", RESEND_API_KEY: "re_test" }, { from, to }, { connect: refused, fetch });
  assert.equal(r.status, "failed");
  assert.match(r.error, /smtp: connexion refusée/);
  assert.match(r.error, /resend: HTTP 429 quota/);
});

test("mode log : aucun envoi réseau", async () => {
  const r = await notify({ ...env, MAIL_MODE: "log", SMTP_HOST: "x" }, { from, to }, { connect: refused, fetch: refused });
  assert.equal(r.status, "logged");
});
