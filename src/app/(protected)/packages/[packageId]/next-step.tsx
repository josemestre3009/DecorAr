import Link from "next/link";

import { Icon } from "../../_ui/icon";
import { eventSectionHref } from "../_lib/event-sections";

/**
 * "Siguiente paso" del evento (DECOR-49): dice qué hacer ahora según el
 * contenido, para que el recorrido no dependa de instrucciones externas. Sin
 * elementos lleva al catálogo; con elementos invita a cotizar y a verlos en 3D.
 * Cada acción lleva a su sección del evento (rediseño visual móvil).
 */
type NextStepProps = {
  readonly packageId: string;
  readonly unitCount: number;
};

export function NextStep({ packageId, unitCount }: NextStepProps) {
  const empty = unitCount === 0;

  return (
    <aside aria-labelledby="next-step-title" className="configurator-card next-step">
      <p className="next-step-eyebrow">
        <Icon name="sparkle" size={16} />
        Siguiente paso
      </p>
      <h2 className="section-title" id="next-step-title">
        {empty ? "Agrega los elementos de tu evento" : "Crea la cotización"}
      </h2>
      <p className="next-step-body">
        {empty
          ? "Elige mesas, sillas, arcos o pistas en el catálogo. Antes de agregarlos puedes verlos en 3D a tamaño real."
          : `Ya tienes ${unitCount} ${unitCount === 1 ? "elemento" : "elementos"}. Míralos en 3D si quieres y genera la cotización para tu cliente.`}
      </p>
      <div className="next-step-actions">
        {empty ? (
          <Link className="auth-submit next-step-action" href={eventSectionHref(packageId, "catalogo")}>
            <Icon name="grid" />
            Ir al catálogo
          </Link>
        ) : (
          <>
            <Link className="auth-submit next-step-action" href={eventSectionHref(packageId, "cotizar")}>
              <Icon name="file" />
              Crear la cotización
            </Link>
            <Link className="secondary-button next-step-action" href={eventSectionHref(packageId, "catalogo")}>
              <Icon name="cube" />
              Ver los elementos en 3D
            </Link>
          </>
        )}
      </div>
    </aside>
  );
}
