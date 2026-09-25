/**
 * What search engines and link previews see.
 *
 * The storefront is a single-page app, so without this every URL answers with
 * the same title and no description: a product shared on WhatsApp previews as
 * the shop's name and nothing else, and crawlers that don't run JavaScript see
 * an empty page. The server already knows the product behind /product/:slug,
 * so it writes the page's own title, description, canonical URL, Open Graph
 * tags and schema.org JSON-LD into the shell it sends (see shell.js).
 *
 * Pure: routing facts and documents in, meta out. Unit-tested.
 */

/** Client routes the SPA renders. Anything else is answered with a 404 status. */
const ROUTES = [
  /^\/$/,
  /^\/shop\/?$/,
  /^\/product\/[^/]+\/?$/,
  /^\/(cart|checkout|login|account|wishlist|track|forgot-password|reset-password|accept-invite)\/?$/,
  /^\/order\/[^/]+\/payment\/?$/,
  /^\/admin(\/.*)?$/,
];
export const isKnownRoute = (path) => ROUTES.some((rx) => rx.test(path));

/** Pages with nothing for a search engine (or with someone's data) are noindex. */
const PRIVATE = /^\/(admin|cart|checkout|login|account|wishlist|order|forgot-password|reset-password|accept-invite|track)(\/|$)/;
export const isPrivate = (path) => PRIVATE.test(path);

const clip = (s, n = 160) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).replace(/\s+\S*$/, "")}…` : t;
};

export const absolute = (base, url) => (!url ? null : /^https?:\/\//.test(url) ? url : `${base}${url.startsWith("/") ? "" : "/"}${url}`);

/** Fill {placeholders} the way the client's useCopy() does, for descriptions. */
function fill(text, settings) {
  const money = (c) => {
    try {
      return new Intl.NumberFormat(settings.locale, { style: "currency", currency: settings.currency, maximumFractionDigits: 0 }).format(c / 100);
    } catch {
      return String(c / 100);
    }
  };
  return String(text || "").replace(/\{(shop_name|free_delivery_threshold|delivery_fee)\}/g, (_, k) =>
    k === "shop_name" ? settings.shop_name : money(k === "delivery_fee" ? settings.delivery_fee_cents : settings.free_delivery_threshold_cents)
  );
}

/**
 * Meta for one request.
 * @param path      request path
 * @param query     request query ({ category })
 * @param settings  resolved shop settings
 * @param base      absolute origin, e.g. https://shop.example
 * @param product   the product for /product/:slug (or null when not found)
 * @returns { status, title, description, canonical, image, type, noindex, jsonLd[] }
 */
export function pageMeta({ path, query = {}, settings, base, product = null, heroImage = null }) {
  const shop = settings.shop_name;
  const defaults = {
    status: 200,
    title: settings.page_title || shop,
    description: clip(fill(settings.copy?.hero?.body || settings.copy?.footer_tagline, settings)),
    canonical: `${base}${path === "/" ? "/" : path.replace(/\/+$/, "")}`,
    image: absolute(base, settings.logo_url || heroImage),
    type: "website",
    noindex: isPrivate(path),
    jsonLd: [],
  };

  if (!isKnownRoute(path)) {
    return { ...defaults, status: 404, title: `Page not found · ${shop}`, noindex: true, canonical: null };
  }

  if (path === "/") {
    return {
      ...defaults,
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "Store",
          name: shop,
          url: `${base}/`,
          ...(settings.logo_url ? { logo: absolute(base, settings.logo_url) } : {}),
          ...(settings.support_email ? { email: settings.support_email } : {}),
          ...(settings.support_phone ? { telephone: settings.support_phone } : {}),
          currenciesAccepted: settings.currency,
        },
        {
          "@context": "https://schema.org",
          "@type": "WebSite",
          name: shop,
          url: `${base}/`,
          potentialAction: {
            "@type": "SearchAction",
            target: `${base}/shop?search={search_term_string}`,
            "query-input": "required name=search_term_string",
          },
        },
      ],
    };
  }

  if (/^\/shop\/?$/.test(path)) {
    const category = typeof query.category === "string" ? query.category : "";
    return {
      ...defaults,
      title: `${category || "All products"} · ${shop}`,
      canonical: `${base}/shop${category ? `?category=${encodeURIComponent(category)}` : ""}`,
      // Search result pages are thin duplicates of the catalogue.
      noindex: Boolean(query.search),
    };
  }

  if (/^\/product\//.test(path)) {
    if (!product) return { ...defaults, status: 404, title: `Product not found · ${shop}`, noindex: true, canonical: null };
    const url = `${base}/product/${product.slug}`;
    const images = [product.image, ...(product.colors || []).map((c) => c.image)].filter(Boolean).map((u) => absolute(base, u));
    const inStock = (product.variants || []).some((v) => v.stock > 0) || product.stock > 0;
    const prices = (product.variants || []).map((v) => (v.price_cents > 0 ? v.price_cents : product.price_cents));
    const low = Math.min(product.price_cents, ...prices);
    const high = Math.max(product.price_cents, ...prices);
    const offer = {
      "@type": low === high ? "Offer" : "AggregateOffer",
      priceCurrency: settings.currency,
      ...(low === high ? { price: (low / 100).toFixed(2) } : { lowPrice: (low / 100).toFixed(2), highPrice: (high / 100).toFixed(2), offerCount: prices.length }),
      availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      url,
      seller: { "@type": "Organization", name: shop },
    };
    return {
      ...defaults,
      title: `${product.name} · ${shop}`,
      description: clip(product.description),
      canonical: url,
      image: images[0] || defaults.image,
      type: "product",
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "Product",
          name: product.name,
          description: clip(product.description, 5000),
          ...(images.length ? { image: [...new Set(images)] } : {}),
          category: product.category,
          brand: { "@type": "Brand", name: shop },
          ...(product.variants?.[0]?.sku ? { sku: product.variants[0].sku } : {}),
          offers: offer,
        },
      ],
    };
  }

  return defaults;
}

const xml = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);

/** sitemap.xml: home, catalogue, each department with products, each product. */
export function sitemapXml(base, { products = [], categories = [] }) {
  const urls = [
    { loc: `${base}/` },
    { loc: `${base}/shop` },
    ...categories.map((c) => ({ loc: `${base}/shop?category=${encodeURIComponent(c)}` })),
    ...products.map((p) => ({ loc: `${base}/product/${p.slug}`, lastmod: p.updated_at ? new Date(p.updated_at).toISOString().slice(0, 10) : null })),
  ];
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${xml(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>`).join("\n") +
    `\n</urlset>\n`
  );
}

export const robotsTxt = (base) =>
  [
    "User-agent: *",
    "Allow: /",
    ...["/admin", "/api/", "/cart", "/checkout", "/account", "/wishlist", "/order/", "/login", "/track", "/reset-password", "/accept-invite", "/forgot-password"].map((p) => `Disallow: ${p}`),
    "",
    `Sitemap: ${base}/sitemap.xml`,
    "",
  ].join("\n");
