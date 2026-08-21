"use client";

import { useState } from "react";
import { useLang } from "@/lib/i18n";
import { Reveal } from "@/components/Reveal";

export function Contact() {
  const { t } = useLang();
  const [sent, setSent] = useState(false);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSent(true);
  };

  return (
    <section className="section" id="contact">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">{t("contact.eyebrow")}</span>
          <h2>{t("contact.title")}</h2>
          <p>{t("contact.subtitle")}</p>
        </div>

        <div className="contact-grid">
          <Reveal>
            <form className="form" onSubmit={onSubmit}>
              <label>
                {t("contact.name")}
                <input type="text" required placeholder="Max Mustermann" />
              </label>
              <label>
                {t("contact.email")}
                <input type="email" required placeholder="max@firma.de" />
              </label>
              <label>
                {t("contact.message")}
                <textarea placeholder="…" />
              </label>
              <button className="btn btn-primary" type="submit">
                {t("contact.send")}
              </button>
              {sent && (
                <p style={{ color: "var(--accent)" }}>{t("contact.sent")}</p>
              )}
            </form>
          </Reveal>

          <Reveal delay={90}>
            <div className="contact-info">
              <div className="info-item">
                <div className="label">{t("contact.emailLabel")}</div>
                <div className="value">{t("contact.emailVal")}</div>
              </div>
              <div className="info-item">
                <div className="label">{t("contact.phoneLabel")}</div>
                <div className="value">{t("contact.phoneVal")}</div>
              </div>
              <div className="info-item">
                <div className="label">{t("contact.addressLabel")}</div>
                <div className="value">{t("contact.addressVal")}</div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
