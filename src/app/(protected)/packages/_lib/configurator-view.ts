import type { PackageDetailNode } from "@/modules/packages/application/dtos/package-detail.dto";

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
      readonly updatedAt: string;
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

export function rowSubtotal(row: ContentRow): { readonly areaM2: number; readonly priceCop: number } {
  if (row.kind === "group") {
    return { areaM2: row.areaM2, priceCop: row.priceCop };
  }

  return {
    areaM2: redondear(row.unitAreaM2 * row.itemIds.length),
    priceCop: row.unitPriceCop * row.itemIds.length,
  };
}

export function spaceTypeLabel(spaceType: string): string {
  return SPACE_TYPES.find((option) => option.value === spaceType)?.label ?? spaceType;
}
