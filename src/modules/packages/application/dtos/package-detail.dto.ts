import type { TipoEspacio } from "../../domain/space-type";

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

export interface PackageDetailView {
  readonly id: string;
  readonly spaceType: TipoEspacio;
  readonly capacityM2: number;
  readonly usedM2: number;
  readonly remainingM2: number;
  readonly version: number;
  readonly nodes: readonly PackageDetailNode[];
}

export interface GetPackageDetailDto {
  readonly packageId: string;
  readonly userId: string;
}
