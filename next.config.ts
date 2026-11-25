import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Solo en desarrollo: abajo a la izquierda tapaba la pestaña "Evento" de la
  // barra inferior del rediseño móvil.
  devIndicators: { position: "top-right" },
  output: "standalone",
};

export default nextConfig;
