import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { PackageListReader } from "../ports/package-reader.port";
import { ListOwnedPackagesUseCase } from "./list-owned-packages.use-case";

describe("ListOwnedPackagesUseCase", () => {
  it("consulta únicamente los paquetes del usuario autenticado", async () => {
    const packages = [
      { capacityM2: 40, id: "pkg-1", spaceType: "casa" as const, updatedAt: "2026-10-12T12:00:00Z" },
    ];
    const reader: PackageListReader = { listByOwner: vi.fn().mockResolvedValue(ok(packages)) };

    const result = await new ListOwnedPackagesUseCase(reader).execute("user-1");

    expect(result).toEqual(ok(packages));
    expect(reader.listByOwner).toHaveBeenCalledWith("user-1");
  });

  it("rechaza un usuario vacío sin consultar persistencia", async () => {
    const reader: PackageListReader = { listByOwner: vi.fn() };

    const result = await new ListOwnedPackagesUseCase(reader).execute(" ");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("auth.unauthenticated");
    expect(reader.listByOwner).not.toHaveBeenCalled();
  });

  it("propaga errores de persistencia", async () => {
    const reader: PackageListReader = {
      listByOwner: vi.fn().mockResolvedValue(err(new DomainError("package.persistence_error", "boom"))),
    };

    const result = await new ListOwnedPackagesUseCase(reader).execute("user-1");

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.persistence_error");
  });
});
