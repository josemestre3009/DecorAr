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
vi.mock("./space-form", () => ({ SpaceForm: () => <form aria-label="Crear paquete" /> }));

const { default: PackagesPage, loadPackageHistory } = await import("./page");

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

  it("muestra paquetes ordenados por el lector con datos y acción Continuar", async () => {
    listMock.mockResolvedValue(ok([
      { capacityM2: 35.5, id: "pkg-new", spaceType: "salonSocial", updatedAt: "2026-10-12T15:00:00Z" },
      { capacityM2: 20, id: "pkg-old", spaceType: "casa", updatedAt: "2026-10-11T15:00:00Z" },
    ]));

    render(await PackagesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Mis paquetes" })).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("list")).toHaveAttribute("role", "list");
    expect(screen.getByText("Salón social")).toBeInTheDocument();
    expect(screen.getByText("35.5 m²")).toBeInTheDocument();
    expect(screen.getAllByText(/Actualizado el/)).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: /Continuar con/ }).map((link) => link.getAttribute("href"))).toEqual([
      "/packages/pkg-new",
      "/packages/pkg-old",
    ]);
    expect(listMock).toHaveBeenCalledWith("user-1");
  });

  it("describe registros legacy sin mostrar valores falsos", async () => {
    listMock.mockResolvedValue(ok([
      { capacityM2: null, id: "legacy", spaceType: null, updatedAt: "2026-10-10T15:00:00Z" },
    ]));

    render(await PackagesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("heading", { name: "Espacio sin definir" })).toBeInTheDocument();
    expect(screen.getByText("Capacidad sin definir")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continuar con espacio sin definir, paquete legacy" })).toHaveAttribute(
      "href",
      "/packages/legacy",
    );
  });

  it("muestra un estado vacío sin ocultar el formulario de creación", async () => {
    listMock.mockResolvedValue(ok([]));

    render(await PackagesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("Aún no tienes paquetes.")).toBeInTheDocument();
    expect(screen.getByRole("form", { name: "Crear paquete" })).toBeInTheDocument();
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

    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos cargar tus paquetes");
    expect(screen.getByRole("form", { name: "Crear paquete" })).toBeInTheDocument();
  });

  it("no consulta historial persistente en modo simulado", async () => {
    process.env.NEXT_PUBLIC_DECOR_PACKAGES_API = "simulated";

    render(await PackagesPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText("El historial persistente está disponible en modo live.")).toBeInTheDocument();
    expect(listMock).not.toHaveBeenCalled();
  });
});
