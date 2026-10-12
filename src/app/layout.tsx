import type { Metadata } from "next";
import { Manrope } from "next/font/google";

import "./globals.css";

// Solo se expone como variable (--font-manrope): la usan las pantallas con la
// clase `font-decor`; el resto conserva su tipografía.
const manrope = Manrope({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-manrope",
});

export const metadata: Metadata = {
  title: "DecorAR",
  description: "Planea decoraciones y visualízalas en realidad aumentada.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={manrope.variable} lang="es">
      <body>{children}</body>
    </html>
  );
}
