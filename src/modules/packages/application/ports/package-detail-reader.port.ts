import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type { TipoEspacio } from "../../domain/space-type";
import type { PackageGroupSummary } from "./package-group-repository.port";

export interface PackageDetailItemRecord {
  readonly itemId: string;
  readonly moduleId: string;
  readonly name: string;
  readonly priceCop: number;
  readonly areaM2: number;
  /** Grupo que contiene la hoja; `null` si está en la raíz del paquete. */
  readonly groupId: string | null;
}

export interface PackageDetailRecord {
  readonly id: string;
  readonly spaceType: TipoEspacio;
  readonly capacityM2: number;
  readonly version: number;
  readonly items: readonly PackageDetailItemRecord[];
  readonly groups: readonly PackageGroupSummary[];
}

/**
 * Lectura del paquete completo para el configurador (DECOR-22). Siempre filtra
 * por dueño: un paquete ajeno o inexistente devuelve `null`.
 */
export interface PackageDetailReader {
  getDetail(packageId: string, userId: string): Promise<Result<PackageDetailRecord | null, DomainError>>;
}
