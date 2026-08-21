"use client";

import { useEffect, useRef, useState } from "react";
import { useLang } from "@/lib/i18n";
import { Reveal } from "@/components/Reveal";
import { Counter } from "@/components/Counter";

const BARS = [55, 70, 45, 80, 62, 90, 75];

export function Dashboard() {
  const { t } = useLang();
  const barsRef = useRef<HTMLDivElement>(null);
  const [barsVisible, setBarsVisible] = useState(false);

  useEffect(() => {
    const el = barsRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setBarsVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setBarsVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section className="section dash" id="dashboard">
      <div className="container">
        <div className="section-head">
          <span className="eyebrow">{t("dash.eyebrow")}</span>
          <h2>{t("dash.title")}</h2>
          <p>{t("dash.subtitle")}</p>
        </div>

        <div className="dash-grid">
          <Reveal className="panel glass">
            <h3>{t("dash.chart.title")}</h3>
            <p className="sub">{t("dash.chart.note")}</p>
            <div className="bars" ref={barsRef}>
              {BARS.map((h, i) => (
                <div
                  key={i}
                  className={`bar ${i % 2 === 1 ? "alt" : ""}`}
                  style={{
                    height: barsVisible ? `${h}%` : "0%",
                    transitionDelay: `${i * 70}ms`,
                  }}
                />
              ))}
            </div>
            <div className="legend">
              <span className="l1">{t("dash.card1.title")}</span>
              <span className="l2">{t("hero.stat2")}</span>
            </div>
          </Reveal>

          <Reveal className="panel" delay={90}>
            <h3>{t("dash.eyebrow")}</h3>
            <p className="sub">{t("dash.subtitle")}</p>
            <div className="kpi-row">
              <div className="kpi">
                <div className="k-title">{t("dash.card1.title")}</div>
                <div className="k-val">
                  <Counter to={8.4} decimals={1} prefix="+ " suffix=" %" />
                </div>
                <div className="k-sub">{t("dash.card1.sub")}</div>
              </div>
              <div className="kpi">
                <div className="k-title">{t("dash.card2.title")}</div>
                <div className="k-val">
                  <Counter to={12} decimals={0} />
                </div>
                <div className="k-sub">{t("dash.card2.sub")}</div>
              </div>
              <div className="kpi">
                <div className="k-title">{t("dash.card3.title")}</div>
                <div className="k-val">
                  <Counter to={3.1} decimals={1} suffix=" %" />
                </div>
                <div className="k-sub">{t("dash.card3.sub")}</div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
