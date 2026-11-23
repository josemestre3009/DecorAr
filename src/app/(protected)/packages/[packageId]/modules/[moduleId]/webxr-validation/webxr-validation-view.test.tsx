import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogModuleDto } from "@/modules/catalog/application/dtos/catalog-module.dto";
import { WebXRValidationView } from "./webxr-validation-view";

const MODULE_FIXTURE: CatalogModuleDto = {
  areaM2: 2.38,
  assetId: "mesa",
  depthM: 1.19,
  glbUrl: "https://res.cloudinary.com/decorar/image/upload/v1/mesa.glb",
  heightM: 0.94,
  id: "mod-mesa",
  name: "Mesa principal",
  posterUrl: "https://res.cloudinary.com/decorar/image/upload/v1/poster.webp",
  priceCop: 350000,
  usdzUrl: "https://res.cloudinary.com/decorar/image/upload/v1/mesa.usdz",
  version: 2,
  widthM: 2,
};

function createMockFetcher(module: CatalogModuleDto = MODULE_FIXTURE): typeof fetch {
  return vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/modules")) {
      return {
        headers: new Headers({ "content-type": "application/json" }),
        json: async () => [module],
        ok: true,
        status: 200,
      } as unknown as Response;
    }
    return { ok: false, status: 404 } as unknown as Response;
  });
}

type StartRuntime = ComponentProps<typeof WebXRValidationView>["startRuntime"];

