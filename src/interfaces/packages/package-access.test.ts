import { describe, expect, it, vi } from "vitest";

import { AuthorizePackageAccessUseCase, type PackageOwnerReader } from "../../modules/packages/application/authorize-package-access.use-case";
import { DomainError } from "../../shared/domain/domain-error";
import { err, ok } from "../../shared/domain/result";
import type { SessionUser } from "../../shared/domain/session";
import { checkPackageAccess } from "./package-access";

const USER_A: SessionUser = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "a@decorar.test" };
const USER_B: SessionUser = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", email: "b@decorar.test" };
const PACKAGE_A = "11111111-1111-4111-8111-111111111111";

// As if RLS were disabled: the real owner is visible to every caller.
const rlsDisabled: PackageOwnerReader = { findOwnerId: async () => ok(USER_A.id) };

/** Shape every package Route Handler follows: authorize, then run the use case. */
function packageHandler(user: SessionUser | null, useCase: () => Promise<Response>) {
  const authorize = new AuthorizePackageAccessUseCase({ currentUser: async () => user }, rlsDisabled);

  return async (packageId: string) => {
    const access = await checkPackageAccess(authorize, packageId);
    return access.ok ? useCase() : access.response;
  };
}

describe("checkPackageAccess en un Route Handler de paquete", () => {
  it("A: ejecuta el caso de uso sobre su paquete", async () => {
    const useCase = vi.fn(async () => Response.json({ ok: true }));
    const response = await packageHandler(USER_A, useCase)(PACKAGE_A);

    expect(response.status).toBe(200);
    expect(useCase).toHaveBeenCalledTimes(1);
  });

  it("B: 404 y el caso de uso no se ejecuta, aun con RLS deshabilitada", async () => {
    const useCase = vi.fn(async () => Response.json({ ok: true }));
    const response = await packageHandler(USER_B, useCase)(PACKAGE_A);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: { code: "package.not_found", message: "No encontramos este paquete." },
    });
    expect(useCase).not.toHaveBeenCalled();
  });

  it("anónimo: 401 en JSON y el caso de uso no se ejecuta", async () => {
    const useCase = vi.fn(async () => Response.json({ ok: true }));
    const response = await packageHandler(null, useCase)(PACKAGE_A);

    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).error.code).toBe("auth.unauthenticated");
    expect(useCase).not.toHaveBeenCalled();
  });

  it("un fallo de lectura responde 500 sin filtrar el detalle", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const access = await checkPackageAccess(
      { execute: async () => err(new DomainError("package.persistence_error", "relation secret")) },
      PACKAGE_A,
    );

    expect(access.ok).toBe(false);
    if (access.ok) return;
    expect(access.response.status).toBe(500);
    expect(JSON.stringify(await access.response.json())).not.toContain("secret");
  });

  it("propaga los encabezados de sesión en la respuesta de rechazo", async () => {
    const access = await checkPackageAccess(
      { execute: async () => err(new DomainError("auth.unauthenticated", "x")) },
      PACKAGE_A,
      { "Cache-Control": "private, no-store" },
    );

    expect(!access.ok && access.response.headers.get("cache-control")).toBe("private, no-store");
  });
});
