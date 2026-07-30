import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtPrice } from "../api";
import { useConfig } from "../store";
import ProductCard from "../components/ProductCard";

const CAT_COLORS = {
  Women: "linear-gradient(135deg, #2e4b3f, #4a6b5a)",
  Men: "linear-gradient(135deg, #22303a, #40566b)",
  Kids: "linear-gradient(135deg, #b06a4d, #cf8a66)",
  Accessories: "linear-gradient(135deg, #6e5a43, #c9a24b)",
};

export default function Home() {
  const { free_delivery_threshold_cents, delivery_fee_cents } = useConfig();
  const [featured, setFeatured] = useState([]);
  const [cats, setCats] = useState([]);

  useEffect(() => {
    api
      .products({ featured: 1, limit: 8 })
      .then((d) => setFeatured(d.products));
    api.categories().then((d) => setCats(d.categories));
  }, []);

  return (
    <>
      <div className="container">
        <section className="hero">
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
        </section>
      </div>

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
            <h3>Free delivery over {fmtPrice(free_delivery_threshold_cents)}</h3>
            <p>
              Flat {fmtPrice(delivery_fee_cents)} delivery on smaller orders, anywhere in the
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
    </>
  );
}
