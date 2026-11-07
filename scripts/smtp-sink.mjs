#!/usr/bin/env node
// Faux serveur SMTP local (en clair, sans envoi réel) pour le développement et les tests.
// Chaque mail reçu est écrit dans SINK_DIR (défaut .smtp-sink/) en .eml et .json.
// Usage : node scripts/smtp-sink.mjs [port]   (défaut 2526)
import net from "node:net";
import fs from "node:fs";
import path from "node:path";

const port = Number(process.argv[2] || process.env.SINK_PORT || 2526);
const dir = path.resolve(process.env.SINK_DIR || ".smtp-sink");
fs.mkdirSync(dir, { recursive: true });
let count = 0;

const server = net.createServer((sock) => {
  let buf = "";
  let inData = false;
  let data = [];
  let env = { from: null, to: [], auth: null };
  const reply = (l) => sock.write(`${l}\r\n`);
  reply("220 smtp-sink prêt");
  sock.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let i;
    while ((i = buf.indexOf("\r\n")) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (inData) {
        if (line === ".") {
          inData = false;
          count += 1;
          const id = `${Date.now()}-${count}`;
          const raw = data.map((l) => (l.startsWith("..") ? l.slice(1) : l)).join("\r\n");
          fs.writeFileSync(path.join(dir, `${id}.eml`), raw);
          fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ ...env, size: raw.length }, null, 2));
          console.log(`[sink] mail ${id} de ${env.from} à ${env.to.join(", ")}`);
          reply("250 OK message accepté");
          data = [];
          env = { from: null, to: [], auth: env.auth };
        } else data.push(line);
        continue;
      }
      const cmd = line.toUpperCase();
      if (cmd.startsWith("EHLO") || cmd.startsWith("HELO")) {
        sock.write("250-smtp-sink\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n");
      } else if (cmd.startsWith("AUTH PLAIN")) {
        const decoded = Buffer.from(line.slice(11).trim(), "base64").toString("utf8").split("\u0000");
        env.auth = decoded[1] || null;
        reply("235 Authentification réussie");
      } else if (cmd.startsWith("MAIL FROM:")) {
        env.from = line.slice(10).replace(/[<>]/g, "").trim();
        reply("250 OK");
      } else if (cmd.startsWith("RCPT TO:")) {
        env.to.push(line.slice(8).replace(/[<>]/g, "").trim());
        reply("250 OK");
      } else if (cmd === "DATA") {
        inData = true;
        reply("354 Fin avec <CRLF>.<CRLF>");
      } else if (cmd === "QUIT") {
        reply("221 Au revoir");
        sock.end();
      } else if (cmd === "RSET" || cmd === "NOOP") {
        reply("250 OK");
      } else {
        reply("502 Commande non prise en charge");
      }
    }
  });
  sock.on("error", () => {});
});

server.listen(port, "127.0.0.1", () => console.log(`[sink] SMTP sur 127.0.0.1:${port}, mails dans ${dir}`));
