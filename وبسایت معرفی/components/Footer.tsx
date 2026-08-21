"use client";

import { useLang } from "@/lib/i18n";

export function Footer() {
  const { t } = useLang();
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-grid">
          <div>
            <div className="brand" style={{ marginBottom: 6 }}>
              <span className="brand-logo">I</span>
              ImmoPro
            </div>
            <p className="tag">{t("footer.tagline")}</p>
          </div>
          <div>
            <h4>{t("footer.product")}</h4>
            <ul>
              <li>
                <a href="#features">{t("nav.features")}</a>
              </li>
              <li>
                <a href="#dashboard">{t("nav.dashboard")}</a>
              </li>
              <li>
                <a href="#pricing">{t("nav.pricing")}</a>
              </li>
            </ul>
          </div>
          <div>
            <h4>{t("footer.company")}</h4>
            <ul>
              <li>
                <a href="#">{t("footer.about")}</a>
              </li>
              <li>
                <a href="#">{t("footer.blog")}</a>
              </li>
              <li>
                <a href="#">{t("footer.careers")}</a>
              </li>
            </ul>
          </div>
          <div>
            <h4>{t("footer.legal")}</h4>
            <ul>
              <li>
                <a href="#">{t("footer.privacy")}</a>
              </li>
              <li>
                <a href="#">{t("footer.terms")}</a>
              </li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          © {year} ImmoPro. {t("footer.rights")}
        </div>
      </div>
    </footer>
  );
}
