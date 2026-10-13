import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { DomainError } from "../../shared/domain/domain-error";
import { err, ok, type Result } from "../../shared/domain/result";
import { isTipoEspacio } from "../../modules/packages/domain/space-type";
import type { EventTemplateDto } from "../../modules/packages/application/dtos/event-template.dto";
import type { EventTemplateReader } from "../../modules/packages/application/ports/event-template-repository.port";

interface EventTemplateRow {
  id: string;
  name: string | null;
  space_type: unknown;
  capacity_m2: number | string | null;
  event_type: string | null;
  style: string | null;
  colors: unknown;
  notes: string | null;
  updated_at: string;
}

const COLUMNS = "id, name, space_type, capacity_m2, event_type, style, colors, notes, updated_at";

/** Postgres `invalid_text_representation`: a malformed uuid reached the query. */
const INVALID_TEXT_REPRESENTATION = "22P02";

const readColors = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((color): color is string => typeof color === "string") : [];

function mapTemplate(row: EventTemplateRow): EventTemplateDto {
  return {
    capacityM2: row.capacity_m2 === null || row.capacity_m2 === undefined ? null : Number(row.capacity_m2),
    colors: readColors(row.colors),
    eventType: row.event_type ?? null,
    id: row.id,
    name: row.name ?? "",
    notes: row.notes ?? "",
    spaceType: isTipoEspacio(row.space_type) ? row.space_type : null,
    style: row.style ?? null,
    updatedAt: row.updated_at,
  };
}

/**
 * Lecturas privadas de plantillas (DECOR-44). Se construye con el cliente de
 * sesión, así que RLS también filtra; además se filtra explícitamente por
 * `owner_id`, de modo que una plantilla ajena o inexistente devuelve `null`.
 */
export class SupabaseEventTemplateReader implements EventTemplateReader {
  constructor(private readonly client: SupabaseClient) {}

  async listByOwner(ownerId: string): Promise<Result<readonly EventTemplateDto[], DomainError>> {
    try {
      const { data, error } = await this.client
        .from("event_templates")
        .select(COLUMNS)
        .eq("owner_id", ownerId)
        .order("updated_at", { ascending: false });

      if (error) {
        return err(new DomainError("template.persistence_error", error.message, { cause: error }));
      }

      return ok(((data as EventTemplateRow[] | null) ?? []).map(mapTemplate));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Error al consultar las plantillas";
      return err(new DomainError("template.persistence_error", message, { cause }));
    }
  }

  async getTemplate(
    templateId: string,
    ownerId: string,
  ): Promise<Result<EventTemplateDto | null, DomainError>> {
    try {
      const { data, error } = await this.client
        .from("event_templates")
        .select(COLUMNS)
        .eq("id", templateId)
        .eq("owner_id", ownerId)
        .maybeSingle();

      if (error) {
        if (error.code === INVALID_TEXT_REPRESENTATION) {
          return ok(null);
        }
        return err(new DomainError("template.persistence_error", error.message, { cause: error }));
      }

      return ok(data ? mapTemplate(data as EventTemplateRow) : null);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Error al consultar la plantilla";
      return err(new DomainError("template.persistence_error", message, { cause }));
    }
  }
}
