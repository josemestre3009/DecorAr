import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "DecorAR",
  description: "Planea decoraciones y visualízalas en realidad aumentada.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
