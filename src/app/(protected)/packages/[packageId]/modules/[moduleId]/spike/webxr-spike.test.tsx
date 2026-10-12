import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CatalogModuleDto } from "@/modules/catalog/application/dtos/catalog-module.dto";

import { WebXRSpike } from "./webxr-spike";

const moduleFixture: CatalogModuleDto = {
  areaM2: 4,
  assetId: "mesa",
  depthM: 2,
  glbUrl: "https://example.com/mesa.glb",
  heightM: 1,
  id: "m-1",
  name: "Mesa redonda",
  posterUrl: null,
  priceCop: 250000,
  usdzUrl: "https://example.com/mesa.usdz",
  version: 1,
  widthM: 2,
};

const fetcher = vi.fn<typeof fetch>(async () => Response.json([moduleFixture]));

afterEach(() => {
  cleanup();
  fetcher.mockClear();
});

describe("WebXRSpike", () => {
  it("degrada sin immersive-ar y no inicia el runtime", async () => {
    const startRuntime = vi.fn();
    render(
      <WebXRSpike
        fetcher={fetcher}
        moduleId="m-1"
        startRuntime={startRuntime}
        xr={{ isSessionSupported: async () => false }}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("no permite ejecutar");
    expect(screen.queryByRole("button", { name: "Iniciar prueba AR" })).not.toBeInTheDocument();
    expect(startRuntime).not.toHaveBeenCalled();
  });

  it("inicia, actualiza diagnóstico, gira y limpia al terminar", async () => {
    const rotate = vi.fn();
    const end = vi.fn(async () => undefined);
    const startRuntime = vi.fn(async (options: Parameters<NonNullable<React.ComponentProps<typeof WebXRSpike>["startRuntime"]>>[0]) => {
      options.onDiagnostics({
        domOverlay: true,
        fps: 58,
        grantedFeatures: "hit-test, dom-overlay",
        lastEvent: "selectstart:screen",
        objectCount: 3,
      });
      return { add: vi.fn(), end, rotate };
    });

    render(
      <WebXRSpike
        fetcher={fetcher}
        moduleId="m-1"
        startRuntime={startRuntime}
        xr={{ isSessionSupported: async () => true }}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Iniciar prueba AR" }));
    expect(await screen.findByText("58")).toBeInTheDocument();
    expect(screen.getByText("3/3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Girar 15 grados a la derecha" }));
    expect(rotate).toHaveBeenCalledWith(15);

    fireEvent.click(screen.getByRole("button", { name: "Terminar sesión" }));
    expect(end).toHaveBeenCalledOnce();
  });

  it("muestra el fallo de arranque y termina el runtime al desmontar", async () => {
    const failingStart = vi.fn(async () => {
      throw new Error("permiso denegado");
    });
    const first = render(
      <WebXRSpike
        fetcher={fetcher}
        moduleId="m-1"
        startRuntime={failingStart}
        xr={{ isSessionSupported: async () => true }}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar prueba AR" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudo iniciar");
    first.unmount();

    const end = vi.fn(async () => undefined);
    const second = render(
      <WebXRSpike
        fetcher={fetcher}
        moduleId="m-1"
        startRuntime={async () => ({ add: vi.fn(), end, rotate: vi.fn() })}
        xr={{ isSessionSupported: async () => true }}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar prueba AR" }));
    await screen.findByRole("button", { name: "Terminar sesión" });
    second.unmount();
    expect(end).toHaveBeenCalledOnce();
  });
});
