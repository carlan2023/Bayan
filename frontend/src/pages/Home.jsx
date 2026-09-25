import { Link } from "react-router-dom";
import { usePageTitle } from "../usePageTitle";
import { api } from "../api";
import { useConfig, useCopy } from "../store";
import { useAsync } from "../useAsync";
import ProductCard from "../components/ProductCard";
import ErrorState from "../components/ErrorState";
import WhatsAppFloat from "../components/WhatsAppFloat";
import { departmentBackground, useDepartments } from "../components/departments";

/**
 * Departments with products, in the owner's configured order; categories the
 * settings don't list yet (a fresh import) follow alphabetically rather than
 * disappearing.
 */
function orderedCategories(cats, departments) {
  const rank = new Map(departments.map((d, i) => [d.name.toLowerCase(), i]));
  return [...cats].sort((a, b) => {
    const ra = rank.get(a.category.toLowerCase()) ?? Infinity;
    const rb = rank.get(b.category.toLowerCase()) ?? Infinity;
    return ra - rb || a.category.localeCompare(b.category);
  });
}

export default function Home() {
  usePageTitle(null);
  // Hero, perks and departments are the shop's own, from Admin → Settings.
  const { copy } = useConfig();
  const t = useCopy();
  const departments = useDepartments();
  const heroCopy = copy.hero || {};

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
  const cats = orderedCategories(data?.cats ?? [], departments);

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
            {heroCopy.eyebrow && <div className="eyebrow">{t(heroCopy.eyebrow)}</div>}
            <h1>
              {t(heroCopy.headline)}
              {heroCopy.headline_emphasis && <> <em>{t(heroCopy.headline_emphasis)}</em></>}
            </h1>
            {heroCopy.body && <p>{t(heroCopy.body)}</p>}
            <Link to="/shop" className="btn btn-accent">
              {t(heroCopy.cta) || "Shop now"}
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
                  to={`/shop?category=${encodeURIComponent(c.category)}`}
                  className="cat-card"
                  style={{ background: departmentBackground(departments, c.category) }}
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

      {copy.perks?.length > 0 && (
        <section className="section container">
          <div className="perks">
            {copy.perks.map((perk, i) => (
              <div className="perk" key={i}>
                <h3>{t(perk.title)}</h3>
                <p>{t(perk.body)}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      <WhatsAppFloat />
    </>
  );
}
