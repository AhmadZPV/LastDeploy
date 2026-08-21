"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Lang = "de" | "en";

type Dict = Record<string, { de: string; en: string }>;

export const dict: Dict = {
  // Nav
  "nav.features": { de: "Funktionen", en: "Features" },
  "nav.dashboard": { de: "Dashboard", en: "Dashboard" },
  "nav.pricing": { de: "Preise", en: "Pricing" },
  "nav.contact": { de: "Kontakt", en: "Contact" },
  "nav.cta": { de: "Demo anfragen", en: "Request demo" },
  "lang.label": { de: "Sprache", en: "Language" },
  "lang.de": { de: "Deutsch", en: "German" },
  "lang.en": { de: "Englisch", en: "English" },

  // Hero
  "hero.badge": {
    de: "Moderne Hausverwaltungs-Software",
    en: "Modern property management software",
  },
  "hero.title": {
    de: "Alles für Ihre Hausverwaltung – in einer Plattform",
    en: "Everything for your property management – in one platform",
  },
  "hero.subtitle": {
    de: "ImmoPro vereint doppelte Buchführung, Nebenkostenabrechnung, Gebäudeverwaltung, Inventar und ein Mieter-Portal – DSGVO-bewusst, revisionssicher und vollständig mehrsprachig.",
    en: "ImmoPro unifies double-entry accounting, utility settlement, building & unit management, inventory and a tenant portal – privacy-aware, audit-ready and fully bilingual.",
  },
  "hero.ctaPrimary": { de: "Kostenlos testen", en: "Try for free" },
  "hero.ctaSecondary": { de: "Live-Demo ansehen", en: "Watch live demo" },
  "hero.stat1": { de: "Module", en: "Modules" },
  "hero.stat2": { de: "Jahresberichte", en: "Annual reports" },
  "hero.stat3": { de: "Mandate", en: "Mandates" },

  // Features intro
  "features.eyebrow": { de: "Leistungsumfang", en: "Capabilities" },
  "features.title": {
    de: "Eine Software für jede Aufgabe der Verwaltung",
    en: "One platform for every management task",
  },
  "features.subtitle": {
    de: "Von der Buchung bis zur Betriebskostenabrechnung – ImmoPro deckt den gesamten Lebenszyklus Ihrer Objekte ab.",
    en: "From bookings to utility settlement – ImmoPro covers the full lifecycle of your properties.",
  },

  // Feature groups
  "feat.accounting.title": {
    de: "Doppelte Buchführung",
    en: "Double-entry accounting",
  },
  "feat.accounting.desc": {
    de: "Buchungsassistent, Journale, Schnellbuchungen, Banking-Import und DATEV-Export. Inklusive Gewinn/Verlust und Umsatzsteuervoranmeldung.",
    en: "Booking assistant, journals, quick entries, bank import and DATEV export. Including profit/loss and VAT preliminary returns.",
  },
  "feat.settlement.title": {
    de: "Nebenkosten & Heizkosten",
    en: "Utility & heating settlement",
  },
  "feat.settlement.desc": {
    de: "Betriebskosten-, Heizkosten- und Umlagenabrechnung, Vorauszahlungen, Rücklagen und §35a EStG – automatisch und gesetzeskonform.",
    en: "Operating cost, heating and apportionment settlement, advances, reserves and §35a EStG – automated and compliant.",
  },
  "feat.buildings.title": { de: "Gebäude & Einheiten", en: "Buildings & units" },
  "feat.buildings.desc": {
    de: "Objekte, Einheiten, Räume, Zähler und Flächen zentral verwalten – inkl. WEG-Stimmrechten und Eigentümerlisten.",
    en: "Manage objects, units, rooms, meters and areas centrally – including WEG voting rights and owner lists.",
  },
  "feat.inventory.title": { de: "Inventar & Anlagen", en: "Inventory & assets" },
  "feat.inventory.desc": {
    de: "Vollständiges Inventar mit Ausleihen, Etiketten, Datenblättern und Bildern – ideal für Großobjekte und Gemeinschaftseigentum.",
    en: "Full inventory with lending, labels, data sheets and images – ideal for large properties and common property.",
  },
  "feat.orders.title": { de: "Aufträge & Rechnungen", en: "Orders & invoices" },
  "feat.orders.desc": {
    de: "Angebote, Rechnungen und Umsatzauswertungen erstellen – mit PDF- und Excel-Export für die Buchhaltung.",
    en: "Create quotes, invoices and revenue analyses – with PDF and Excel export for accounting.",
  },
  "feat.addresses.title": { de: "Adressen & Kontakte", en: "Addresses & contacts" },
  "feat.addresses.desc": {
    de: "Zentrale Adressverwaltung mit Kerndaten, vertraulichen Notizen und vCard-Import – alles an einem Ort.",
    en: "Central address management with core data, confidential notes and vCard import – all in one place.",
  },
  "feat.portal.title": { de: "Mieter-Portal", en: "Tenant portal" },
  "feat.portal.desc": {
    de: "Mieter sehen Abrechnungen, melden Schäden und erhalten Mitteilungen – bequem per Smartphone, auch offline (PWA).",
    en: "Tenants view statements, report faults and receive messages – conveniently from a smartphone, even offline (PWA).",
  },
  "feat.reports.title": { de: "Dashboards & Berichte", en: "Dashboards & reports" },
  "feat.reports.desc": {
    de: "Einnahmen/Ausgaben, Kostenverteilung und Leerstandsquote als Live-Charts – plus druckfertige PDF-Berichte.",
    en: "Income/expense, cost distribution and vacancy rate as live charts – plus print-ready PDF reports.",
  },
  "feat.security.title": { de: "Sicherheit & Rechte", en: "Security & rights" },
  "feat.security.desc": {
    de: "Feingranulare Rechte, Team-Scope, Audit-Log und Datensatzsperren – revisionssicher und mandantenfähig.",
    en: "Granular permissions, team scope, audit log and record locking – audit-ready and multi-tenant.",
  },

  // Dashboard section
  "dash.eyebrow": { de: "Live-Übersicht", en: "Live overview" },
  "dash.title": {
    de: "Ihr gesamtes Portfolio auf einen Blick",
    en: "Your entire portfolio at a glance",
  },
  "dash.subtitle": {
    de: "Interaktive Dashboards verbinden Buchhaltung, Objekte und Mieter in Echtzeit.",
    en: "Interactive dashboards connect accounting, properties and tenants in real time.",
  },
  "dash.card1.title": { de: "Liquidität", en: "Liquidity" },
  "dash.card1.value": { de: "+ 8,4 %", en: "+ 8.4 %" },
  "dash.card1.sub": { de: "ggü. Vorjahr", en: "vs. last year" },
  "dash.card2.title": { de: "Offene Posten", en: "Open items" },
  "dash.card2.value": { de: "12", en: "12" },
  "dash.card2.sub": { de: "Mandate", en: "mandates" },
  "dash.card3.title": { de: "Leerstand", en: "Vacancy" },
  "dash.card3.value": { de: "3,1 %", en: "3.1 %" },
  "dash.card3.sub": { de: "Portfolio", en: "portfolio" },
  "dash.chart.title": { de: "Einnahmen vs. Ausgaben", en: "Income vs. expenses" },
  "dash.chart.note": {
    de: "Automatisch aus dem Kontobuch aggregiert.",
    en: "Automatically aggregated from the ledger.",
  },

  // Pricing
  "pricing.eyebrow": { de: "Tarife", en: "Plans" },
  "pricing.title": {
    de: "Transparente Preise für jede Größe",
    en: "Transparent pricing for any size",
  },
  "pricing.subtitle": {
    de: "Alle Tarife enthalten das Mieter-Portal und kostenlose Updates.",
    en: "All plans include the tenant portal and free updates.",
  },
  "pricing.perMonth": { de: "/ Monat", en: "/ month" },
  "pricing.cta": { de: "Jetzt starten", en: "Get started" },
  "pricing.mostPopular": { de: "Beliebt", en: "Popular" },
  "pricing.t1.name": { de: "Starter", en: "Starter" },
  "pricing.t1.price": { de: "49 €", en: "49 €" },
  "pricing.t1.desc": {
    de: "Für kleine Verwaltungen mit bis zu 50 Einheiten.",
    en: "For small managers with up to 50 units.",
  },
  "pricing.t2.name": { de: "Professional", en: "Professional" },
  "pricing.t2.price": { de: "129 €", en: "129 €" },
  "pricing.t2.desc": {
    de: "Für wachsende Verwaltungen mit doppelter Buchführung.",
    en: "For growing managers with double-entry accounting.",
  },
  "pricing.t3.name": { de: "Enterprise", en: "Enterprise" },
  "pricing.t3.price": { de: "Auf Anfrage", en: "On request" },
  "pricing.t3.desc": {
    de: "Für WEG-Verwalter mit unbegrenzten Mandaten & SLA.",
    en: "For WEG managers with unlimited mandates & SLA.",
  },
  "pricing.f1": { de: "Gebäude- & Einheitenverwaltung", en: "Building & unit management" },
  "pricing.f2": { de: "Nebenkostenabrechnung", en: "Utility settlement" },
  "pricing.f3": { de: "Mieter-Portal", en: "Tenant portal" },
  "pricing.f4": { de: "Doppelte Buchführung + DATEV", en: "Double-entry + DATEV" },
  "pricing.f5": { de: "Mehrere Mandate & Teams", en: "Multiple mandates & teams" },
  "pricing.f6": { de: "Persönlicher Ansprechpartner & SLA", en: "Dedicated contact & SLA" },

  // Contact
  "contact.eyebrow": { de: "Kontakt", en: "Contact" },
  "contact.title": {
    de: "Bereit, Ihre Verwaltung zu modernisieren?",
    en: "Ready to modernize your management?",
  },
  "contact.subtitle": {
    de: "Vereinbaren Sie eine unverbindliche Demo – wir zeigen Ihnen ImmoPro an Ihren Daten.",
    en: "Book a no-obligation demo – we'll show you ImmoPro on your data.",
  },
  "contact.name": { de: "Name", en: "Name" },
  "contact.email": { de: "E-Mail", en: "Email" },
  "contact.message": { de: "Nachricht", en: "Message" },
  "contact.send": { de: "Anfrage senden", en: "Send inquiry" },
  "contact.sent": {
    de: "Danke! Wir melden uns in Kürze.",
    en: "Thanks! We'll get back to you shortly.",
  },
  "contact.emailLabel": { de: "E-Mail", en: "Email" },
  "contact.phoneLabel": { de: "Telefon", en: "Phone" },
  "contact.addressLabel": { de: "Adresse", en: "Address" },
  "contact.emailVal": { de: "hallo@immopro.app", en: "hello@immopro.app" },
  "contact.phoneVal": { de: "+49 30 1234567", en: "+49 30 1234567" },
  "contact.addressVal": {
    de: "Musterstraße 12, 10115 Berlin",
    en: "Sample St. 12, 10115 Berlin",
  },

  // Footer
  "footer.tagline": {
    de: "Die moderne Hausverwaltungs-Software aus Deutschland.",
    en: "The modern property management software from Germany.",
  },
  "footer.product": { de: "Produkt", en: "Product" },
  "footer.company": { de: "Unternehmen", en: "Company" },
  "footer.legal": { de: "Rechtliches", en: "Legal" },
  "footer.rights": {
    de: "Alle Rechte vorbehalten.",
    en: "All rights reserved.",
  },
  "footer.privacy": { de: "Datenschutz", en: "Privacy" },
  "footer.terms": { de: "Impressum", en: "Imprint" },
  "footer.about": { de: "Über uns", en: "About" },
  "footer.blog": { de: "Blog", en: "Blog" },
  "footer.careers": { de: "Karriere", en: "Careers" },
};

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
};

const LanguageContext = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("de");

  useEffect(() => {
    const saved = window.localStorage.getItem("immopro-lang");
    if (saved === "de" || saved === "en") setLangState(saved);
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    window.localStorage.setItem("immopro-lang", l);
  };

  const t = (key: string) => dict[key]?.[lang] ?? key;

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLang() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLang must be used inside LanguageProvider");
  return ctx;
}
