import type { PackageDetailView } from "@/modules/packages/application/dtos/package-detail.dto";

import { spaceTypeLabel, spatialDiagnosticText } from "../_lib/configurator-view";
import { formatAreaM2, formatEventDate } from "../_lib/format";

type EventSummaryProps = {
  readonly detail: Pick<
    PackageDetailView,
    | "name"
    | "clientName"
    | "eventDate"
    | "venue"
    | "eventType"
    | "spaceType"
    | "capacityM2"
    | "spatial"
  >;
};

/**
 * Datos del evento (DECOR-44) y diagnóstico espacial informativo. Los
 * metadatos opcionales se muestran como "Sin definir" cuando faltan y el
 * diagnóstico nunca bloquea la configuración.
 */
export function EventSummary({ detail }: EventSummaryProps) {
  const diagnostico = spatialDiagnosticText(detail.spatial);

  return (
    <section aria-labelledby="event-summary-title" className="configurator-card">
      <h2 className="section-title" id="event-summary-title">
        Datos del evento
      </h2>

      <dl className="space-facts">
        <div>
          <dt>Nombre</dt>
          <dd>{detail.name}</dd>
        </div>
        <div>
          <dt>Cliente</dt>
          <dd>{detail.clientName ?? "Sin definir"}</dd>
        </div>
        <div>
          <dt>Fecha</dt>
          <dd>{formatEventDate(detail.eventDate) ?? "Sin definir"}</dd>
        </div>
        <div>
          <dt>Lugar</dt>
          <dd>{detail.venue ?? "Sin definir"}</dd>
        </div>
        <div>
          <dt>Tipo de evento</dt>
          <dd>{detail.eventType ?? "Sin definir"}</dd>
        </div>
        <div>
          <dt>Tipo de espacio</dt>
          <dd>{spaceTypeLabel(detail.spaceType)}</dd>
        </div>
        <div>
          <dt>Área disponible</dt>
          <dd>{formatAreaM2(detail.capacityM2)}</dd>
        </div>
      </dl>

      <div
        aria-live="polite"
        className={`spatial-diagnostic spatial-${diagnostico.tone}`}
        role="status"
      >
        <p className="spatial-title">{diagnostico.title}</p>
        <p className="spatial-detail">{diagnostico.detail}</p>
      </div>
    </section>
  );
}
