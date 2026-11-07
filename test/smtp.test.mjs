import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { Duplex } from "node:stream";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sendMail, buildMessage } from "../src/smtp.js";

const PORT = 25261;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lpn-sink-"));
let sink;

// Adaptateur : expose une socket Node avec l'interface de cloudflare:sockets.
function connect({ hostname, port }) {
  const sock = net.connect(port, hostname);
  const { readable, writable } = Duplex.toWeb(sock);
  return { readable, writable, close: async () => sock.destroy(), startTls: () => { throw new Error("pas de TLS en test"); } };
}

before(async () => {
  sink = spawn(process.execPath, ["scripts/smtp-sink.mjs", String(PORT)], { env: { ...process.env, SINK_DIR: dir } });
  await new Promise((resolve) => sink.stdout.once("data", resolve));
});

after(() => {
  sink.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});

function decodePart(raw, type) {
  const part = raw.split(/--lpn-[\w-]+/).find((p) => p.includes(`Content-Type: ${type}`));
  const body = part.split("\r\n\r\n").slice(1).join("").replace(/\s+/g, "");
  return Buffer.from(body, "base64").toString("utf8");
}

test("envoie un mail UTF-8 complet au serveur SMTP", async () => {
  await sendMail({
    connect,
    host: "127.0.0.1",
    port: PORT,
    secure: "off",
    user: "noel@example.test",
    pass: "secret",
    from: "noel@example.test",
    fromName: "Lettre au Père Noël",
    to: "b@example.test",
    subject: "Alice t'a écrit une lettre au Père Noël",
    text: "Bonjour,\n.ligne qui commence par un point\nfin",
    html: "<p>Bonjour</p>",
  });
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  assert.equal(files.length, 1);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf8"));
  assert.equal(meta.from, "noel@example.test");
  assert.deepEqual(meta.to, ["b@example.test"]);
  assert.equal(meta.auth, "noel@example.test");
  const raw = fs.readFileSync(path.join(dir, files[0].replace(".json", ".eml")), "utf8");
  assert.match(raw, /^Subject: =\?UTF-8\?B\?/m);
  const subject = /^Subject: =\?UTF-8\?B\?(.+)\?=$/m.exec(raw)[1];
  assert.equal(Buffer.from(subject, "base64").toString("utf8"), "Alice t'a écrit une lettre au Père Noël");
  assert.equal(decodePart(raw, "text/plain"), "Bonjour,\n.ligne qui commence par un point\nfin");
  assert.equal(decodePart(raw, "text/html"), "<p>Bonjour</p>");
});

test("échoue proprement si le serveur est injoignable", async () => {
  await assert.rejects(
    sendMail({ connect, host: "127.0.0.1", port: 1, secure: "off", from: "a@b.fr", to: "c@d.fr", subject: "s", text: "t", html: "h", timeoutMs: 3000 }),
  );
});

test("refuse une adresse invalide avant toute connexion", async () => {
  await assert.rejects(
    sendMail({ connect: () => assert.fail("pas de connexion"), host: "x", port: 1, from: "a@b.fr", to: "pas-une-adresse", subject: "s", text: "t", html: "h" }),
    /Adresse invalide/,
  );
});

test("buildMessage produit des lignes CRLF et un en-tête From encodé", () => {
  const m = buildMessage({ from: "noel@example.test", fromName: "Père Noël", to: "b@example.test", subject: "Hi", text: "a", html: "b" });
  assert.match(m, /^From: =\?UTF-8\?B\?.+\?= <noel@example\.test>\r\n/);
  assert.ok(!/[^\r]\n/.test(m), "uniquement des fins de ligne CRLF");
});

test("verifyOnly s'authentifie puis se déconnecte sans envoyer de mail", async () => {
  const before = fs.readdirSync(dir).length;
  await sendMail({ connect, host: "127.0.0.1", port: PORT, secure: "off", user: "noel@example.test", pass: "x", from: "noel@example.test", verifyOnly: true });
  assert.equal(fs.readdirSync(dir).length, before);
});
