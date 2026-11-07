import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LetterError,
  assertSendable,
  cleanLetter,
  isRevealed,
  notificationMail,
  other,
  personFromToken,
  profile,
  safeEqual,
} from "../src/logic.js";

const env = {
  PERSON_A_NAME: "Alice",
  PERSON_A_EMAIL: "a@example.test",
  PERSON_A_TOKEN: "jeton-personne-a-0001",
  PERSON_B_NAME: "Bob",
  PERSON_B_EMAIL: "b@example.test",
  PERSON_B_TOKEN: "jeton-personne-b-0002",
  REVEAL_AT: "2026-11-20T00:00:00+01:00",
  PUBLIC_URL: "https://noel.example.test/",
};

test("le jeton désigne la bonne personne, et seulement elle", () => {
  assert.equal(personFromToken(env, "jeton-personne-a-0001"), "a");
  assert.equal(personFromToken(env, "jeton-personne-b-0002"), "b");
  assert.equal(personFromToken(env, "jeton-personne-b-0003"), null);
  assert.equal(personFromToken(env, ""), null);
  assert.equal(personFromToken(env, undefined), null);
  assert.equal(personFromToken({ ...env, PERSON_A_TOKEN: "court" }, "court"), null, "jeton trop court refusé");
  assert.equal(other("a"), "b");
  assert.equal(other("b"), "a");
});

test("safeEqual compare sans court-circuit", () => {
  assert.ok(safeEqual("abc", "abc"));
  assert.ok(!safeEqual("abc", "abd"));
  assert.ok(!safeEqual("abc", "abcd"));
});

test("ouverture : scellé jusqu'au 20/11/2026 minuit heure de Paris", () => {
  assert.equal(isRevealed(env, Date.parse("2026-11-19T22:59:59Z")), false);
  assert.equal(isRevealed(env, Date.parse("2026-11-19T23:00:00Z")), true);
  assert.equal(isRevealed(env, Date.parse("2026-12-25T10:00:00Z")), true);
});

test("cleanLetter nettoie, ignore les lignes vides et valide les liens", () => {
  const l = cleanLetter({
    intro: "  Bonjour\r\nPère Noël \u0007",
    items: [
      { text: " Un pull ", link: "https://exemple.fr/pull", note: "taille M", where: " Grand magasin,\r\n3e étage " },
      { text: "", link: "", note: "" },
      { text: "Un livre" },
    ],
    ps: "P.S.",
    signature: "Bisous",
  });
  assert.equal(l.intro, "Bonjour\nPère Noël");
  assert.deepEqual(l.items, [
    { text: "Un pull", link: "https://exemple.fr/pull", note: "taille M", where: "Grand magasin,\n3e étage" },
    { text: "Un livre", link: "", note: "", where: "" },
  ]);
});

test("cleanLetter refuse les liens dangereux et les textes trop longs", () => {
  assert.throws(() => cleanLetter({ items: [{ text: "x", link: "javascript:alert(1)" }] }), LetterError);
  assert.throws(() => cleanLetter({ items: [{ text: "x", link: "pas un lien" }] }), LetterError);
  assert.throws(() => cleanLetter({ items: [{ text: "x".repeat(201) }] }), LetterError);
  assert.throws(() => cleanLetter({ items: [{ text: "", link: "https://a.fr" }] }), LetterError);
  assert.throws(() => cleanLetter({ items: Array.from({ length: 31 }, () => ({ text: "x" })) }), LetterError);
  assert.throws(() => cleanLetter(null), LetterError);
});

test("« Où le trouver » : limité à 300 caractères, et exige un texte de souhait", () => {
  assert.throws(() => cleanLetter({ items: [{ text: "x", where: "y".repeat(301) }] }), LetterError);
  assert.throws(() => cleanLetter({ items: [{ text: "", where: "Rayon 3" }] }), LetterError);
  assert.equal(cleanLetter({ items: [{ text: "x", note: "n".repeat(80) }] }).items[0].note.length, 80);
});

test("une lettre écrite avant « Où le trouver » reste valide", () => {
  const old = cleanLetter({ items: [{ text: "Un livre", link: "", note: "" }] });
  assert.deepEqual(old.items, [{ text: "Un livre", link: "", note: "", where: "" }]);
});

test("une lettre sans souhait ne part pas", () => {
  assert.throws(() => assertSendable(cleanLetter({ items: [] })), LetterError);
  assert.doesNotThrow(() => assertSendable(cleanLetter({ items: [{ text: "x" }] })));
});

test("le mail contient le lien personnel du destinataire, échappé en HTML", () => {
  const from = profile({ ...env, PERSON_A_NAME: "Al<b>ice" }, "a");
  const to = profile(env, "b");
  const mail = notificationMail({ env, from, to, now: Date.parse("2026-11-07T10:00:00Z") });
  assert.match(mail.subject, /Al<b>ice t'a écrit une lettre au Père Noël/);
  assert.ok(mail.text.includes("https://noel.example.test/#t=jeton-personne-b-0002"));
  assert.ok(!mail.text.includes("jeton-personne-a-0001"), "jamais le jeton de l'expéditeur");
  assert.match(mail.text, /scellée jusqu'au vendredi 20 novembre/);
  assert.ok(mail.html.includes("Al&lt;b&gt;ice"));
  const after = notificationMail({ env, from, to, now: Date.parse("2026-11-21T10:00:00Z") });
  assert.match(after.text, /déjà ouvertes/);
});
