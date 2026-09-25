import { useConfig } from "../store";

/**
 * The shop's logo if it has uploaded one, otherwise its wordmark as plain
 * text. Replaces the `Ba<em>y</em>an` markup that was copy-pasted into the
 * header, footer and admin sidebar — a wordmark is now just a string.
 */
export default function Wordmark() {
  const { logo_url, wordmark, shop_name } = useConfig();
  if (logo_url) return <img className="logo-img" src={logo_url} alt={shop_name} />;
  return <>{wordmark || shop_name}</>;
}
