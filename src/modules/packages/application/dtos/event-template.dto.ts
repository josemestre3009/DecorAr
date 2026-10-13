import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { TipoEspacio } from "../../domain/space-type";

/** Límite del nombre de una plantilla (contrato HTTP y CHECK de `event_templates`). */
export const MAX_TEMPLATE_NAME_LENGTH = 120;

/**
 * Valida y normaliza el nombre de una plantilla: obligatorio, recortado y de
 * 1 a 120 caracteres. Emite `template.invalid_name`, igual que los RPC.
 */
export function normalizarNombrePlantilla(value: unknown): Result<string, DomainError> {
  const name = typeof value === "string" ? value.trim() : "";

  if (name.length === 0) {
    return err(new DomainError("template.invalid_name", "El nombre de la plantilla es obligatorio."));
  }

  if (name.length > MAX_TEMPLATE_NAME_LENGTH) {
    return err(
      new DomainError(
        "template.invalid_name",
        `El nombre de la plantilla no puede superar ${MAX_TEMPLATE_NAME_LENGTH} caracteres.`,
      ),
    );
  }

  return ok(name);
}

/** Configuración reutilizable de una plantilla; nunca contiene cliente, fecha ni lugar. */
export interface EventTemplateDto {
  readonly id: string;
  readonly name: string;
  readonly spaceType: TipoEspacio | null;
  readonly capacityM2: number | null;
  readonly eventType: string | null;
  readonly style: string | null;
  readonly colors: readonly string[];
  readonly notes: string;
  readonly updatedAt: string;
}

export interface CreatedEventTemplateDto {
  readonly id: string;
  readonly name: string;
  readonly spaceType: TipoEspacio | null;
  readonly capacityM2: number | null;
  readonly eventType: string | null;
  readonly style: string | null;
  readonly colors: readonly string[];
  readonly notes: string;
  readonly itemCount: number;
  readonly groupCount: number;
}

export interface InstantiatedEventDto {
  readonly id: string;
  readonly name: string;
  readonly spaceType: TipoEspacio | null;
  readonly capacityM2: number | null;
  readonly eventType: string | null;
  readonly style: string | null;
  readonly colors: readonly string[];
  readonly notes: string;
  readonly version: number;
  readonly itemCount: number;
  readonly groupCount: number;
}

export interface RenamedEventTemplateDto {
  readonly id: string;
  readonly name: string;
}

export interface CreateEventTemplateDto {
  readonly packageId: string;
  readonly userId: string;
  readonly name: string;
}

export interface InstantiateEventFromTemplateDto {
  readonly templateId: string;
  readonly userId: string;
  readonly name: string;
}

export interface RenameEventTemplateDto {
  readonly templateId: string;
  readonly userId: string;
  readonly name: string;
}

export interface DeleteEventTemplateDto {
  readonly templateId: string;
  readonly userId: string;
}
