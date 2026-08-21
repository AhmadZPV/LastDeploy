"use client";

import { useLang } from "@/lib/i18n";

export function Hero() {
  const { t } = useLang();

  return (
    <header className="hero" id="top">
      <div className="container hero-inner">
        <span className="badge">
          <span className="dot" />
          {t("hero.badge")}
        </span>
        <h1>
          <span className="gradient-text">{t("hero.title")}</span>
        </h1>
        <p className="lede">{t("hero.subtitle")}</p>
        <div className="hero-actions">
          <a className="btn btn-primary" href="#contact">
            {t("hero.ctaPrimary")}
          </a>
          <a className="btn btn-ghost" href="#dashboard">
            {t("hero.ctaSecondary")}
          </a>
        </div>

        <div className="command-bar">
          <div className="cb-copy">
            <h3>{t("dash.eyebrow")}</h3>
            <p>{t("dash.subtitle")}</p>
          </div>
          <div className="cb-actions">
            <a className="btn btn-ghost" href="#features">
              {t("nav.features")}
            </a>
            <a className="btn btn-primary" href="#pricing">
              {t("nav.pricing")}
            </a>
          </div>
        </div>

        <div className="hero-stats">
          <div className="stat">
            <div className="num">12+</div>
            <div className="lbl">{t("hero.stat1")}</div>
          </div>
          <div className="stat">
            <div className="num">40+</div>
            <div className="lbl">{t("hero.stat2")}</div>
          </div>
          <div className="stat">
            <div className="num">500+</div>
            <div className="lbl">{t("hero.stat3")}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
