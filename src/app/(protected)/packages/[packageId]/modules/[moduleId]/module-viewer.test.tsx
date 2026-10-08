import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PrepararVistaARUseCase } from "@/modules/ar/application/use-cases/preparar-vista-ar.use-case";
import type { CapacidadesAR } from "@/modules/ar/domain/capacidades-ar";
import { FabricaActivos3D } from "@/modules/ar/domain/fabrica-activos-3d";
import type { CatalogModuleDto } from "@/modules/catalog/application/dtos/catalog-module.dto";

import { ModuleViewer } from "./module-viewer";

const push = vi.fn();
const router = { push };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

const fixture = JSON.parse(
  readFileSync(resolve("public/fixtures/catalog-modules.json"), "utf8"),
) as CatalogModuleDto[];
const [mesa, arco, pista] = fixture as [CatalogModuleDto, CatalogModuleDto, CatalogModuleDto];

const IOS: CapacidadesAR = { plataforma: "ios", webxr: false };
const ANDROID: CapacidadesAR = { plataforma: "android", webxr: true };

const loadLibrary = () => Promise.resolve({});

function renderViewer({
  body = fixture as unknown,
  capacidades = IOS,
  moduleId = mesa.id,
  status = 200,
  useCase = new PrepararVistaARUseCase(new FabricaActivos3D()),
} = {}) {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () =>
    Response.json(body, { status }),
  );

  render(
    <ModuleViewer
      detect={() => Promise.resolve(capacidades)}
      fetcher={fetcher}
      loadLibrary={loadLibrary}
      moduleId={moduleId}
      packageId="p-1"
      useCase={useCase}
    />,
  );

  return { fetcher };
}

describe("ModuleViewer", () => {
  beforeEach(() => push.mockReset());

  it("carga el módulo, muestra sus medidas reales y lo prepara para Quick Look en iOS", async () => {
    renderViewer();

    expect(screen.getByText("Cargando el módulo…")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: mesa.name })).toBeInTheDocument();
    expect(screen.getByText(/2 × 1 × 2 m/)).toBeInTheDocument();

    const viewer = await screen.findByTestId("model-viewer");
    expect(viewer).toHaveAttribute("data-renderer", "quick-look");
    expect(viewer).toHaveAttribute("ios-src", mesa.usdzUrl);
    expect(viewer).toHaveAttribute("src", mesa.glbUrl);
    expect(viewer).toHaveAttribute("ar-scale", "fixed");
    expect(viewer).toHaveAttribute("data-asset-key", `mesa@v${mesa.version}`);
    // Los pasos para AR solo aparecen cuando el visor confirma que puede abrirla.
    expect(screen.queryByTestId("ar-steps")).not.toBeInTheDocument();
  });

  it.each([
    ["arco", arco],
    ["pista", pista],
  ])("también abre %s en AR", async (_nombre, modulo) => {
    renderViewer({ capacidades: ANDROID, moduleId: modulo.id });

    const viewer = await screen.findByTestId("model-viewer");
    expect(viewer).toHaveAttribute("data-renderer", "scene-viewer");
    expect(viewer).toHaveAttribute("src", modulo.glbUrl);
    expect(viewer).toHaveAttribute("ar-placement", "floor");
  });

  it("dos vistas del mismo módulo comparten el activo de la fábrica", async () => {
    const fabrica = new FabricaActivos3D();
    const useCase = new PrepararVistaARUseCase(fabrica);

    renderViewer({ useCase });
    await screen.findByTestId("model-viewer");

    renderViewer({ capacidades: ANDROID, useCase });
    await screen.findAllByTestId("model-viewer");

    expect(fabrica.activosCreados).toBe(1);
  });

  it("informa si el módulo ya no está en el catálogo y ofrece volver", async () => {
    renderViewer({ moduleId: "no-existe" });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Este módulo ya no está disponible en el catálogo.",
    );
    expect(screen.getByRole("link", { name: "Volver al catálogo" })).toHaveAttribute(
      "href",
      "/packages/p-1",
    );
  });

  it("explica por qué un módulo sin USDZ no se abre en AR", async () => {
    renderViewer({ body: [{ ...mesa, usdzUrl: "" }] });

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "El modelo USDZ no tiene una URL HTTPS válida.",
    );
    expect(screen.queryByTestId("model-viewer")).not.toBeInTheDocument();
  });

  it("muestra el error del servidor sin detalles y se recupera al reintentar", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ error: "Internal Server Error", correlationId: "x" }, { status: 500 }),
      )
      .mockResolvedValue(Response.json(fixture));

    render(
      <ModuleViewer
        detect={() => Promise.resolve(IOS)}
        fetcher={fetcher}
        loadLibrary={loadLibrary}
        moduleId={mesa.id}
        packageId="p-1"
        useCase={new PrepararVistaARUseCase(new FabricaActivos3D())}
      />,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No pudimos cargar el módulo.");
    expect(alert).not.toHaveTextContent("Internal Server Error");

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByTestId("model-viewer")).toBeInTheDocument();
  });

  it("vuelve al login si la sesión terminó", async () => {
    renderViewer({ body: { error: { code: "auth.unauthenticated", message: "x" } }, status: 401 });

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });
});
