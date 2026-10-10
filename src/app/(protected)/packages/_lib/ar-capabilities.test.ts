import { describe, expect, it, vi } from "vitest";

import { detectarCapacidadesAR, detectarPlataforma } from "./ar-capabilities";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const PIXEL =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

describe("detectarPlataforma", () => {
  it.each([
    ["iPhone", { userAgent: IPHONE }, "ios"],
    ["iPadOS que se anuncia como Mac", { maxTouchPoints: 5, platform: "MacIntel", userAgent: MAC }, "ios"],
    ["Mac de escritorio", { maxTouchPoints: 0, platform: "MacIntel", userAgent: MAC }, "otra"],
    ["Android", { userAgent: PIXEL }, "android"],
    ["Windows", { userAgent: WINDOWS }, "otra"],
  ] as const)("%s → %s", (_caso, nav, esperado) => {
    expect(detectarPlataforma(nav)).toBe(esperado);
  });
});

describe("detectarCapacidadesAR", () => {
  it("consulta WebXR immersive-ar", async () => {
    const isSessionSupported = vi.fn().mockResolvedValue(true);

    await expect(
      detectarCapacidadesAR({ userAgent: WINDOWS, xr: { isSessionSupported } }),
    ).resolves.toEqual({ plataforma: "otra", webxr: true });
    expect(isSessionSupported).toHaveBeenCalledWith("immersive-ar");
  });

  it("sin navigator.xr no hay WebXR", async () => {
    await expect(detectarCapacidadesAR({ userAgent: PIXEL })).resolves.toEqual({
      plataforma: "android",
      webxr: false,
    });
  });

  it("si WebXR falla, sigue sin AR web en vez de romper la pantalla", async () => {
    const isSessionSupported = vi.fn().mockRejectedValue(new Error("SecurityError"));

    await expect(
      detectarCapacidadesAR({ userAgent: IPHONE, xr: { isSessionSupported } }),
    ).resolves.toEqual({ plataforma: "ios", webxr: false });
  });
});
