import { Order } from "./db.js";
import { getSettings } from "./config.js";
import { sendEmail, appUrl, escapeHtml } from "./mailer.js";
import { sendTemplate, TEMPLATES } from "./whatsapp.js";
import { internationalPhone, callingCodeFor } from "./payments.js";

/**
 * Tell the shopper their order is in, and tell the shop (SCALING.md M8).
 *
 * Sent when an order becomes real: at creation for cash on delivery, on a
 * verified payment for mobile money (never for a payment that is still
 * pending, which may yet fail). Each side is claimed with a conditional write
 * on `notified.*`, so a webhook delivered twice cannot message anyone twice.
 * Failures are logged, never thrown: checkout must not fail because a
 * notification did.
 *
 * Channels are independent and each is inert without its keys: email needs
 * RESEND_API_KEY (or the dev console), WhatsApp needs WHATSAPP_TOKEN and
 * WHATSAPP_PHONE_NUMBER_ID.
 */

function formatMoney(cents, { currency, locale }) {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
  } catch {
    return `${currency} ${(cents / 100).toLocaleString("en-US")}`;
  }
}

const paymentLine = (order, total) =>
  order.payment_method === "mobile_money" ? `Paid ${total} by mobile money` : `Pay ${total} in cash on delivery`;

async function claim(orderId, field) {
  const r = await Order.updateOne({ _id: orderId, [`notified.${field}`]: null }, { $set: { [`notified.${field}`]: new Date() } });
  return r.modifiedCount === 1;
}

function customerEmail(order, settings, total, trackUrl) {
  const lines = order.items.map((i) => `  ${i.qty} × ${i.name}${i.size ? ` (${[i.size, i.color].filter(Boolean).join(" / ")})` : ""}`);
  const pay = paymentLine(order, total);
  return {
    to: order.email,
    subject: `${settings.shop_name}: order #${order.number} is confirmed`,
    text:
      `Hi ${order.customer_name.split(" ")[0]},\n\n` +
      `Thank you for your order #${order.number}.\n\n${lines.join("\n")}\n\n` +
      `Total: ${total}\n${pay}.\nDelivering to: ${order.address}, ${order.city}\n\n` +
      (trackUrl ? `Check on it any time: ${trackUrl}\n\n` : "") +
      `${settings.shop_name}${settings.support_phone ? ` · ${settings.support_phone}` : ""}`,
    html:
      `<p>Hi ${escapeHtml(order.customer_name.split(" ")[0])},</p>` +
      `<p>Thank you for your order <strong>#${order.number}</strong>.</p>` +
      `<ul>${order.items.map((i) => `<li>${i.qty} × ${escapeHtml(i.name)}${i.size ? ` (${escapeHtml([i.size, i.color].filter(Boolean).join(" / "))})` : ""}</li>`).join("")}</ul>` +
      `<p><strong>Total: ${escapeHtml(total)}</strong><br>${escapeHtml(pay)}.<br>Delivering to: ${escapeHtml(order.address)}, ${escapeHtml(order.city)}</p>` +
      (trackUrl ? `<p><a href="${escapeHtml(trackUrl)}">Check on your order</a></p>` : "") +
      `<p>${escapeHtml(settings.shop_name)}</p>`,
  };
}

/** Send whichever confirmations haven't gone out for this order. */
export async function sendOrderConfirmations(orderId) {
  try {
    const order = await Order.findById(orderId);
    if (!order) return;
    const settings = await getSettings();
    const total = formatMoney(order.total_cents, settings);
    const cc = callingCodeFor(settings.locale);
    const base = appUrl();
    const trackUrl = base ? `${base}/track?number=${order.number}` : null;

    if (await claim(order._id, "customer_at")) {
      const jobs = [];
      if (order.email) {
        jobs.push(sendEmail(customerEmail(order, settings, total, trackUrl)));
      }
      jobs.push(
        sendTemplate(internationalPhone(order.phone, cc), TEMPLATES.order(), [
          order.customer_name.split(" ")[0],
          `#${order.number}`,
          total,
          paymentLine(order, total),
        ])
      );
      for (const r of await Promise.allSettled(jobs)) {
        if (r.status === "rejected") console.error(`Order #${order.number} confirmation failed:`, r.reason?.message);
      }
    }

    if (await claim(order._id, "shop_at")) {
      const who = `${order.customer_name}, ${order.city} (${order.phone})`;
      const jobs = [];
      if (settings.support_email) {
        jobs.push(
          sendEmail({
            to: settings.support_email,
            subject: `New order #${order.number}: ${total}`,
            text:
              `New order #${order.number} for ${total}.\n${who}\n${paymentLine(order, total)}.\n\n` +
              order.items.map((i) => `  ${i.qty} × ${i.name} ${[i.size, i.color].filter(Boolean).join(" / ")} ${i.sku || ""}`).join("\n") +
              (base ? `\n\n${base}/admin/orders` : ""),
          })
        );
      }
      if (settings.whatsapp_number) {
        jobs.push(sendTemplate(settings.whatsapp_number, TEMPLATES.shop(), [`#${order.number}`, total, who, paymentLine(order, total)]));
      }
      for (const r of await Promise.allSettled(jobs)) {
        if (r.status === "rejected") console.error(`Order #${order.number} shop alert failed:`, r.reason?.message);
      }
    }
  } catch (err) {
    console.error("Order notifications failed:", err.message);
  }
}
