import { useEffect } from "react";
import { useConfig } from "./store";

/**
 * Per-page document titles ("Linen Wrap Dress · Bayan"). Screen readers
 * announce the title on navigation in a single-page app only if it changes,
 * and it is what a shared link and a browser tab show. With no part, the
 * shop's own page title from settings.
 */
export function usePageTitle(part) {
  const { page_title, shop_name } = useConfig();
  useEffect(() => {
    document.title = part ? `${part} · ${shop_name}` : page_title || shop_name;
  }, [part, page_title, shop_name]);
}
