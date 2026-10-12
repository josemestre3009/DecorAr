import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import Home from "./page";

describe("Home", () => {
  it("identifica DecorAR y su propósito", () => {
    render(<Home />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Tu evento, tu realidad aumentada");
    expect(screen.getByRole("img", { name: "DecorAR" })).toBeVisible();
    expect(screen.getByText(/decora con muebles y adornos en 3D antes de reservar/i)).toBeVisible();
  });

  it("lleva al flujo de decoración y al inicio de sesión", () => {
    render(<Home />);

    expect(screen.getByRole("link", { name: "Empezar a Decorar" })).toHaveAttribute("href", "/packages");
    expect(screen.getByRole("link", { name: "Inicia Sesión" })).toHaveAttribute("href", "/login");
  });

  it("reproduce los videos del hero en bucle, sin sonido ni controles, WebM primero", () => {
    const { container } = render(<Home />);
    const videos = [...container.querySelectorAll("video")];

    // Vertical para celular y 16:9 para PC, cada uno con su poster.
    expect(videos.map((video) => video.getAttribute("poster"))).toEqual([
      "/landing/poster.webp",
      "/landing/poster-wide.webp",
    ]);

    for (const video of videos) {
      expect(video.autoplay).toBe(true);
      expect(video.muted).toBe(true);
      expect(video.loop).toBe(true);
      expect(video.hasAttribute("playsinline")).toBe(true);
      expect(video.controls).toBe(false);
      expect(video.getAttribute("preload")).toBe("metadata");
      expect([...video.querySelectorAll("source")].map((source) => source.type)).toEqual([
        "video/webm",
        "video/mp4",
      ]);
    }
  });
});
