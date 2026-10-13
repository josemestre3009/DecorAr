import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../shared/domain/domain-error";
import { err, ok } from "../../shared/domain/result";
import type { SessionUser } from "../../shared/domain/session";
import { checkEventTemplateAccess } from "./event-template-access";

const USER_A: SessionUser = { email: "a@decorar.test", id: "user-a" };
const TEMPLATE = {
  capacityM2: 80,
  colors: [],
  eventType: "boda",
  id: "tpl-1",
  name: "Boda base",
  notes: "",
  spaceType: "salonSocial" as const,
  style: null,
  updatedAt: "2026-10-12T15:00:00Z",
};

function deps(currentUser: SessionUser | null, getTemplate: ReturnType<typeof vi.fn>) {
  return {
    currentUser: async () => currentUser,
    reader: { getTemplate } as never,
  };
}

describe("checkEventTemplateAccess", () => {
  it("devuelve el usuario y la plantilla cuando es del propietario", async () => {
    const getTemplate = vi.fn().mockResolvedValue(ok(TEMPLATE));
    const access = await checkEventTemplateAccess(deps(USER_A, getTemplate), "tpl-1");

    expect(access).toEqual({ ok: true, template: TEMPLATE, user: USER_A });
    expect(getTemplate).toHaveBeenCalledWith("tpl-1", "user-a");
  });

  it("sin sesión responde 401 y no lee la plantilla", async () => {
    const getTemplate = vi.fn();
    const access = await checkEventTemplateAccess(deps(null, getTemplate), "tpl-1");

    expect(access.ok).toBe(false);
    if (access.ok) return;
    expect(access.response.status).toBe(401);
    expect((await access.response.json()).error.code).toBe("auth.unauthenticated");
    expect(getTemplate).not.toHaveBeenCalled();
  });

  it("una plantilla ajena o inexistente responde 404 indistinguible", async () => {
    const getTemplate = vi.fn().mockResolvedValue(ok(null));
    const access = await checkEventTemplateAccess(deps(USER_A, getTemplate), "tpl-ajena");

    expect(access.ok).toBe(false);
    if (access.ok) return;
    expect(access.response.status).toBe(404);
    expect((await access.response.json()).error).toEqual({
      code: "template.not_found",
      message: "No encontramos esta plantilla.",
    });
  });

  it("un fallo de lectura responde 500 sin filtrar el detalle", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const getTemplate = vi
      .fn()
      .mockResolvedValue(err(new DomainError("template.persistence_error", "relation secret")));

    const access = await checkEventTemplateAccess(deps(USER_A, getTemplate), "tpl-1");

    expect(access.ok).toBe(false);
    if (access.ok) return;
    expect(access.response.status).toBe(500);
    expect(JSON.stringify(await access.response.json())).not.toContain("secret");
  });

  it("propaga los encabezados de sesión en la respuesta de rechazo", async () => {
    const getTemplate = vi.fn().mockResolvedValue(ok(null));
    const access = await checkEventTemplateAccess(deps(USER_A, getTemplate), "tpl-1", {
      "Cache-Control": "private, no-store",
    });

    expect(!access.ok && access.response.headers.get("cache-control")).toBe("private, no-store");
  });
});
