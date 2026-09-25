import { useConfig, useCopy } from "./store";

/**
 * WhatsApp click-to-chat links (wa.me). The number and the greeting come from
 * the shop's settings (whatsapp_number, copy.whatsapp_greeting); a shop with
 * no number configured gets `enabled: false`, and every WhatsApp control hides
 * rather than linking to someone else's phone.
 */
export function waLink(number, message) {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
}

export function useWhatsApp() {
  const { whatsapp_number, copy } = useConfig();
  const t = useCopy();
  const greeting = t(copy?.whatsapp_greeting || "Hello!");
  const enabled = Boolean(whatsapp_number);
  return {
    enabled,
    /** General enquiry. */
    link: (message = `${greeting} I'd like to ask about your products.`) => waLink(whatsapp_number, message),
    /** Prefilled enquiry for a specific product, linking back to its page. */
    productLink: (product) => {
      const url = `${window.location.origin}/product/${product.slug}`;
      return waLink(whatsapp_number, `${greeting} I'm interested in "${product.name}". Is it available?\n${url}`);
    },
  };
}
