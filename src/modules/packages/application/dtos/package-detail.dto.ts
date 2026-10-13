import type { EventMetadataDto, SpatialDiagnosticDto } from "./package.dto";

/**
 * Vista de solo lectura del paquete para el configurador (DECOR-22). Es un
 * objeto plano y serializable: el Server Component lo pasa como props al
 * cliente. Precio y área de los grupos son la suma de sus hojas (Composite) y
 * son informativos: el total confirmado pertenece a Presupuesto.
 */
export type PackageDetailNode =
  | {
      readonly kind: "leaf";
      readonly itemId: string;
      readonly moduleId: string;
      readonly name: string;
      readonly areaM2: number;
      readonly priceCop: number;
    }
  | {
      readonly kind: "group";
      readonly groupId: string;
      readonly name: string;
      readonly areaM2: number;
      readonly priceCop: number;
      readonly children: readonly PackageDetailNode[];
    };

/**
 * Detalle del evento para el configurador. Incluye los metadatos opcionales y
 * el diagnóstico espacial informativo (DECOR-44). `remainingM2` es `null`
 * cuando no hay área disponible registrada.
 */
export interface PackageDetailView extends EventMetadataDto {
  readonly id: string;
  readonly usedM2: number;
  readonly remainingM2: number | null;
  readonly spatial: SpatialDiagnosticDto;
  readonly version: number;
  readonly nodes: readonly PackageDetailNode[];
}

export interface GetPackageDetailDto {
  readonly packageId: string;
  readonly userId: string;
}
