import Link from "next/link";

import { Icon } from "../../_ui/icon";
import { EVENT_SECTIONS, eventSectionHref, type EventSectionId } from "../_lib/event-sections";

type EventNavProps = {
  readonly packageId: string;
  /** Sección actual; `null` en pantallas del evento que no son una sección (cotización, visor 3D). */
  readonly active: EventSectionId | null;
  readonly eventName?: string | null;
  /** Total confirmado ya formateado, p. ej. "$685.000". */
  readonly totalLabel?: string | null;
  /** Unidades del evento: contador de "Objetos". */
  readonly unitCount?: number;
};

/**
 * Navegación del evento (rediseño visual móvil). Un solo marcado: en celular
 * es la barra inferior fija, al alcance del pulgar; en escritorio, la barra
 * lateral con el resumen del evento (lo decide el CSS).
 *
 * El nombre accesible de cada enlace es el nombre completo de la sección (y
 * el contador de Objetos); las etiquetas visibles son decorativas porque en
 * celular se usa la versión corta ("Cotizar").
 */
export function EventNav({ packageId, active, eventName, totalLabel, unitCount }: EventNavProps) {
  return (
    <nav aria-label="Secciones del evento" className="event-nav">
      <div className="event-nav-brand">
        <Link className="event-nav-logo" href="/packages">
          DecorAR
        </Link>
        {eventName ? (
          <div className="event-nav-event">
            <p className="event-nav-event-name">{eventName}</p>
            {totalLabel ? <p className="event-nav-event-total">Presupuesto: {totalLabel}</p> : null}
          </div>
        ) : null}
      </div>

      <ul className="event-nav-list">
        {EVENT_SECTIONS.map((section) => {
          const current = section.id === active;
          const count = section.id === "objetos" && unitCount !== undefined && unitCount > 0 ? unitCount : null;

          return (
            <li key={section.id}>
              <Link
                aria-current={current ? "page" : undefined}
                aria-label={count === null ? section.label : `${section.label} (${count})`}
                className="event-nav-item"
                href={eventSectionHref(packageId, section.id)}
              >
                <span aria-hidden="true" className="event-nav-icon">
                  <Icon name={section.icon} size={22} />
                  {/* La clave reinicia la animación de "rebote" cuando cambia el número. */}
                  {count !== null ? (
                    <span className="event-nav-badge" key={count}>
                      {count}
                    </span>
                  ) : null}
                </span>
                <span aria-hidden="true" className="event-nav-label event-nav-label-short">
                  {section.shortLabel}
                </span>
                <span aria-hidden="true" className="event-nav-label event-nav-label-long">
                  {section.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
