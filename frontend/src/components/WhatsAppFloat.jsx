import { useEffect, useRef, useState } from "react";
import { useWhatsApp } from "../whatsapp";
import { WhatsAppIcon } from "./Icons";

/**
 * Floating WhatsApp chat button, fixed to the bottom-right corner.
 *
 * Scroll-aware: it ducks out of the way while the shopper scrolls down
 * (they're browsing) and returns the moment they scroll up or stop —
 * so it never sits on top of content mid-read, but is always one flick away.
 */
export default function WhatsAppFloat() {
  const wa = useWhatsApp();
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);
  const settleTimer = useRef(null);

  useEffect(() => {
    function onScroll() {
      const y = window.scrollY;
      const goingDown = y > lastY.current;
      lastY.current = y;

      if (goingDown && y > 240) setHidden(true);
      else setHidden(false);

      // Reappear shortly after scrolling stops, wherever it stopped.
      clearTimeout(settleTimer.current);
      settleTimer.current = setTimeout(() => setHidden(false), 900);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(settleTimer.current);
    };
  }, []);

  // No number configured → no button, rather than a link to someone else's phone.
  if (!wa.enabled) return null;

  return (
    <a
      className={`wa-float ${hidden ? "wa-hidden" : ""}`}
      href={wa.link()}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      title="Chat with us on WhatsApp"
    >
      <WhatsAppIcon size={28} />
    </a>
  );
}
