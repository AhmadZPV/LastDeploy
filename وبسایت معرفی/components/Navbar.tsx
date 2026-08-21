"use client";

import { useLang } from "@/lib/i18n";

export function Navbar() {
  const { t, lang, setLang } = useLang();

  return (
    <nav className="nav">
      <div className="container nav-inner">
        <a className="brand" href="#top">
          <span className="brand-logo">I</span>
          ImmoPro
        </a>

        <div className="nav-links">
          <a href="#features">{t("nav.features")}</a>
          <a href="#dashboard">{t("nav.dashboard")}</a>
          <a href="#pricing">{t("nav.pricing")}</a>
          <a href="#contact">{t("nav.contact")}</a>
        </div>

        <div className="nav-right">
          <div className="lang-switch" aria-label={t("lang.label")}>
            <button
              className={lang === "de" ? "active" : ""}
              onClick={() => setLang("de")}
            >
              DE
            </button>
            <button
              className={lang === "en" ? "active" : ""}
              onClick={() => setLang("en")}
            >
              EN
            </button>
          </div>
          <a className="btn btn-primary" href="#contact">
            {t("nav.cta")}
          </a>
        </div>
      </div>
    </nav>
  );
}