describe("WebXRValidationView (ciclo de vida y degradación)", () => {
  beforeEach(() => {
    vi.stubGlobal("isSecureContext", true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("muestra estado de carga inicialmente y luego degradación si WebXR immersive-ar no está disponible", async () => {
    const xr = {
      isSessionSupported: vi.fn().mockResolvedValue(false),
    };

    render(
      <WebXRValidationView
        fetcher={createMockFetcher()}
        moduleId="mod-mesa"
        packageId="pkg-1"
        xr={xr}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Comprobando soporte WebXR immersive-ar…");

    await waitFor(() => {
      expect(
        screen.getByText(
          /Este navegador o dispositivo no permite ejecutar sesiones WebXR immersive-ar con hit-test\./i,
        ),
      ).toBeInTheDocument();
    });

    // Muestra enlace de respaldo al visor 3D individual existente
    const fallbackLink = screen.getByRole("link", { name: "Ir al visor 3D individual" });
    expect(fallbackLink).toHaveAttribute("href", "/packages/pkg-1/modules/mod-mesa");
    expect(screen.queryByRole("button", { name: "Iniciar sesión AR" })).not.toBeInTheDocument();
  });

  it("permite iniciar sesión AR cuando WebXR immersive-ar está soportado", async () => {
    const xr = {
      isSessionSupported: vi.fn().mockResolvedValue(true),
    };

    const startRuntime = vi.fn().mockResolvedValue({
      add: vi.fn(),
      end: vi.fn().mockResolvedValue(undefined),
      exportDiagnostics: vi.fn().mockReturnValue('{"fps":60}'),
      populateTarget: vi.fn(),
      reset: vi.fn(),
      rotate: vi.fn(),
    });

    render(
      <WebXRValidationView
        fetcher={createMockFetcher()}
        moduleId="mod-mesa"
        packageId="pkg-1"
        startRuntime={startRuntime}
        xr={xr}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Iniciar sesión AR" })).toBeInTheDocument();
    });

    const startButton = screen.getByRole("button", { name: "Iniciar sesión AR" });
    fireEvent.click(startButton);

    await waitFor(() => {
      expect(startRuntime).toHaveBeenCalledTimes(1);
    });
  });

  it("cambia la cantidad objetivo al pulsar los botones de prueba", async () => {
    const xr = {
      isSessionSupported: vi.fn().mockResolvedValue(true),
    };

    render(
      <WebXRValidationView
        fetcher={createMockFetcher()}
        moduleId="mod-mesa"
        packageId="pkg-1"
        xr={xr}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "5 objetos" })).toBeInTheDocument();
    });

    const btn5 = screen.getByRole("button", { name: "5 objetos" });
    fireEvent.click(btn5);

    expect(btn5).toHaveClass("active");
    expect(screen.getByText(/objetivo: 5/i)).toBeInTheDocument();
});

  describe("flujo de sesión", () => {
    const xr = { isSessionSupported: vi.fn().mockResolvedValue(true) };

    function createRuntime() {
      return {
        add: vi.fn(),
        end: vi.fn().mockResolvedValue(undefined),
        exportDiagnostics: vi.fn().mockReturnValue('{"fps":60}'),
        populateTarget: vi.fn(),
        reset: vi.fn(),
        rotate: vi.fn(),
      };
    }

    async function startSession(startRuntime: StartRuntime, fetcher = createMockFetcher()) {
      render(
        <WebXRValidationView
          fetcher={fetcher}
          moduleId="mod-mesa"
          packageId="pkg-1"
          startRuntime={startRuntime}
          xr={xr}
        />,
      );
      fireEvent.click(await screen.findByRole("button", { name: "Iniciar sesión AR" }));
    }

    it("muestra error si el catálogo falla", async () => {
      const fetcher = vi.fn().mockResolvedValue({ ok: false, status: 500 } as unknown as Response);

      render(
        <WebXRValidationView fetcher={fetcher} moduleId="mod-mesa" packageId="pkg-1" xr={xr} />,
      );

      expect(await screen.findByRole("alert")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Iniciar sesión AR" })).toBeDisabled();
    });

    it("muestra el error al iniciar la sesión", async () => {
      const startRuntime = vi.fn().mockRejectedValue(new Error("sin permisos"));

      await startSession(startRuntime);

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "No se pudo iniciar la sesión AR: sin permisos",
      );
    });

    it("los botones ±15° giran el modelo", async () => {
      const runtime = createRuntime();
      await startSession(vi.fn().mockResolvedValue(runtime));

      fireEvent.click(await screen.findByRole("button", { name: "Girar 15 grados a la izquierda" }));
      fireEvent.click(screen.getByRole("button", { name: "Girar 15 grados a la derecha" }));

      expect(runtime.rotate).toHaveBeenNthCalledWith(1, -15);
      expect(runtime.rotate).toHaveBeenNthCalledWith(2, 15);
    });

    it("copia el diagnóstico JSON al portapapeles", async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText }, userAgent: "ua-test" });
      const runtime = createRuntime();
      await startSession(vi.fn().mockResolvedValue(runtime));

      fireEvent.click(await screen.findByRole("button", { name: "Copiar diagnóstico JSON" }));

      await waitFor(() => expect(writeText).toHaveBeenCalledWith('{"fps":60}'));
      expect(await screen.findByText("¡Diagnóstico copiado!")).toBeInTheDocument();
    });

    it("termina la sesión y vuelve a estado listo", async () => {
      const runtime = createRuntime();
      let onEnd: (failed: boolean) => void = () => {};
      const startRuntime = vi.fn().mockImplementation(async (options) => {
        onEnd = options.onEnd;
        return runtime;
      });
      await startSession(startRuntime);

      fireEvent.click(await screen.findByRole("button", { name: "Terminar sesión" }));
      expect(runtime.end).toHaveBeenCalled();

      onEnd(false);
      expect(await screen.findByRole("button", { name: "Iniciar sesión AR" })).toBeInTheDocument();
    });

    it("conserva el error si la sesión terminó con fallo", async () => {
      let onEnd: (failed: boolean) => void = () => {};
      const startRuntime = vi.fn().mockImplementation(async (options) => {
        onEnd = options.onEnd;
        return createRuntime();
      });
      await startSession(startRuntime);
      await screen.findByRole("button", { name: "Terminar sesión" });

      onEnd(true);

      expect(await screen.findByRole("alert")).toHaveTextContent("terminó con errores");
    });

    it("avisa de que falta HTTPS sin llamar a requestSession", async () => {
      vi.stubGlobal("isSecureContext", false);
      const startRuntime = vi.fn();

      await startSession(startRuntime);

      expect(await screen.findByRole("alert")).toHaveTextContent("HTTPS");
      expect(startRuntime).not.toHaveBeenCalled();
    });

    it("en sesión muestra el panel compacto: diagnóstico colapsado y texto de add-mode", async () => {
      const runtime = createRuntime();
      let onDiagnostics: (d: unknown) => void = () => {};
      const startRuntime = vi.fn().mockImplementation(async (options) => {
        onDiagnostics = options.onDiagnostics;
        return runtime;
      });
      await startSession(startRuntime);
      await screen.findByRole("button", { name: "Terminar sesión" });

      const summary = screen.getByText("Diagnóstico");
      const details = summary.closest("details");
      expect(details).not.toBeNull();
      expect(details).not.toHaveAttribute("open");
      expect(screen.getByRole("button", { name: "1 objeto" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "+ Añadir (retícula)" })).toBeInTheDocument();

      act(() => {
        onDiagnostics({
          activosFlyweight: 0,
          beforexrselectCancelados: 0,
          domOverlay: true,
          estadoActivos: { "mesa@1": "cargado" },
          failures: "ninguno",
          fpsAverage: 0,
          fpsCurrent: 0,
          fpsMin: 0,
          framesConPose: 0,
          framesConResultadoHitTest: 0,
          framesTotales: 3,
          grantedFeatures: "hit-test",
          lastEvent: "add-mode",
          memory: "n/d",
          objectCount: 0,
          renderInfo: { calls: 0, geometries: 0, textures: 0, triangles: 0 },
          reticleAltura: 0,
          reticleVisible: false,
          sceneChildren: 2,
          select: 0,
          selectstart: 0,
          targetCount: 1,
          tipoEspacioReferencia: "local-floor",
        });
      });

      expect(screen.getByRole("button", { name: "Toca la pantalla para colocar" })).toBeInTheDocument();
      expect(screen.getByText("mesa@1: cargado")).toBeInTheDocument();
    });

    it("muestra ayuda si no hay retícula tras unos segundos", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        await startSession(vi.fn().mockResolvedValue(createRuntime()));
        await screen.findByRole("button", { name: "Terminar sesión" });
        expect(screen.queryByText(/Mueve el teléfono lentamente/)).not.toBeInTheDocument();

        await act(async () => {
          await vi.advanceTimersByTimeAsync(4500);
        });

        expect(screen.getByText(/Mueve el teléfono lentamente/)).toBeInTheDocument();
      } finally {
        vi.useRealTimers();
      }
    });

    it("muestra el User Agent en el panel", async () => {
      vi.stubGlobal("navigator", { ...navigator, userAgent: "ua-visible-test" });

      render(
        <WebXRValidationView
          fetcher={createMockFetcher()}
          moduleId="mod-mesa"
          packageId="pkg-1"
          xr={xr}
        />,
      );

      expect(await screen.findByText("User Agent")).toBeInTheDocument();
      expect(await screen.findByText("ua-visible-test")).toBeInTheDocument();
    });
  });
});


