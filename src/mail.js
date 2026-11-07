// Mail de notification : SMTP d'abord, Resend en repli, « log » en développement.
// `deps.connect` (cloudflare:sockets) et `deps.fetch` sont injectés pour les tests.
import { notificationMail } from "./logic.js";
import { sendMail } from "./smtp.js";

export async function notify(env, { from, to }, deps) {
  if (!to.email) return { status: "skipped", error: "adresse du destinataire absente" };
  const mail = notificationMail({ env, from, to });
  const fromName = "Lettre au Père Noël";
  if (env.MAIL_MODE === "log") {
    console.log(`[mail] à ${to.email} : ${mail.subject}\n${mail.text}`);
    return { status: "logged" };
  }
  const errors = [];
  if (env.SMTP_HOST) {
    try {
      await sendMail({
        connect: deps.connect,
        host: env.SMTP_HOST,
        port: env.SMTP_PORT || 465,
        secure: env.SMTP_SECURE || (String(env.SMTP_PORT) === "587" ? "starttls" : "on"),
        user: env.SMTP_USER,
        pass: env.SMTP_PASS,
        from: env.MAIL_FROM,
        fromName,
        to: to.email,
        ...mail,
      });
      return { status: "sent", via: "smtp" };
    } catch (e) {
      errors.push(`smtp: ${e.message}`);
    }
  }
  if (env.RESEND_API_KEY) {
    try {
      const res = await deps.fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ from: `${fromName} <${env.MAIL_FROM}>`, to: [to.email], ...mail }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`);
      return { status: "sent", via: "resend" };
    } catch (e) {
      errors.push(`resend: ${e.message}`);
    }
  }
  if (!errors.length) errors.push("aucun moyen d'envoi configuré (SMTP_HOST ou RESEND_API_KEY)");
  return { status: "failed", error: errors.join(" ; ") };
}
