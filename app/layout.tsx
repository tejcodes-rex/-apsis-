import type { Metadata } from "next";
import { Space_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const sans = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "APSIS — Autonomous Space Traffic Management",
  description:
    "Real-time conjunction screening, collision-probability assessment, and autonomous avoidance maneuver planning for objects in Earth orbit. Built on live NORAD data and SGP4 propagation.",
  keywords: [
    "space traffic management",
    "conjunction screening",
    "collision avoidance",
    "orbital mechanics",
    "SGP4",
    "space debris",
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="bg-vacuum-grid min-h-screen antialiased">{children}</body>
    </html>
  );
}
