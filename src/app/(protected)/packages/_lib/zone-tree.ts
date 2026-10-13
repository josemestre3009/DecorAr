import type { PackageDetailNode } from "@/modules/packages/application/dtos/package-detail.dto";

/**
 * Vista plana del Composite para el editor de zonas (DECOR-25 + grupos
 * editables): profundidad, ancestros, altura del subárbol y descendientes. El
 * servidor vuelve a validar ciclos y profundidad; aquí solo se ofrecen destinos
 * que el dominio aceptaría.
 */

export const MAX_ZONE_DEPTH = 3;
export const ZONE_NAME_MAX = 80;

export type ZoneNode = {
  readonly groupId: string;
  readonly name: string;
  readonly depth: number;
  readonly children: readonly ZoneNode[];
};

export type ZoneOption = {
  readonly groupId: string;
  readonly name: string;
  readonly depth: number;
  /** Ids de los ancestros, sin incluir la propia zona. */
  readonly ancestorIds: readonly string[];
  /** Altura del subárbol: 1 cuando la zona no tiene subzonas. */
  readonly height: number;
  readonly descendantIds: readonly string[];
};

function isGroup(node: PackageDetailNode): node is Extract<PackageDetailNode, { kind: "group" }> {
  return node.kind === "group";
}

export function buildZoneTree(nodes: readonly PackageDetailNode[], depth = 1): ZoneNode[] {
  return nodes.filter(isGroup).map((node) => ({
    children: buildZoneTree(node.children, depth + 1),
    depth,
    groupId: node.groupId,
    name: node.name,
  }));
}

function toFlat(zone: ZoneNode, ancestorIds: readonly string[]): ZoneOption[] {
  const childOptions = zone.children.flatMap((child) => toFlat(child, [...ancestorIds, zone.groupId]));

  return [
    {
      ancestorIds,
      depth: zone.depth,
      descendantIds: childOptions.map((child) => child.groupId),
      groupId: zone.groupId,
      height: heightOf(zone),
      name: zone.name,
    },
    ...childOptions,
  ];
}

function heightOf(zone: ZoneNode): number {
  return zone.children.length === 0 ? 1 : 1 + Math.max(...zone.children.map(heightOf));
}

export function flattenZones(tree: readonly ZoneNode[]): ZoneOption[] {
  return tree.flatMap((zone) => toFlat(zone, []));
}

/** Zonas que pueden recibir una subzona nueva (quedarían en el nivel 3 como mucho). */
export function creatableParentZones(zones: readonly ZoneOption[]): ZoneOption[] {
  return zones.filter((zone) => zone.depth < MAX_ZONE_DEPTH);
}

/** Destinos válidos al mover una zona: ni ella ni su subárbol, y sin superar el nivel 3. */
export function validMoveTargets(zones: readonly ZoneOption[], zone: ZoneOption): ZoneOption[] {
  const excluded = new Set([zone.groupId, ...zone.descendantIds]);

  return zones.filter(
    (candidate) => !excluded.has(candidate.groupId) && candidate.depth + zone.height <= MAX_ZONE_DEPTH,
  );
}

/** Etiqueta con sangría según el nivel, para los selectores de zona. */
export function zoneLabel(zone: Pick<ZoneOption, "name" | "depth">): string {
  return `${"· ".repeat(zone.depth - 1)}${zone.name}`;
}

/** Valida el nombre visible de una zona (recorte 1..80) y devuelve el texto o el error. */
export function zoneNameError(raw: string): string | null {
  const value = raw.trim();

  if (value.length === 0) {
    return "Escribe un nombre para la zona.";
  }

  if (value.length > ZONE_NAME_MAX) {
    return `El nombre no puede superar ${ZONE_NAME_MAX} caracteres.`;
  }

  return null;
}

export function trimZoneName(raw: string): string {
  return raw.trim().slice(0, ZONE_NAME_MAX);
}
