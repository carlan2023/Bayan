export default function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div>
          <div className="logo">
            Ba<em>y</em>an
          </div>
          <p style={{ maxWidth: 320, fontSize: "0.9rem" }}>
            Considered clothing and homeware. Made to last, priced to be lived in.
          </p>
        </div>
        <div style={{ fontSize: "0.9rem", lineHeight: 2 }}>
          <div>Cash on delivery, countrywide</div>
          <div>30-day easy returns</div>
          <div>support@bayan.example</div>
        </div>
      </div>
      <div className="container">
        <small>© {new Date().getFullYear()} Bayan. MVP demo — not a real store.</small>
      </div>
    </footer>
  );
}
