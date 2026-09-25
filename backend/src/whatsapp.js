/**
 * WhatsApp messages through Meta's WhatsApp Cloud API.
 *
 * Inert without keys: whatsappEnabled() is false unless WHATSAPP_TOKEN and
 * WHATSAPP_PHONE_NUMBER_ID are set, and nothing is sent or logged.
 *
 *   WHATSAPP_TOKEN                     a permanent system-user access token
 *   WHATSAPP_PHONE_NUMBER_ID           the sending number's id (not the number)
 *   WHATSAPP_TEMPLATE_ORDER            approved template for the shopper; default "order_confirmation"
 *   WHATSAPP_TEMPLATE_SHOP             approved template for the shop's alert; default "new_order_alert"
 *   WHATSAPP_TEMPLATE_LANG             template language code; default "en"
 *   WHATSAPP_API_VERSION               default v21.0
 *
 * Business-initiated messages must use a template Meta has approved; free
 * text is only allowed inside a 24-hour window the customer opened. Both
 * templates take their values as body parameters, in this order:
 *   order_confirmation: {{1}} name, {{2}} order number, {{3}} total, {{4}} payment line
 *   new_order_alert:    {{1}} order number, {{2}} total, {{3}} customer and town, {{4}} payment line
 */

let fetchImpl = (...args) => fetch(...args);
export function setFetch(fn) {
  fetchImpl = fn || ((...args) => fetch(...args));
}

export const whatsappEnabled = () => Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);

export const TEMPLATES = {
  order: () => process.env.WHATSAPP_TEMPLATE_ORDER || "order_confirmation",
  shop: () => process.env.WHATSAPP_TEMPLATE_SHOP || "new_order_alert",
};

/**
 * Send one template message.
 * @param to      international digits, e.g. 256772123456
 * @param params  body parameters, in template order
 * @returns {{ sent, id? }}
 */
export async function sendTemplate(to, template, params) {
  if (!whatsappEnabled() || !to) return { sent: false };
  const version = process.env.WHATSAPP_API_VERSION || "v21.0";
  const res = await fetchImpl(`https://graph.facebook.com/${version}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: template,
        language: { code: process.env.WHATSAPP_TEMPLATE_LANG || "en" },
        components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: String(text).slice(0, 1000) })) }],
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`WhatsApp rejected the message (${res.status}): ${data?.error?.message || ""}`);
  return { sent: true, id: data?.messages?.[0]?.id };
}
