import type { Metadata } from "next";
import localFont from "next/font/local";
import { connection } from "next/server";
import type { ReactNode } from "react";
import "./globals.css";

const mono = localFont({
  src: "./fonts/jetbrains-mono-latin-wght-normal.woff2",
  weight: "100 800",
  variable: "--font-jetbrains-mono",
  display: "swap",
});
const sans = localFont({
  src: "./fonts/public-sans-latin-wght-normal.woff2",
  weight: "100 900",
  variable: "--font-public-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Vigil",
  description: "Monitoraggio dei dispositivi di rete",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Una pagina statica non avrebbe il nonce e la Content-Security-Policy ne bloccherebbe gli script
  await connection();
  return (
    <html lang="it" className={`${mono.variable} ${sans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
