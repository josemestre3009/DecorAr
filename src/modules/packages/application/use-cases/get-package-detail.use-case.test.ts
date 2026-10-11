import { describe, expect, it, vi } from "vitest";
import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { PackageDetailRecord, PackageDetailReader } from "../ports/package-detail-reader.port";
import { GetPackageDetailUseCase } from "./get-package-detail.use-case";

const ARCO = { areaM2: 2, moduleId: "mod-arco", name: "Arco floral", priceCop: 200000 };
const MESA = { areaM2: 4, moduleId: "mod-mesa", name: "Mesa redonda", priceCop: 250000 };
const PISTA = { areaM2: 16, moduleId: "mod-pista", name: "Pista de baile", priceCop: 600000 };

function reader(record: PackageDetailRecord | null): PackageDetailReader {
  return { getDetail: vi.fn().mockResolvedValue(ok(record)) };
}

const base: PackageDetailRecord = {
  capacityM2: 30,
  groups: [],
  id: "pkg-1",
  items: [],
  spaceType: "casa",
  version: 1,
};

describe("GetPackageDetailUseCase", () => {
  it("paquete vacío: usado 0 y restante igual a la capacidad", async () => {
    const result = await new GetPackageDetailUseCase(reader(base)).execute({ packageId: "pkg-1", userId: "user-1" });

    expect(result).toEqual(
      ok({ capacityM2: 30, id: "pkg-1", nodes: [], remainingM2: 30, spaceType: "casa", usedM2: 0, version: 1 }),
    );
  });

  it("arma hojas sueltas y la Zona de bienvenida con subtotales recursivos (Composite)", async () => {
    const record: PackageDetailRecord = {
      ...base,
      capacityM2: 50,
      groups: [{ groupId: "zona", name: "Zona de bienvenida", parentGroupId: null }],
      items: [
        { ...PISTA, groupId: null, itemId: "i-pista" },
        { ...ARCO, groupId: "zona", itemId: "i-arco" },
        { ...MESA, groupId: "zona", itemId: "i-mesa" },
      ],
      version: 4,
    };

    const result = await new GetPackageDetailUseCase(reader(record)).execute({ packageId: "pkg-1", userId: "user-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.usedM2).toBe(22);
    expect(result.value.remainingM2).toBe(28);
    expect(result.value.nodes).toEqual([
      {
        areaM2: 6,
        children: [
          { areaM2: 2, itemId: "i-arco", kind: "leaf", moduleId: "mod-arco", name: "Arco floral", priceCop: 200000 },
          { areaM2: 4, itemId: "i-mesa", kind: "leaf", moduleId: "mod-mesa", name: "Mesa redonda", priceCop: 250000 },
        ],
        groupId: "zona",
        kind: "group",
        name: "Zona de bienvenida",
        priceCop: 450000,
      },
      { areaM2: 16, itemId: "i-pista", kind: "leaf", moduleId: "mod-pista", name: "Pista de baile", priceCop: 600000 },
    ]);
  });

  it("subgrupos anidados suman en todos los niveles", async () => {
    const record: PackageDetailRecord = {
      ...base,
      groups: [
        { groupId: "g1", name: "Nivel 1", parentGroupId: null },
        { groupId: "g2", name: "Nivel 2", parentGroupId: "g1" },
      ],
      items: [{ ...MESA, groupId: "g2", itemId: "i-mesa" }],
    };

    const result = await new GetPackageDetailUseCase(reader(record)).execute({ packageId: "pkg-1", userId: "user-1" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [nivel1] = result.value.nodes;
    expect(nivel1).toMatchObject({ areaM2: 4, kind: "group", priceCop: 250000 });
    if (nivel1.kind !== "group") return;
    expect(nivel1.children[0]).toMatchObject({ areaM2: 4, kind: "group", name: "Nivel 2" });
  });

  it("un paquete guardado por encima de la capacidad se muestra igual, con restante 0", async () => {
    const record: PackageDetailRecord = {
      ...base,
      capacityM2: 20,
      items: [
        { ...PISTA, groupId: null, itemId: "a" },
        { ...MESA, groupId: null, itemId: "b" },
        { ...MESA, groupId: null, itemId: "c" },
      ],
    };

    const result = await new GetPackageDetailUseCase(reader(record)).execute({ packageId: "pkg-1", userId: "user-1" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.usedM2).toBe(24);
      expect(result.value.remainingM2).toBe(0);
    }
  });

  it("redondea áreas decimales a 2 cifras", async () => {
    const record: PackageDetailRecord = {
      ...base,
      items: [
        { ...MESA, areaM2: 0.1, groupId: null, itemId: "a" },
        { ...MESA, areaM2: 0.2, groupId: null, itemId: "b" },
      ],
    };

    const result = await new GetPackageDetailUseCase(reader(record)).execute({ packageId: "pkg-1", userId: "user-1" });

    expect(result.ok && result.value.usedM2).toBe(0.3);
  });

  it("paquete ajeno o inexistente: package.not_found", async () => {
    const result = await new GetPackageDetailUseCase(reader(null)).execute({ packageId: "pkg-1", userId: "otro" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.not_found");
  });

  it("ids vacíos: package.not_found sin consultar", async () => {
    const detailReader = reader(base);

    const result = await new GetPackageDetailUseCase(detailReader).execute({ packageId: " ", userId: "user-1" });

    expect(result.ok).toBe(false);
    expect(detailReader.getDetail).not.toHaveBeenCalled();
  });

  it("propaga el error de persistencia y rechaza una estructura guardada inválida", async () => {
    const failing: PackageDetailReader = {
      getDetail: vi.fn().mockResolvedValue(err(new DomainError("package.persistence_error", "x"))),
    };
    const persistence = await new GetPackageDetailUseCase(failing).execute({ packageId: "pkg-1", userId: "user-1" });
    expect(persistence.ok).toBe(false);
    if (!persistence.ok) expect(persistence.error.code).toBe("package.persistence_error");

    const orphan: PackageDetailRecord = { ...base, items: [{ ...MESA, groupId: "no-existe", itemId: "a" }] };
    const invalid = await new GetPackageDetailUseCase(reader(orphan)).execute({ packageId: "pkg-1", userId: "user-1" });
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error.code).toBe("package.group_not_found");
  });
});
