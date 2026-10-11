import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/domain/result";

import type { PackagesClient } from "../_lib/packages-client";
import { DuplicatePackageButton } from "./duplicate-package-button";

const push = vi.fn();
const router = { push };

vi.mock("next/navigation", () => ({ useRouter: () => router }));

function createMockClient(clonePackage: PackagesClient["clonePackage"]): PackagesClient {
  return {
    addItem: vi.fn(),
    clonePackage,
    createPackage: vi.fn(),
    mode: "live",
  };
}

describe("DuplicatePackageButton", () => {
  beforeEach(() => {
    push.mockReset();
  });

  it("renderiza el botón 'Duplicar paquete' en estado inicial", () => {
    const client = createMockClient(vi.fn());
    render(<DuplicatePackageButton client={client} packageId="pkg-123" />);

    const button = screen.getByRole("button", { name: "Duplicar paquete" });
    expect(button).toBeInTheDocument();
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "false");
  });

  it("llama a clonePackage y redirige al nuevo paquete al completarse con éxito", async () => {
    const clonePackage = vi.fn().mockResolvedValue(
      ok({
        capacityM2: 50,
        id: "pkg-cloned-456",
        itemCount: 2,
        spaceType: "salonSocial",
        version: 1,
      }),
    );
    const client = createMockClient(clonePackage);

    render(<DuplicatePackageButton client={client} packageId="pkg-123" />);

    const button = screen.getByRole("button", { name: "Duplicar paquete" });
    fireEvent.click(button);

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveTextContent("Duplicando paquete…");

    await waitFor(() => {
      expect(clonePackage).toHaveBeenCalledWith("pkg-123");
      expect(push).toHaveBeenCalledWith("/packages/pkg-cloned-456");
    });
  });

  it("redirige a /login si la sesión expiró (401)", async () => {
    const clonePackage = vi.fn().mockResolvedValue(
      err({
        code: "auth.unauthenticated",
        kind: "unauthorized" as const,
        message: "Inicia sesión para continuar.",
        status: 401,
      }),
    );
    const client = createMockClient(clonePackage);

    render(<DuplicatePackageButton client={client} packageId="pkg-123" />);

    fireEvent.click(screen.getByRole("button", { name: "Duplicar paquete" }));

    await waitFor(() => {
      expect(push).toHaveBeenCalledWith("/login");
    });
  });

  it("muestra el mensaje de error y permite reintentar si la clonación falla", async () => {
    const clonePackage = vi.fn().mockResolvedValue(
      err({
        code: "package.persistence_error",
        kind: "server" as const,
        message: "No pudimos duplicar el paquete en este momento.",
        status: 500,
      }),
    );
    const client = createMockClient(clonePackage);

    render(<DuplicatePackageButton client={client} packageId="pkg-123" />);

    const button = screen.getByRole("button", { name: "Duplicar paquete" });
    fireEvent.click(button);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("No pudimos duplicar el paquete en este momento.");
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent("Duplicar paquete");
  });
});
