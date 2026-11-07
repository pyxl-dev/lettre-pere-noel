// Client SMTP minimal pour Workers (cloudflare:sockets) : TLS direct (465),
// STARTTLS (587) ou clair (tests locaux). La fonction `connect` est injectée
// pour pouvoir le tester sous Node avec un faux serveur.

const enc = new TextEncoder();
const dec = new TextDecoder();

export class SmtpError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

function b64(str) {
  const bytes = enc.encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64Lines(str) {
  return b64(str).replace(/.{1,76}/g, "$&\r\n");
}

function encodeHeader(value) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${b64(value)}?=`;
}

function addressOnly(addr) {
  const m = /<([^>]+)>/.exec(addr);
  return (m ? m[1] : addr).trim();
}

function assertAddress(addr) {
  if (!/^[^\s<>@,;:"]+@[^\s<>@,;:"]+\.[^\s<>@,;:"]+$/.test(addr)) {
    throw new SmtpError(`Adresse invalide : ${addr}`);
  }
}

export function buildMessage({ from, fromName, to, subject, text, html, date = new Date(), messageId }) {
  const boundary = `lpn-${crypto.randomUUID()}`;
  const domain = from.split("@")[1] || "localhost";
  const lines = [
    `From: ${fromName ? `${encodeHeader(fromName)} <${from}>` : from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${date.toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${messageId || crypto.randomUUID()}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    b64Lines(html),
    `--${boundary}--`,
    "",
  ];
  return lines.join("\r\n");
}

class Conn {
  constructor(socket) {
    this.use(socket);
    this.buffer = "";
  }

  use(socket) {
    this.socket = socket;
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  release() {
    this.reader.releaseLock();
    this.writer.releaseLock();
  }

  async readLine() {
    for (;;) {
      const i = this.buffer.indexOf("\r\n");
      if (i >= 0) {
        const line = this.buffer.slice(0, i);
        this.buffer = this.buffer.slice(i + 2);
        return line;
      }
      const { value, done } = await this.reader.read();
      if (done) throw new SmtpError("Connexion SMTP fermée par le serveur");
      this.buffer += dec.decode(value, { stream: true });
    }
  }

  // Lit une réponse (éventuellement multiligne) et vérifie son code.
  async expect(codes, step) {
    const lines = [];
    let line;
    do {
      line = await this.readLine();
      lines.push(line);
    } while (/^\d{3}-/.test(line));
    const code = Number(line.slice(0, 3));
    if (!codes.includes(code)) {
      throw new SmtpError(`SMTP ${step} : ${lines.join(" | ")}`, code);
    }
    return lines;
  }

  async send(cmd) {
    await this.writer.write(enc.encode(`${cmd}\r\n`));
  }

  async command(cmd, codes, step) {
    await this.send(cmd);
    return this.expect(codes, step);
  }
}

// Envoie un mail (ou, avec `verifyOnly`, vérifie seulement la connexion). `secure` : "on" (465), "starttls" (587) ou "off" (tests locaux).
export async function sendMail({
  connect,
  host,
  port,
  secure = "on",
  user,
  pass,
  from,
  fromName,
  to,
  subject,
  text,
  html,
  helo = "lettre-pere-noel",
  timeoutMs = 15000,
  verifyOnly = false,
}) {
  assertAddress(addressOnly(from));
  if (!verifyOnly) assertAddress(addressOnly(to));
  const socket = connect({ hostname: host, port: Number(port) }, { secureTransport: secure, allowHalfOpen: false });
  const conn = new Conn(socket);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new SmtpError("SMTP : délai dépassé")), timeoutMs);
  });
  const run = async () => {
    await conn.expect([220], "accueil");
    const ehlo = await conn.command(`EHLO ${helo}`, [250], "EHLO");
    if (secure === "starttls") {
      if (!ehlo.some((l) => /STARTTLS/i.test(l))) throw new SmtpError("Le serveur ne propose pas STARTTLS");
      await conn.command("STARTTLS", [220], "STARTTLS");
      conn.release();
      conn.use(conn.socket.startTls());
      conn.buffer = "";
      await conn.command(`EHLO ${helo}`, [250], "EHLO après STARTTLS");
    }
    if (user) {
      await conn.command(`AUTH PLAIN ${b64(`\u0000${user}\u0000${pass || ""}`)}`, [235], "AUTH");
    }
    if (verifyOnly) {
      // Vérifie connexion, TLS et identifiants sans rien envoyer.
      await conn.command("QUIT", [221], "QUIT");
      return;
    }
    await conn.command(`MAIL FROM:<${addressOnly(from)}>`, [250], "MAIL FROM");
    await conn.command(`RCPT TO:<${addressOnly(to)}>`, [250, 251], "RCPT TO");
    await conn.command("DATA", [354], "DATA");
    const body = buildMessage({ from: addressOnly(from), fromName, to, subject, text, html })
      .split("\r\n")
      .map((l) => (l.startsWith(".") ? `.${l}` : l))
      .join("\r\n");
    await conn.writer.write(enc.encode(`${body}\r\n.\r\n`));
    await conn.expect([250], "fin du message");
    try {
      await conn.command("QUIT", [221], "QUIT");
    } catch {
      // Certains serveurs ferment sans répondre au QUIT : le mail est déjà accepté.
    }
  };
  try {
    await Promise.race([run(), timeout]);
  } finally {
    clearTimeout(timer);
    try {
      await socket.close();
    } catch {
      // déjà fermée
    }
  }
}
