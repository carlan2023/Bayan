import { Link } from "react-router-dom";
import { api } from "../api";
import { useConfig, useMoney } from "../store";
import { useAsync } from "../useAsync";
import ProductCard from "../components/ProductCard";
import ErrorState from "../components/ErrorState";
import WhatsAppFloat from "../components/WhatsAppFloat";

const CAT_COLORS = {
  Women: "linear-gradient(135deg, #2e4b3f, #4a6b5a)",
  Men: "linear-gradient(135deg, #22303a, #40566b)",
  Kids: "linear-gradient(135deg, #b06a4d, #cf8a66)",
  Accessories: "linear-gradient(135deg, #6e5a43, #c9a24b)",
};

export default function Home() {
  const money = useMoney();
  const { free_delivery_threshold_cents, delivery_fee_cents } = useConfig();

  // One fetch for both strips: if either fails the page says so instead of
  // silently rendering empty grids under their headings.
  const { data, error, loading, reload } = useAsync(
    () =>
      Promise.all([api.products({ featured: 1, limit: 8 }), api.categories()]).then(
        ([f, c]) => ({ featured: f.products, cats: c.categories })
      ),
    []
  );
  const featured = data?.featured ?? [];
  const cats = data?.cats ?? [];

  // Hero media is set by the admin (Storefront page); the gradient is the
  // fallback, so a failed fetch just means the default look.
  const { data: heroData } = useAsync(() => api.hero().catch(() => ({ hero: null })), []);
  const hero = heroData?.hero ?? null;
  const heroMediaStyle = hero
    ? {
        objectPosition: `${hero.x}% ${hero.y}%`,
        transform: `scale(${hero.zoom})`,
        transformOrigin: `${hero.x}% ${hero.y}%`,
      }
    : undefined;

  return (
    <>
      <div className="container">
        <section className={`hero ${hero ? "has-media" : ""}`}>
          {hero &&
            (hero.media_type === "video" ? (
              <video
                className="hero-media"
                src={hero.url}
                style={heroMediaStyle}
                autoPlay
                muted
                loop
                playsInline
              />
            ) : (
              <img className="hero-media" src={hero.url} style={heroMediaStyle} alt="" />
            ))}
          {hero && <div className="hero-scrim" aria-hidden="true" />}

          <div className="hero-content">
            <div className="eyebrow">New season · SS26</div>
            <h1>
              Dress well. Live well. <em>Pay at your door.</em>
            </h1>
            <p>
              Considered clothing, jewellery and fragrance in natural fabrics and
              honest colours — delivered countrywide with cash on delivery.
            </p>
            <Link to="/shop" className="btn btn-accent">
              Shop the collection
            </Link>
          </div>
        </section>
      </div>

      {error ? (
        <section className="section container">
          <ErrorState
            title="We couldn't load the collection"
            message={error}
            onRetry={reload}
          />
        </section>
      ) : loading ? (
        <div className="spinner">Loading…</div>
      ) : (
        <>
          <section className="section container">
            <div className="section-head">
              <h2>Shop by department</h2>
            </div>
            <div className="grid-cats">
              {cats.map((c) => (
                <Link
                  key={c.category}
                  to={`/shop?category=${c.category}`}
                  className="cat-card"
                  style={{ background: CAT_COLORS[c.category] || CAT_COLORS.Accessories }}
                >
                  <h3>{c.category}</h3>
                  <span>{c.count} pieces</span>
                </Link>
              ))}
            </div>
          </section>

          {featured.length > 0 && (
            <section className="section container">
              <div className="section-head">
                <h2>Featured this week</h2>
                <Link to="/shop">View all</Link>
              </div>
              <div className="grid">
                {featured.map((p) => (
                  <ProductCard key={p.id} product={p} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      <section className="section container">
        <div className="perks">
          <div className="perk">
            <h3>Cash on delivery</h3>
            <p>
              Order now, pay when your parcel reaches your hands. No card
              required.
            </p>
          </div>
          <div className="perk">
            <h3>Free delivery over {money(free_delivery_threshold_cents)}</h3>
            <p>
              Flat {money(delivery_fee_cents)} delivery on smaller orders, anywhere in the
              country.
            </p>
          </div>
          <div className="perk">
            <h3>Genuine &amp; quality-checked</h3>
            <p>
              Every piece — from jewellery to fragrance — is sourced authentic
              and inspected before it ships.
            </p>
          </div>
        </div>
      </section>

      <WhatsAppFloat />
    </>
  );
}
