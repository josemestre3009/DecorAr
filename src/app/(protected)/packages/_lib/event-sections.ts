import type { IconName } from "../../_ui/icon";

/**
 * Secciones del evento (rediseño visual móvil): en lugar de una sola página
 * larga, el evento se divide en secciones con su propia URL
 * (`/packages/{id}?seccion=…`), para que "atrás" y los enlaces funcionen.
 * En celular se recorren con la barra inferior; en escritorio, con la barra
 * lateral. El orden sigue el recorrido V2 (DECOR-49).
 */

export const EVENT_SECTIONS = [
  { icon: "calendar", id: "evento", label: "Evento", shortLabel: "Evento" },
  { icon: "layers", id: "objetos", label: "Objetos", shortLabel: "Objetos" },
  { icon: "grid", id: "catalogo", label: "Catálogo", shortLabel: "Catálogo" },
  { icon: "file", id: "cotizar", label: "Cotizaciones", shortLabel: "Cotizar" },
  { icon: "more", id: "mas", label: "Más opciones", shortLabel: "Más" },
] as const satisfies readonly {
  readonly id: string;
  readonly label: string;
  readonly shortLabel: string;
  readonly icon: IconName;
}[];

export type EventSectionId = (typeof EVENT_SECTIONS)[number]["id"];

export const DEFAULT_EVENT_SECTION: EventSectionId = "evento";

export function isEventSection(value: unknown): value is EventSectionId {
  return typeof value === "string" && EVENT_SECTIONS.some((section) => section.id === value);
}

/** `?seccion=` desconocida o repetida → la sección por defecto, nunca un error. */
export function parseEventSection(value: string | readonly string[] | undefined): EventSectionId {
  return isEventSection(value) ? value : DEFAULT_EVENT_SECTION;
}

/** La sección por defecto usa la URL limpia del evento. */
export function eventSectionHref(packageId: string, section: EventSectionId): string {
  const base = `/packages/${encodeURIComponent(packageId)}`;
  return section === DEFAULT_EVENT_SECTION ? base : `${base}?seccion=${section}`;
}

export function eventSectionLabel(section: EventSectionId): string {
  return EVENT_SECTIONS.find((item) => item.id === section)?.label ?? "Evento";
}
