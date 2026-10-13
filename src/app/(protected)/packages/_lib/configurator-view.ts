import type { PackageDetailNode } from "@/modules/packages/application/dtos/package-detail.dto";
import type { SpatialDiagnosticDto } from "@/modules/packages/application/dtos/package.dto";

import { SPACE_TYPES } from "./space-definition";

/**
 * Estado del total confirmado que el Server Component le pasa a la interfaz.
 * El total siempre lo calcula Presupuesto (DECOR-33); la pantalla nunca suma.
 */
export type ConfiguratorBudget =
  | {
      readonly status: "confirmed";
      readonly totalCop: number;
      readonly packageVersion: number;
    }
  | { readonly status: "pending" }
  | { readonly status: "error" };

/** Una fila del contenido: varias unidades del mismo módulo, o un grupo. */
export type ContentRow =
  | {
      readonly kind: "leaves";
      readonly moduleId: string;
      readonly name: string;
      readonly itemIds: readonly string[];
      readonly unitAreaM2: number;
      readonly unitPriceCop: number;
    }
  | {
      readonly kind: "group";
      readonly groupId: string;
      readonly name: string;
      readonly areaM2: number;
      readonly priceCop: number;
      readonly children: readonly ContentRow[];
      /** Unidades (hojas) del grupo en todos sus niveles. */
      readonly leafCount: number;
    };

const redondear = (valor: number): number => Math.round(valor * 100) / 100;

/**
 * Agrupa las hojas iguales de un mismo nivel ("Mesa redonda ×2") conservando
 * el orden de aparición; cada grupo es su propia fila, con sus hijos agrupados
 * de la misma forma.
 */
export function toContentRows(nodes: readonly PackageDetailNode[]): ContentRow[] {
  const rows: ContentRow[] = [];
  const leavesByModule = new Map<string, { itemIds: string[]; node: Extract<PackageDetailNode, { kind: "leaf" }> }>();

  for (const node of nodes) {
    if (node.kind === "group") {
      const children = toContentRows(node.children);
      rows.push({
        areaM2: node.areaM2,
        children,
        groupId: node.groupId,
        kind: "group",
        leafCount: countLeaves(children),
        name: node.name,
        priceCop: node.priceCop,
      });
      continue;
    }

    const existing = leavesByModule.get(node.moduleId);
    if (existing) {
      existing.itemIds.push(node.itemId);
      continue;
    }

    const entry = { itemIds: [node.itemId], node };
    leavesByModule.set(node.moduleId, entry);
    rows.push({
      itemIds: entry.itemIds,
      kind: "leaves",
      moduleId: node.moduleId,
      name: node.name,
      unitAreaM2: node.areaM2,
      unitPriceCop: node.priceCop,
    });
  }

  return rows;
}

function countLeaves(rows: readonly ContentRow[]): number {
  return rows.reduce((total, row) => total + (row.kind === "leaves" ? row.itemIds.length : row.leafCount), 0);
}

/**
 * Cuenta las unidades guardadas por `moduleId` (hojas de todos los niveles). El
 * catálogo lo usa para reconciliar su contador tras un refresco: así "Agregado
 * N veces" no queda desincronizado cuando se quita desde el contenido.
 */
export function countUnitsByModule(nodes: readonly PackageDetailNode[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const node of nodes) {
    if (node.kind === "leaf") {
      counts[node.moduleId] = (counts[node.moduleId] ?? 0) + 1;
      continue;
    }

    for (const [moduleId, count] of Object.entries(countUnitsByModule(node.children))) {
      counts[moduleId] = (counts[moduleId] ?? 0) + count;
    }
  }

  return counts;
}

export function rowSubtotal(row: ContentRow): { readonly areaM2: number; readonly priceCop: number } {
  if (row.kind === "group") {
    return { areaM2: row.areaM2, priceCop: row.priceCop };
  }

  return {
    areaM2: redondear(row.unitAreaM2 * row.itemIds.length),
    priceCop: row.unitPriceCop * row.itemIds.length,
  };
}

export function spaceTypeLabel(spaceType: string | null): string {
  if (!spaceType) {
    return "Sin definir";
  }

  return SPACE_TYPES.find((option) => option.value === spaceType)?.label ?? spaceType;
}

export type SpatialDiagnosticText = {
  readonly title: string;
  readonly detail: string;
  readonly tone: "neutral" | "ok" | "warning";
};

/**
 * Traduce el diagnóstico espacial del servidor a texto visible (DECOR-44). Es
 * informativo: nunca bloquea guardar cambios.
 */
export function spatialDiagnosticText(spatial: SpatialDiagnosticDto): SpatialDiagnosticText {
  const requerida = `${formatArea(spatial.requiredM2)} requeridos`;

  if (spatial.status === "pending" || spatial.availableM2 === null) {
    return {
      detail: `Aún no registras el área disponible. La configuración ocupa ${requerida}.`,
      title: "Compatibilidad espacial pendiente",
      tone: "neutral",
    };
  }

  if (spatial.status === "exceeded") {
    return {
      detail: `La configuración ocupa ${requerida} y supera los ${formatArea(spatial.availableM2)} disponibles.`,
      title: "Compatibilidad espacial excedida",
      tone: "warning",
    };
  }

  return {
    detail: `La configuración ocupa ${requerida} de ${formatArea(spatial.availableM2)} disponibles.`,
    title: "Compatibilidad espacial: compatible",
    tone: "ok",
  };
}

function formatArea(value: number): string {
  return `${new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 }).format(value)} m²`;
}
