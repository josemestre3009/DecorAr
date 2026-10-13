import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/shared/domain/domain-error";
import { err, ok } from "@/shared/domain/result";

const { listMock, sessionMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  sessionMock: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/actions", () => ({ signOutAction: vi.fn() }));
vi.mock("@/composition/session-guard", () => ({ requireSessionUser: sessionMock }));
vi.mock("@/composition/server", () => ({
  createPackageListQueryDependencies: vi.fn(async () => ({
    listOwnedPackages: { execute: listMock },
  })),
}));
vi.mock("./event-form", () => ({ EventForm: () => <form aria-label="Crear evento" /> }));
vi.mock("./template-manager", () => ({ TemplateManager: () => <section aria-label="Plantillas" /> }));

const { default: PackagesPage, loadPackageHistory } = await import("./page");

const COMPATIBLE = { availableM2: 35.5, requiredM2: 10, status: "compatible" as const };

function summary(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    capacityM2: 35.5,
    clientName: "Ana",
    eventDate: null,
    eventType: "Boda",
    id: "pkg-new",
    name: "Boda de Ana",
    spaceType: "salonSocial",
    spatial: COMPATIBLE,
    updatedAt: "2026-10-12T15:00:00Z",
    venue: "Salón",
    ...overrides,
  };
}

describe("PackagesPage", () => {
  const originalMode = process.env.NEXT_PUBLIC_DECOR_PACKAGES_API;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_DECOR_PACKAGES_API = "live";
    sessionMock.mockResolvedValue({ email: "ana@example.com", id: "user-1" });
  });

  afterEach(() => {
    if (originalMode === undefined) delete process.env.NEXT_PUBLIC_DECOR_PACKAGES_API;
    else process.env.NEXT_PUBLIC_DECOR_PACKAGES_API = originalMode;
  });

  it("separa Eventos y Plantillas y lista los eventos del lector con acción Continuar", async () => {
    listMock.mockResolvedValue(ok([
      summary(),
      summary({ capacityM2: 20, clientName: null, eventType: null, id: "pkg-old", name: "Cumpleaños", spaceType: "casa", venue: null }),
    ]));

    render(await PackagesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Eventos" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Plantillas" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Boda de Ana")).toBeInTheDocument();
    expect(screen.getByText(/Ana · Salón social/)).toBeInTheDocument();
    expect(screen.getAllByText(/Actualizado el/)).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Continuar con/ }).map((link) => link.getAttribute("href"))).toEqual([
      "/packages/pkg-new",
      "/packages/pkg-old",
    ]);
    expect(listMock).toHaveBeenCalledWith("user-1");
  });

  it("describe un evento legacy sin datos opcionales sin mostrar valores falsos", async () => {
    listMock.mockResolvedValue(ok([
      summary({ capacityM2: null, clientName: null, eventType: null, id: "legacy", name: "Evento legado", spaceType: null, venue: null }),
    ]));

    render(await PackagesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Sin datos del cliente")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continuar con Evento legado" })).toHaveAttribute(
      "href",
      "/packages/legacy",
    );
  });

  it("usa un nombre de reserva cuando el evento no tiene nombre", async () => {
    listMock.mockResolvedValue(ok([summary({ id: "sin-nombre", name: "" })]));

    render(await PackagesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Evento sin nombre")).toBeInTheDocument();
  });

  it("muestra un estado vacío sin ocultar el formulario de creación", async () => {
    listMock.mockResolvedValue(ok([]));

    render(await PackagesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Aún no tienes eventos.")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Crear evento" })).toBeInTheDocument();
  });

  it("convierte fallos de lectura en un estado recuperable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listMock.mockResolvedValue(err(new DomainError("package.persistence_error", "boom")));

    await expect(loadPackageHistory("user-1")).resolves.toEqual({ status: "error" });
  });

  it("muestra el error de lectura sin ocultar la creación", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listMock.mockResolvedValue(err(new DomainError("package.persistence_error", "boom")));

    render(await PackagesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tus eventos");
    expect(screen.getByRole("form", { name: "Crear evento" })).toBeInTheDocument();
  });

  it("no consulta historial persistente en modo simulado", async () => {
    process.env.NEXT_PUBLIC_DECOR_PACKAGES_API = "simulated";

    render(await PackagesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("El historial persistente está disponible en modo live.")).toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });
});
