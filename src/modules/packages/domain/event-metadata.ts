import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { isTipoEspacio, isValidCapacityM2, MAX_CAPACITY_M2, type TipoEspacio } from "./space-type";

/** Límite del nombre visible del evento (`docs/DecorAR.md`; contrato HTTP). */
export const MAX_EVENT_NAME_LENGTH = 120;
/** Límites de los metadatos de texto opcionales, alineados con las CHECK de `packages`. */
export const MAX_CLIENT_NAME_LENGTH = 120;
export const MAX_VENUE_LENGTH = 200;
export const MAX_EVENT_TYPE_LENGTH = 80;

/** Metadatos de un evento. Solo `name` es obligatorio; el resto admite ausencia. */
export interface EventMetadata {
  readonly name: string;
  readonly clientName: string | null;
  readonly eventDate: string | null;
  readonly venue: string | null;
  readonly eventType: string | null;
  readonly spaceType: TipoEspacio | null;
  readonly capacityM2: number | null;
}

/** Entrada sin validar: el nombre puede venir ausente y los opcionales sin normalizar. */
export interface EventMetadataInput {
  readonly name?: unknown;
  readonly clientName?: unknown;
  readonly eventDate?: unknown;
  readonly venue?: unknown;
  readonly eventType?: unknown;
  readonly spaceType?: unknown;
  readonly capacityM2?: unknown;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Nombre obligatorio: se recorta y debe quedar entre 1 y 120 caracteres. */
export function normalizarNombreEvento(value: unknown): Result<string, DomainError> {
  const nombre = typeof value === "string" ? value.trim() : "";

  if (nombre.length === 0) {
    return err(new DomainError("package.invalid_name", "El nombre del evento es obligatorio."));
  }

  if (nombre.length > MAX_EVENT_NAME_LENGTH) {
    return err(
      new DomainError(
        "package.invalid_name",
        `El nombre del evento no puede superar ${MAX_EVENT_NAME_LENGTH} caracteres.`,
      ),
    );
  }

  return ok(nombre);
}

function normalizarTextoOpcional(
  value: unknown,
  code: string,
  label: string,
  maxLength: number,
): Result<string | null, DomainError> {
  if (value === undefined || value === null) {
    return ok(null);
  }

  if (typeof value !== "string") {
    return err(new DomainError(code, `${label} no es válido.`));
  }

  const text = value.trim();
  if (text.length === 0) {
    return ok(null);
  }

  if (text.length > maxLength) {
    return err(new DomainError(code, `${label} no puede superar ${maxLength} caracteres.`));
  }

  return ok(text);
}

/** Fecha opcional en formato ISO `YYYY-MM-DD`; `null`/vacío se guardan ausentes. */
export function normalizarFechaEvento(value: unknown): Result<string | null, DomainError> {
  if (value === undefined || value === null || value === "") {
    return ok(null);
  }

  if (typeof value !== "string") {
    return err(new DomainError("package.invalid_event_date", "La fecha del evento no es válida."));
  }

  const text = value.trim();
  const parsed = DATE_PATTERN.test(text) ? new Date(`${text}T00:00:00Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== text) {
    return err(new DomainError("package.invalid_event_date", "La fecha del evento no es válida."));
  }

  return ok(text);
}

/** Tipo de espacio opcional; si viene debe ser uno de los soportados. */
export function normalizarEspacioOpcional(value: unknown): Result<TipoEspacio | null, DomainError> {
  if (value === undefined || value === null || value === "") {
    return ok(null);
  }

  if (!isTipoEspacio(value)) {
    return err(
      new DomainError("package.invalid_space_type", `Tipo de espacio no soportado: ${String(value)}`),
    );
  }

  return ok(value);
}

/** Área disponible opcional; si viene debe ser un número positivo y finito. */
export function normalizarCapacidadOpcional(value: unknown): Result<number | null, DomainError> {
  if (value === undefined || value === null || value === "") {
    return ok(null);
  }

  if (typeof value !== "number") {
    return err(new DomainError("package.invalid_capacity", "La capacidad debe ser un número válido."));
  }

  const numero = value;
  if (!isValidCapacityM2(numero)) {
    return err(
      new DomainError(
        "package.invalid_capacity",
        `La capacidad debe ser un número positivo, finito y menor o igual a ${MAX_CAPACITY_M2} m²`,
      ),
    );
  }

  return ok(numero);
}

/** Valida y normaliza todos los metadatos de un evento (creación). */
export function validarMetadatosEvento(input: EventMetadataInput): Result<EventMetadata, DomainError> {
  const name = normalizarNombreEvento(input.name);
  if (!name.ok) return name;

  const clientName = normalizarTextoOpcional(input.clientName, "package.invalid_client_name", "El nombre del cliente", MAX_CLIENT_NAME_LENGTH);
  if (!clientName.ok) return clientName;

  const eventDate = normalizarFechaEvento(input.eventDate);
  if (!eventDate.ok) return eventDate;

  const venue = normalizarTextoOpcional(input.venue, "package.invalid_venue", "El lugar", MAX_VENUE_LENGTH);
  if (!venue.ok) return venue;

  const eventType = normalizarTextoOpcional(input.eventType, "package.invalid_event_type", "El tipo de evento", MAX_EVENT_TYPE_LENGTH);
  if (!eventType.ok) return eventType;

  const spaceType = normalizarEspacioOpcional(input.spaceType);
  if (!spaceType.ok) return spaceType;

  const capacityM2 = normalizarCapacidadOpcional(input.capacityM2);
  if (!capacityM2.ok) return capacityM2;

  return ok({
    capacityM2: capacityM2.value,
    clientName: clientName.value,
    eventDate: eventDate.value,
    eventType: eventType.value,
    name: name.value,
    spaceType: spaceType.value,
    venue: venue.value,
  });
}

/** Solo las claves presentes en la entrada; una clave ausente no se modifica. */
export type EventMetadataPatch = Partial<EventMetadata>;

/**
 * Valida un PATCH de metadatos. Una clave ausente queda intacta; una clave
 * presente con `null` o texto vacío borra el dato. El nombre, si viene, debe
 * seguir siendo válido.
 */
export function validarParcheMetadatos(input: EventMetadataInput): Result<EventMetadataPatch, DomainError> {
  const patch: {
    name?: string;
    clientName?: string | null;
    eventDate?: string | null;
    venue?: string | null;
    eventType?: string | null;
    spaceType?: TipoEspacio | null;
    capacityM2?: number | null;
  } = {};

  if (input.name !== undefined) {
    const name = normalizarNombreEvento(input.name);
    if (!name.ok) return name;
    patch.name = name.value;
  }

  if (input.clientName !== undefined) {
    const clientName = normalizarTextoOpcional(input.clientName, "package.invalid_client_name", "El nombre del cliente", MAX_CLIENT_NAME_LENGTH);
    if (!clientName.ok) return clientName;
    patch.clientName = clientName.value;
  }

  if (input.eventDate !== undefined) {
    const eventDate = normalizarFechaEvento(input.eventDate);
    if (!eventDate.ok) return eventDate;
    patch.eventDate = eventDate.value;
  }

  if (input.venue !== undefined) {
    const venue = normalizarTextoOpcional(input.venue, "package.invalid_venue", "El lugar", MAX_VENUE_LENGTH);
    if (!venue.ok) return venue;
    patch.venue = venue.value;
  }

  if (input.eventType !== undefined) {
    const eventType = normalizarTextoOpcional(input.eventType, "package.invalid_event_type", "El tipo de evento", MAX_EVENT_TYPE_LENGTH);
    if (!eventType.ok) return eventType;
    patch.eventType = eventType.value;
  }

  if (input.spaceType !== undefined) {
    const spaceType = normalizarEspacioOpcional(input.spaceType);
    if (!spaceType.ok) return spaceType;
    patch.spaceType = spaceType.value;
  }

  if (input.capacityM2 !== undefined) {
    const capacityM2 = normalizarCapacidadOpcional(input.capacityM2);
    if (!capacityM2.ok) return capacityM2;
    patch.capacityM2 = capacityM2.value;
  }

  return ok(patch);
}
