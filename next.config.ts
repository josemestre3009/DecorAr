import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.trycloudflare.com"],
  // Solo en desarrollo: el indicador de Next tapaba la barra inferior (abajo) o
  // el menú de cuenta (arriba) del rediseño móvil. Los errores siguen saliendo.
  devIndicators: false,
  output: "standalone",
};

export default nextConfig;
