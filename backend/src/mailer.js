/**
 * Outbound email, behind one function so the provider is a detail.
 *
 * - RESEND_API_KEY set  → sent through Resend's HTTP API (no SDK dependency;
 *   it is one POST). EMAIL_FROM must be an address on a domain verified in
 *   Resend; the default only works for Resend's own test sandbox.
 * - Unset, development  → printed to the console, links included, so the reset
 *   and invite flows are usable locally with no account anywhere.
 * - Unset, production   → not sent, and the body is NOT logged: it holds a
 *   live reset link, and deploy logs are readable by more people than the
 *   account owner. `emailEnabled()` is false, so the UI hides the
 *   "Forgot password?" link rather than offering a dead end.
 *
 * M8 (order confirmations, notifications) should send through this too.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

const isProd = () => process.env.NODE_ENV === "production";

/** True when an email will actually reach someone (or the dev console). */
export const emailEnabled = () => Boolean(process.env.RESEND_API_KEY) || !isProd();

/** Where links in emails point. Never derived from the request's Host header. */
export function appUrl() {
  const configured = (process.env.APP_URL || "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  // Deriving it from the Host header would let anyone request a reset for a
  // victim with `Host: evil.example` and have the real token mailed to the
  // victim inside a link to the attacker's site. Dev has a known origin.
  return isProd() ? null : "http://localhost:5173";
}

let testTransport = null;
/** Tests capture outgoing mail instead of printing or sending it. */
export function setTransport(fn) {
  testTransport = fn;
}

async function sendViaResend(msg) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM || "Bayan <onboarding@resend.dev>",
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend rejected the email (${res.status}): ${detail.slice(0, 300)}`);
  }
  return { sent: true, provider: "resend" };
}

/**
 * Send one email. Resolves `{ sent, provider }`; rejects only on a provider
 * error. Callers on public endpoints (forgot-password) must catch and log
 * rather than surface the failure, or the response would reveal whether the
 * address has an account.
 */
export async function sendEmail({ to, subject, text, html }) {
  const msg = { to, subject, text, html: html || `<pre style="font-family:inherit">${escapeHtml(text)}</pre>` };
  if (testTransport) return testTransport(msg);
  if (process.env.RESEND_API_KEY) return sendViaResend(msg);
  if (isProd()) {
    console.warn(`Email to ${to} not sent ("${subject}"): RESEND_API_KEY is not set.`);
    return { sent: false, provider: null };
  }
  console.log(`\n--- email (dev console transport) ---\nTo: ${to}\nSubject: ${subject}\n\n${text}\n--- end email ---\n`);
  return { sent: true, provider: "console" };
}

export const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
