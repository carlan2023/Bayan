/**
 * WhatsApp click-to-chat links (wa.me). One place owns the number so a future
 * change is a one-line edit.
 */
export const WHATSAPP_NUMBER = "256740399767"; // +256 740 399767, digits only per wa.me spec

export function waLink(message) {
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

/** Prefilled enquiry for a specific product, linking back to its page. */
export function waProductLink(product) {
  const url = `${window.location.origin}/product/${product.slug}`;
  return waLink(
    `Hello Bayan! I'm interested in "${product.name}". Is it available?\n${url}`
  );
}
