import { describe, expect, it, vi } from "vitest";
import { ok } from "../../../../shared/domain/result";
import type { Clock, IdGenerator } from "../../../../shared/application/ports";
import type { PackageChangeOutbox } from "../../../events/application/outbox";
import type { PackageReader } from "../ports/package-reader.port";
import { RemoveModuleFromPackageUseCase } from "./remove-module-from-package.use-case";

describe("RemoveModuleFromPackageUseCase", () => {
  const fixedDate = new Date("2026-10-08T12:00:00.000Z");
  const mockClock: Clock = { now: () => fixedDate };
  const mockIdGenerator: IdGenerator = { generate: () => "evt-del-1" };

  it("elimina un elemento resolviendo su moduleId y cometiendo el evento outbox", async () => {
    const mockPackageReader: PackageReader = {
      getItemModuleId: vi.fn().mockResolvedValue(ok("mod-123")),
      getPackage: vi.fn(),
    };

    const mockOutbox: PackageChangeOutbox = {
      commit: vi.fn().mockResolvedValue(ok(4)),
    };

    const useCase = new RemoveModuleFromPackageUseCase(
      mockPackageReader,
      mockOutbox,
      mockClock,
      mockIdGenerator,
    );

    const result = await useCase.execute({
      itemId: "item-456",
      packageId: "pkg-789",
      userId: "user-1",
    });

    expect(result.ok).toBe(true);
    expect(mockPackageReader.getItemModuleId).toHaveBeenCalledWith("pkg-789", "item-456");
    expect(mockOutbox.commit).toHaveBeenCalledWith({
      eventId: "evt-del-1",
      occurredAt: "2026-10-08T12:00:00.000Z",
      packageId: "pkg-789",
      payload: {
        itemId: "item-456",
        moduleId: "mod-123",
      },
      schemaVersion: 1,
      type: "package.module.removed",
      userId: "user-1",
    });
  });

  it("rechaza si el elemento no existe en el paquete", async () => {
    const mockPackageReader: PackageReader = {
      getItemModuleId: vi.fn().mockResolvedValue(ok(null)),
      getPackage: vi.fn(),
    };
    const mockOutbox: PackageChangeOutbox = { commit: vi.fn() };

    const useCase = new RemoveModuleFromPackageUseCase(
      mockPackageReader,
      mockOutbox,
      mockClock,
      mockIdGenerator,
    );

    const result = await useCase.execute({
      itemId: "item-no-existe",
      packageId: "pkg-1",
      userId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("package.item_not_found");
    }
    expect(mockOutbox.commit).not.toHaveBeenCalled();
  });
});
