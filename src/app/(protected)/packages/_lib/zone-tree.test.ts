import { describe, expect, it } from "vitest";

import type { PackageDetailNode } from "@/modules/packages/application/dtos/package-detail.dto";

import {
  buildZoneTree,
  creatableParentZones,
  flattenZones,
  validMoveTargets,
  zoneLabel,
  zoneNameError,
  ZONE_NAME_MAX,
} from "./zone-tree";

const leaf = (itemId: string, moduleId: string): PackageDetailNode => ({
  areaM2: 1,
  itemId,
  kind: "leaf",
  moduleId,
  name: moduleId,
  priceCop: 100,
});

const group = (groupId: string, children: PackageDetailNode[]): PackageDetailNode => ({
  areaM2: 1,
  children,
  groupId,
  kind: "group",
  name: groupId,
  priceCop: 100,
});

// raíz → a → b → c (tres niveles) con una hoja suelta en la raíz.
const NODES: PackageDetailNode[] = [
  leaf("i1", "mesa"),
  group("a", [leaf("i2", "arco"), group("b", [group("c", [leaf("i3", "silla")])])]),
];

describe("zone-tree", () => {
  it("aplana la jerarquía con profundidad, ancestros, descendientes y altura", () => {
    const zones = flattenZones(buildZoneTree(NODES));
    const byId = new Map(zones.map((zone) => [zone.groupId, zone]));

    expect(zones.map((zone) => zone.groupId)).toEqual(["a", "b", "c"]);
    expect(byId.get("a")).toMatchObject({ ancestorIds: [], depth: 1, descendantIds: ["b", "c"], height: 3 });
    expect(byId.get("b")).toMatchObject({ ancestorIds: ["a"], depth: 2, descendantIds: ["c"], height: 2 });
    expect(byId.get("c")).toMatchObject({ ancestorIds: ["a", "b"], depth: 3, descendantIds: [], height: 1 });
  });

  it("solo ofrece como padre las zonas que dejan margen a un nivel nuevo", () => {
    const zones = flattenZones(buildZoneTree(NODES));

    expect(creatableParentZones(zones).map((zone) => zone.groupId)).toEqual(["a", "b"]);
  });

  it("excluye la propia zona y sus descendientes y respeta la profundidad al mover", () => {
    const zones = flattenZones(buildZoneTree(NODES));
    const a = zones.find((zone) => zone.groupId === "a") as (typeof zones)[number];
    const c = zones.find((zone) => zone.groupId === "c") as (typeof zones)[number];

    // `a` (altura 3) no cabe dentro de ninguna otra zona del nivel 1+; `c` sí baja a raíz.
    expect(validMoveTargets(zones, a)).toEqual([]);
    expect(validMoveTargets(zones, c).map((zone) => zone.groupId)).toEqual(["a", "b"]);
  });

  it("valida el nombre 1..80 tras recortar y da etiquetas con sangría", () => {
    expect(zoneNameError("  Recepción  ")).toBeNull();
    expect(zoneNameError("   ")).toMatch(/nombre/i);
    expect(zoneNameError("x".repeat(ZONE_NAME_MAX + 1))).toMatch(/80/);
    expect(zoneLabel({ depth: 3, name: "Mesa" })).toBe("· · Mesa");
  });
});
