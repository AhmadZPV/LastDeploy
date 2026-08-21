"use client";

import { useLang } from "@/lib/i18n";
import { Reveal } from "@/components/Reveal";

const FEATURES = [
  { icon: "📒", title: "feat.accounting.title", desc: "feat.accounting.desc" },
  { icon: "🔥", title: "feat.settlement.title", desc: "feat.settlement.desc" },
  { icon: "🏢", title: "feat.buildings.title", desc: "feat.buildings.desc" },
  { icon: "📦", title: "feat.inventory.title", desc: "feat.inventory.desc" },
  { icon: "🧾", title: "feat.orders.title", desc: "feat.orders.desc" },
  { icon: "👥", title: "feat.addresses.title", desc: "feat.addresses.desc" },
  { icon: "📱", title: "feat.portal.title", desc: "feat.portal.desc" },
  { icon: "📊", title: "feat.reports.title", desc: "feat.reports.desc" },
  { icon: "🔐", title: "feat.security.title", desc: "feat.security.desc" },
];

export function Features() {
  const { t } = useLang();

  return (
    <section className="section" id="features">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">{t("features.eyebrow")}</span>
          <h2>{t("features.title")}</h2>
          <p>{t("features.subtitle")}</p>
        </div>
        <div className="feature-grid">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title} className="feature-card" delay={(i % 3) * 80}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{t(f.title)}</h3>
              <p>{t(f.desc)}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
