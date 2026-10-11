import type { PackageDetailView } from "@/modules/packages/application/dtos/package-detail.dto";

import { spaceTypeLabel } from "../_lib/configurator-view";
import { formatAreaM2 } from "../_lib/format";

type SpaceSummaryProps = {
  readonly detail: Pick<PackageDetailView, "spaceType" | "capacityM2" | "usedM2" | "remainingM2">;
};

/**
 * Builder visible (DECOR-22): el espacio y la capacidad que la persona ingresó
 * al crear el paquete, y el área que ocupa lo agregado. Todo sale del servidor;
 * no hay capacidades fijas en la interfaz.
 */
export function SpaceSummary({ detail }: SpaceSummaryProps) {
  return (
    <section aria-labelledby="space-summary-title" className="configurator-card">
      <h2 className="section-title" id="space-summary-title">
        Tu espacio
      </h2>
      <dl className="space-facts">
        <div>
          <dt>Tipo de espacio</dt>
          <dd>{spaceTypeLabel(detail.spaceType)}</dd>
        </div>
        <div>
          <dt>Capacidad</dt>
          <dd>{formatAreaM2(detail.capacityM2)}</dd>
        </div>
        <div>
          <dt>Área usada</dt>
          <dd>{formatAreaM2(detail.usedM2)}</dd>
        </div>
        <div>
          <dt>Área restante</dt>
          <dd>{formatAreaM2(detail.remainingM2)}</dd>
        </div>
      </dl>
    </section>
  );
}
