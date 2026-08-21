import type { Metadata } from "next";
import { Outfit, Newsreader } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/lib/i18n";
import { ServiceWorkerCleanup } from "@/components/ServiceWorkerCleanup";

const outfit = Outfit({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-outfit",
  display: "swap",
});

const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal"],
  variable: "--font-newsreader",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ImmoPro – Moderne Hausverwaltungs-Software",
  description:
    "ImmoPro vereint doppelte Buchführung, Nebenkostenabrechnung, Gebäudeverwaltung, Inventar und ein Mieter-Portal in einer Plattform.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de" className={`${outfit.variable} ${newsreader.variable}`}>
      <body>
        <LanguageProvider>{children}</LanguageProvider>
        <ServiceWorkerCleanup />
      </body>
    </html>
  );
}
