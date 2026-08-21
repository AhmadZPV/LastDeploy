"use client";

import { LiquidGlass } from "@/components/LiquidGlass";
import { useLang } from "@/lib/i18n";
import { Reveal } from "@/components/Reveal";

const QUIET_OPTICS = {
  strength: 0.16,
  curvature: 0.24,
  dispersion: 0.16,
  sheen: 0.5,
  frost: 0,
  brightness: 0.04,
  specular: 0.85,
};

const TIERS = [
  {
    name: "pricing.t1.name",
    price: "pricing.t1.price",
    desc: "pricing.t1.desc",
    popular: false,
    features: ["pricing.f1", "pricing.f2", "pricing.f3"],
  },
  {
    name: "pricing.t2.name",
    price: "pricing.t2.price",
    desc: "pricing.t2.desc",
    popular: true,
    features: ["pricing.f1", "pricing.f2", "pricing.f3", "pricing.f4", "pricing.f5"],
  },
  {
    name: "pricing.t3.name",
    price: "pricing.t3.price",
    desc: "pricing.t3.desc",
    popular: false,
    features: [
      "pricing.f1",
      "pricing.f2",
      "pricing.f3",
      "pricing.f4",
      "pricing.f5",
      "pricing.f6",
    ],
  },
];

export function Pricing() {
  const { t } = useLang();
  const allFeatures = [
    "pricing.f1",
    "pricing.f2",
    "pricing.f3",
    "pricing.f4",
    "pricing.f5",
    "pricing.f6",
  ];

  return (
    <section className="section" id="pricing">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">{t("pricing.eyebrow")}</span>
          <h2>{t("pricing.title")}</h2>
          <p>{t("pricing.subtitle")}</p>
        </div>

        <div className="pricing-grid">
          {TIERS.map((tier, i) => {
            const inner = (
              <>
                {tier.popular && (
                  <span className="popular-tag">{t("pricing.mostPopular")}</span>
                )}
                <h3>{t(tier.name)}</h3>
                <div className="price">
                  {t(tier.price)} <small>{t("pricing.perMonth")}</small>
                </div>
                <p className="p-desc">{t(tier.desc)}</p>
                <ul className="price-list">
                  {allFeatures.map((f) => {
                    const on = tier.features.includes(f);
                    return (
                      <li key={f} className={on ? "" : "off"}>
                        <span className="tick">{on ? "✓" : "✕"}</span>
                        {t(f)}
                      </li>
                    );
                  })}
                </ul>
                <a className="btn btn-primary" href="#contact">
                  {t("pricing.cta")}
                </a>
              </>
            );

            if (tier.popular) {
              return (
                <LiquidGlass
                  key={tier.name}
                  optics={QUIET_OPTICS}
                  radius={14}
                  className="price-card popular"
                >
                  {inner}
                </LiquidGlass>
              );
            }
            return (
              <Reveal key={tier.name} className="price-card" delay={i * 80}>
                {inner}
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
