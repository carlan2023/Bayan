import { useConfig, useCopy } from "../store";
import Wordmark from "./Wordmark";

/** Footer copy, promises and contact details all come from the shop's settings. */
export default function Footer() {
  const { shop_name, copy, support_email, support_phone } = useConfig();
  const t = useCopy();
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <div>
          <div className="logo">
            <Wordmark />
          </div>
          {copy.footer_tagline && <p className="footer-tagline">{t(copy.footer_tagline)}</p>}
        </div>
        <div className="footer-promises">
          {(copy.footer_promises || []).map((line) => (
            <div key={line}>{t(line)}</div>
          ))}
          {support_email && (
            <div>
              <a href={`mailto:${support_email}`}>{support_email}</a>
            </div>
          )}
          {support_phone && (
            <div>
              <a href={`tel:${support_phone.replace(/\s+/g, "")}`}>{support_phone}</a>
            </div>
          )}
        </div>
      </div>
      <div className="container">
        <small>
          © {new Date().getFullYear()} {shop_name}
        </small>
      </div>
    </footer>
  );
}
