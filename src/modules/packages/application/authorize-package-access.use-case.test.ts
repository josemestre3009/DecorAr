import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok } from "../../../shared/domain/result";
import type { SessionUser } from "../../../shared/domain/session";
import { AuthorizePackageAccessUseCase, type PackageOwnerReader } from "./authorize-package-access.use-case";

const USER_A: SessionUser = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "a@decorar.test" };
const USER_B: SessionUser = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "b@decorar.test" };
const PACKAGE_A = "11111111-1111-4111-8111-111111111111";

/**
 * Owner reader that ignores the caller, as PostgREST would answer with RLS
 * disabled: it reveals the real owner of any package to anyone.
 */
const rlsDisabled: PackageOwnerReader = {
  findOwnerId: vi.fn(async (id: string) => ok(id === PACKAGE_A ? USER_A.id : null)),
};

const sessionOf = (user: SessionUser | null) => ({ currentUser: vi.fn(async () => user) });

describe("AuthorizePackageAccessUseCase", () => {
  it("A accede a su propio paquete", async () => {
    const result = await new AuthorizePackageAccessUseCase(sessionOf(USER_A), rlsDisabled).execute(PACKAGE_A);

    expect(result).toEqual(ok(USER_A));
  });

  it("B no accede al paquete de A aunque RLS esté deshabilitada", async () => {
    const result = await new AuthorizePackageAccessUseCase(sessionOf(USER_B), rlsDisabled).execute(PACKAGE_A);

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe("package.not_found");
  });

  it("anónimo recibe auth.unauthenticated sin consultar el paquete", async () => {
    const owners: PackageOwnerReader = { findOwnerId: vi.fn() };
    const result = await new AuthorizePackageAccessUseCase(sessionOf(null), owners).execute(PACKAGE_A);

    expect(!result.ok && result.error.code).toBe("auth.unauthenticated");
    expect(owners.findOwnerId).not.toHaveBeenCalled();
  });

  it("un paquete inexistente o con id inválido es package.not_found", async () => {
    const owners: PackageOwnerReader = { findOwnerId: vi.fn(async () => ok(null)) };
    const useCase = new AuthorizePackageAccessUseCase(sessionOf(USER_A), owners);

    expect(await useCase.execute("22222222-2222-4222-8222-222222222222")).toMatchObject({
      ok: false,
      error: { code: "package.not_found" },
    });
    expect(await useCase.execute("no-es-un-uuid")).toMatchObject({
      ok: false,
      error: { code: "package.not_found" },
    });
    expect(owners.findOwnerId).toHaveBeenCalledTimes(1);
  });

  it("propaga el fallo de lectura sin conceder acceso", async () => {
    const failure = new DomainError("package.persistence_error", "boom");
    const owners: PackageOwnerReader = { findOwnerId: vi.fn(async () => err(failure)) };
    const result = await new AuthorizePackageAccessUseCase(sessionOf(USER_A), owners).execute(PACKAGE_A);

    expect(result).toEqual(err(failure));
  });
});
