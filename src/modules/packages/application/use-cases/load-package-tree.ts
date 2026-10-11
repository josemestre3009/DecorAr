import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import { PaqueteDecoracion } from "../../domain/decoration-package";
import { reconstruirComponentes } from "../../domain/package-structure";
import type { PackageGroupReader } from "../ports/package-group-repository.port";
import type { PackageDetail, PackageReader } from "../ports/package-reader.port";

export interface LoadedPackageTree {
  readonly detail: PackageDetail;
  readonly paquete: PaqueteDecoracion;
}

/**
 * Lee el paquete y su estructura de grupos y los arma como Composite para
 * validar en el dominio (capacidad, niveles, ciclos) antes de cualquier RPC.
 * El precio no se usa aquí: el total confirmado pertenece a Presupuesto.
 */
export async function loadPackageTree(
  packageReader: PackageReader,
  groupReader: PackageGroupReader,
  packageId: string,
  userId: string,
): Promise<Result<LoadedPackageTree, DomainError>> {
  const packageResult = await packageReader.getPackage(packageId, userId);
  if (!packageResult.ok) {
    return err(packageResult.error);
  }

  const detail = packageResult.value;
  if (!detail) {
    return err(new DomainError("package.not_found", "No encontramos este paquete."));
  }

  const structureResult = await groupReader.getStructure(packageId);
  if (!structureResult.ok) {
    return err(structureResult.error);
  }

  const structure = structureResult.value;
  const componentes = reconstruirComponentes(
    structure.groups.map((group) => ({
      grupoPadreId: group.parentGroupId,
      id: group.groupId,
      nombre: group.name,
    })),
    detail.items.map((item) => ({
      grupoId: structure.itemGroupIds[item.itemId] ?? null,
      modulo: { id: item.itemId, nombre: item.moduleId, ocupaM2: item.areaM2, precio: 0 },
    })),
  );
  if (!componentes.ok) {
    return err(componentes.error);
  }

  const paquete = PaqueteDecoracion.create({
    capacidadM2: detail.capacityM2,
    componentes: componentes.value,
    tipoEspacio: detail.spaceType,
  });
  if (!paquete.ok) {
    return err(paquete.error);
  }

  return ok({ detail, paquete: paquete.value });
}
