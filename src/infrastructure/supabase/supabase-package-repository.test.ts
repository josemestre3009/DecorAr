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
    it("invoca la RPC create_package con los parámetros correctos y retorna CreatedPackageDto", async () => {
      const rpc = vi.fn().mockResolvedValue({
        data: {
          capacityM2: 40,
          id: "pkg-created-1",
          spaceType: "aireLibre",
        },
        error: null,
      });

      const repo = new SupabasePackageRepository(clientWith(rpc));
      const result = await repo.create({
        capacityM2: 40,
        spaceType: "aireLibre",
        userId: "user-123",
      });

      expect(rpc).toHaveBeenCalledWith("create_package", {
        p_capacity_m2: 40,
        p_space_type: "aireLibre",
        p_user_id: "user-123",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({
          capacityM2: 40,
          id: "pkg-created-1",
          spaceType: "aireLibre",
        });
      }
    });
  });
});
