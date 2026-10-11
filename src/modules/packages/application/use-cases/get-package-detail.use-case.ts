import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import { ModuloCompuesto } from "../../domain/composite-module";
import type { ComponenteDecorativo } from "../../domain/decorative-component";
import { reconstruirComponentes } from "../../domain/package-structure";
import type { GetPackageDetailDto, PackageDetailNode, PackageDetailView } from "../dtos/package-detail.dto";
import type { PackageDetailItemRecord, PackageDetailReader } from "../ports/package-detail-reader.port";

/** Evita arrastrar errores de coma flotante (0.1 + 0.2) a la pantalla. */
const redondear = (valor: number): number => Math.round(valor * 100) / 100;

/**
 * Detalle del paquete para el configurador (DECOR-22). Reconstruye el árbol
 * Composite guardado (DECOR-25) con los precios reales del catálogo, así hojas
 * y grupos se recorren con el mismo contrato. No valida capacidad: un paquete
 * ya guardado se muestra tal como está.
 */
export class GetPackageDetailUseCase {
  constructor(private readonly reader: PackageDetailReader) {}

  async execute(dto: GetPackageDetailDto): Promise<Result<PackageDetailView, DomainError>> {
    if (!dto.packageId || dto.packageId.trim().length === 0 || !dto.userId || dto.userId.trim().length === 0) {
      return err(new DomainError("package.not_found", "No encontramos este paquete."));
    }

    const recordResult = await this.reader.getDetail(dto.packageId, dto.userId);
    if (!recordResult.ok) {
      return err(recordResult.error);
    }

    const record = recordResult.value;
    if (!record) {
      return err(new DomainError("package.not_found", "No encontramos este paquete."));
    }

    const itemsById = new Map(record.items.map((item) => [item.itemId, item]));
    const componentes = reconstruirComponentes(
      record.groups.map((group) => ({
        grupoPadreId: group.parentGroupId,
        id: group.groupId,
        nombre: group.name,
      })),
      record.items.map((item) => ({
        grupoId: item.groupId,
        modulo: { id: item.itemId, nombre: item.name, ocupaM2: item.areaM2, precio: item.priceCop },
      })),
    );
    if (!componentes.ok) {
      return err(componentes.error);
    }

    const usedM2 = redondear(componentes.value.reduce((total, c) => total + c.calcularAreaM2(), 0));

    return ok({
      capacityM2: record.capacityM2,
      id: record.id,
      nodes: componentes.value.map((componente) => aNodo(componente, itemsById)),
      remainingM2: redondear(Math.max(0, record.capacityM2 - usedM2)),
      spaceType: record.spaceType,
      usedM2,
      version: record.version,
    });
  }
}

function aNodo(
  componente: ComponenteDecorativo,
  itemsById: ReadonlyMap<string, PackageDetailItemRecord>,
): PackageDetailNode {
  if (componente instanceof ModuloCompuesto) {
    return {
      areaM2: redondear(componente.calcularAreaM2()),
      children: componente.hijos.map((hijo) => aNodo(hijo, itemsById)),
      groupId: componente.id,
      kind: "group",
      name: componente.nombre,
      priceCop: componente.calcularPrecio(),
    };
  }

  const item = itemsById.get(componente.id);
  return {
    areaM2: componente.calcularAreaM2(),
    itemId: componente.id,
    kind: "leaf",
    moduleId: item?.moduleId ?? "",
    name: componente.nombre,
    priceCop: componente.calcularPrecio(),
  };
}
