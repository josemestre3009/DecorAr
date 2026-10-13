import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { SupabasePackageRepository } from "./supabase-package-repository";

const clientWith = (rpc: ReturnType<typeof vi.fn>) => ({ rpc }) as unknown as SupabaseClient;

describe("SupabasePackageRepository", () => {
  describe("clone()", () => {
    it("invoca la RPC clone_package con los parámetros correctos y mapea el resultado", async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: {
          capacityM2: 50,
          colors: ["#ffffff", "#000000"],
          id: "pkg-cloned-1",
          itemCount: 3,
          notes: "Notas del clon",
          spaceType: "salonSocial",
          style: "bohemio",
          version: 1,
        },
        error: null,
      });

      const repo = new SupabasePackageRepository(clientWith(rpc));
      const result = await repo.clone({
        sourcePackageId: "pkg-orig-1",
        userId: "user-123",
      });

      expect(rpc).toHaveBeenCalledTimes(1);
      expect(rpc).toHaveBeenCalledWith("clone_package", {
        p_source_package_id: "pkg-orig-1",
        p_target_user_id: "user-123",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          capacityM2: 50,
          colors: ["#ffffff", "#000000"],
          id: "pkg-cloned-1",
          itemCount: 3,
          notes: "Notas del clon",
          spaceType: "salonSocial",
          style: "bohemio",
          version: 1,
        });
      }
    });

    it("asigna valores por defecto si la fila devuelta tiene campos opcionales omitidos", async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: {
          capacityM2: "30",
          id: "pkg-cloned-2",
          spaceType: "casa",
        },
        error: null,
      });

      const repo = new SupabasePackageRepository(clientWith(rpc));
      const result = await repo.clone({
        sourcePackageId: "pkg-orig-2",
        userId: "user-123",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          capacityM2: 30,
          colors: [],
          id: "pkg-cloned-2",
          itemCount: 0,
          notes: "",
          spaceType: "casa",
          style: null,
          version: 1,
        });
      }
    });

    it.each([
      "package.invalid_user",
      "package.invalid_space_type",
      "package.invalid_capacity",
      "package.invalid_source",
      "package.not_found",
    ])("mapea el código de error conocido '%s' directamente a DomainError", async (code) => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0001", message: code },
      });

      const repo = new SupabasePackageRepository(clientWith(rpc));
      const result = await repo.clone({
        sourcePackageId: "pkg-orig-x",
        userId: "user-123",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe(code);
        expect(result.error.message).toBe(code);
      }
    });

    it("mapea errores desconocidos de la base de datos a package.persistence_error", async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "XX000", message: "unexpected postgres internal failure" },
      });

      const repo = new SupabasePackageRepository(clientWith(rpc));
      const result = await repo.clone({
        sourcePackageId: "pkg-orig-x",
        userId: "user-123",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("package.persistence_error");
        expect(result.error.message).toContain("unexpected postgres internal failure");
      }
    });

    it("retorna package.persistence_error si la RPC no retorna datos ni error", async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });

      const repo = new SupabasePackageRepository(clientWith(rpc));
      const result = await repo.clone({
        sourcePackageId: "pkg-orig-x",
        userId: "user-123",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("package.persistence_error");
        expect(result.error.message).toBe("RPC clone_package returned no data");
      }
    });

    it("captura excepciones del cliente y retorna package.persistence_error", async () => {
      const rpc = vi.fn().mockRejectedValue(new Error("Network timeout"));

      const repo = new SupabasePackageRepository(clientWith(rpc));
      const result = await repo.clone({
        sourcePackageId: "pkg-orig-x",
        userId: "user-123",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("package.persistence_error");
        expect(result.error.message).toBe("Network timeout");
      }
    });
  });

  describe("create()", () => {
    it("invoca la RPC create_package con nombre y metadatos y retorna CreatedPackageDto", async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: {
          capacityM2: 40,
          clientName: "Ana",
          eventDate: "2026-11-20",
          eventType: "Boda",
          id: "pkg-created-1",
          name: "Evento Ana",
          spaceType: "aireLibre",
          venue: "Salón Norte",
        },
        error: null,
      });

      const repo = new SupabasePackageRepository(clientWith(rpc));
      const result = await repo.create({
        capacityM2: 40,
        clientName: "Ana",
        eventDate: "2026-11-20",
        eventType: "Boda",
        name: "Evento Ana",
        spaceType: "aireLibre",
        userId: "user-123",
        venue: "Salón Norte",
      });

      expect(rpc).toHaveBeenCalledWith("create_package", {
        p_capacity_m2: 40,
        p_client_name: "Ana",
        p_event_date: "2026-11-20",
        p_event_type: "Boda",
        p_name: "Evento Ana",
        p_space_type: "aireLibre",
        p_user_id: "user-123",
        p_venue: "Salón Norte",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          capacityM2: 40,
          clientName: "Ana",
          eventDate: "2026-11-20",
          eventType: "Boda",
          id: "pkg-created-1",
          name: "Evento Ana",
          spaceType: "aireLibre",
          spatial: { availableM2: 40, requiredM2: 0, status: "compatible" },
          venue: "Salón Norte",
        });
      }
    });

    it("acepta un evento mínimo: sin espacio ni área, diagnóstico pendiente", async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: { capacityM2: null, id: "pkg-min", name: "Solo nombre", spaceType: null },
        error: null,
      });

      const repo = new SupabasePackageRepository(clientWith(rpc));
      const result = await repo.create({
        capacityM2: null,
        clientName: null,
        eventDate: null,
        eventType: null,
        name: "Solo nombre",
        spaceType: null,
        userId: "user-123",
        venue: null,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.spatial).toEqual({ availableM2: null, requiredM2: 0, status: "pending" });
        expect(result.value.spaceType).toBeNull();
      }
    });

    it("mapea package.invalid_name directamente a DomainError", async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: null,
        error: { code: "P0001", message: "package.invalid_name" },
      });

      const repo = new SupabasePackageRepository(clientWith(rpc));
      const result = await repo.create({
        capacityM2: null,
        clientName: null,
        eventDate: null,
        eventType: null,
        name: "",
        spaceType: null,
        userId: "user-123",
        venue: null,
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("package.invalid_name");
    });
  });

  describe("updateMetadata()", () => {
    function fakeUpdateClient(pkgResult: { data: unknown; error: unknown }) {
      const filters: [string, unknown][] = [];
      const updates: Record<string, unknown>[] = [];
      const single = {
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return single;
        },
        maybeSingle: () => Promise.resolve(pkgResult),
        select: () => single,
        update: (value: Record<string, unknown>) => {
          updates.push(value);
          return single;
        },
      };
      const itemsChain = {
        eq: () => Promise.resolve({ data: [{ catalog_modules: { area_m2: "6.00" } }], error: null }),
        select: () => itemsChain,
      };
      const from = vi.fn((table: string) => (table === "packages" ? single : itemsChain));

      return { client: { from } as unknown as SupabaseClient, filters, updates };
    }

    it("actualiza sólo las claves del parche y devuelve el diagnóstico espacial", async () => {
      const { client, filters, updates } = fakeUpdateClient({
        data: {
          capacity_m2: "10.00",
          client_name: null,
          event_date: null,
          event_type: null,
          id: "pkg-1",
          name: "Renombrado",
          space_type: "casa",
          venue: null,
        },
        error: null,
      });

      const repo = new SupabasePackageRepository(client);
      const result = await repo.updateMetadata({
        packageId: "pkg-1",
        patch: { capacityM2: 10, name: "Renombrado" },
        userId: "user-1",
      });

      expect(filters).toEqual([
        ["id", "pkg-1"],
        ["user_id", "user-1"],
      ]);
      expect(updates[0]).toMatchObject({ capacity_m2: 10, name: "Renombrado" });
      expect(updates[0].updated_at).toEqual(expect.any(String));
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.name).toBe("Renombrado");
        expect(result.value.spatial).toEqual({ availableM2: 10, requiredM2: 6, status: "compatible" });
      }
    });

    it("un evento ajeno o inexistente devuelve package.not_found", async () => {
      const { client } = fakeUpdateClient({ data: null, error: null });

      const repo = new SupabasePackageRepository(client);
      const result = await repo.updateMetadata({
        packageId: "pkg-ajeno",
        patch: { name: "X" },
        userId: "user-1",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("package.not_found");
    });

    it("no escribe metadatos si falla la lectura del diagnóstico", async () => {
      const update = vi.fn();
      const itemsChain = {
        eq: () => Promise.resolve({ data: null, error: { message: "read failed" } }),
        select: () => itemsChain,
      };
      const client = {
        from: vi.fn((table: string) =>
          table === "package_items" ? itemsChain : { update },
        ),
      } as unknown as SupabaseClient;

      const result = await new SupabasePackageRepository(client).updateMetadata({
        packageId: "pkg-1",
        patch: { name: "Nuevo" },
        userId: "user-1",
      });

      expect(result.ok).toBe(false);
      expect(update).not.toHaveBeenCalled();
    });
  });
});
