import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { TransformacionItem } from "../domain/escena-montaje";
import type { EscenaRecord, EscenaRepository, GuardarEscenaCommand } from "../application/ports/escena-repository.port";

/** Códigos conocidos de `save_package_scene`, con el mensaje mostrado al usuario. */
const KNOWN_CODES: ReadonlyMap<string, string> = new Map([
  ["package.not_found", "No encontramos este paquete."],
  ["scene.invalid_body", "No pudimos leer la escena enviada."],
  ["scene.version_conflict", "La escena cambió mientras guardabas. Vuelve a intentarlo."],
  ["scene.item_not_found", "No encontramos alguna de estas unidades en el paquete."],
  ["scene.too_many_items", "La escena admite como máximo 100 unidades."],
]);

/** Postgres `invalid_text_representation`: un uuid mal formado llegó a la consulta. */
const INVALID_TEXT_REPRESENTATION = "22P02";

type RpcError = { readonly code?: string; readonly details?: string; readonly message: string };

const persistenceError = (cause: unknown, fallback: string): DomainError =>
  new DomainError("scene.persistence_error", fallback, { cause });

const toDomainError = (error: RpcError): DomainError => {
  const knownMessage = KNOWN_CODES.get(error.message);
  if (knownMessage) {
    const currentSceneVersion = error.message === "scene.version_conflict"
      ? Number(error.details)
      : Number.NaN;
    return new DomainError(
      error.message,
      knownMessage,
      { cause: error },
      Number.isSafeInteger(currentSceneVersion) && currentSceneVersion >= 0
        ? { currentSceneVersion }
        : {},
    );
  }

  if (error.code === INVALID_TEXT_REPRESENTATION) {
    return new DomainError("scene.invalid_body", "La escena enviada tiene un identificador inválido.", { cause: error });
  }

  return persistenceError(error, "Error inesperado al guardar la escena");
};

type SceneRow = { package_id: string; version: number };
type TransformRow = { item_id: string; x: number; y: number; z: number; rotation_deg: number };

/**
 * Adaptador server-only de la escena (DECOR-46). Debe construirse con el
 * cliente service_role: `save_package_scene` niega anon/authenticated y el
 * Route Handler ya verificó sesión y propiedad con `checkPackageAccess`.
 */
export class SupabaseEscenaRepository implements EscenaRepository {
  constructor(private readonly client: SupabaseClient) {}

  async leer(packageId: string): Promise<Result<EscenaRecord, DomainError>> {
    try {
      const { data: sceneRow, error: sceneError } = await this.client
        .from("package_scenes")
        .select("package_id, version")
        .eq("package_id", packageId)
        .maybeSingle();

      if (sceneError) {
        return err(persistenceError(sceneError, "Error al consultar la escena"));
      }

      const scene = sceneRow as SceneRow | null;

      if (!scene) {
        return ok({ packageId, sceneVersion: 0, transformaciones: [] });
      }

      const { data: transformRows, error: transformsError } = await this.client
        .from("package_item_transforms")
        .select("item_id, x, y, z, rotation_deg")
        .eq("package_id", packageId);

      if (transformsError) {
        return err(persistenceError(transformsError, "Error al consultar las posiciones"));
      }

      const transformaciones: TransformacionItem[] = ((transformRows ?? []) as TransformRow[]).map((row) => ({
        itemId: row.item_id,
        posicion: { x: row.x, y: row.y, z: row.z },
        rotacionDeg: row.rotation_deg,
      }));

      return ok({ packageId, sceneVersion: Number(scene.version), transformaciones });
    } catch (cause) {
      return err(persistenceError(cause, "Error inesperado al consultar la escena"));
    }
  }

  async guardar(command: GuardarEscenaCommand): Promise<Result<number, DomainError>> {
    try {
      const { data, error } = await this.client.rpc("save_package_scene", {
        p_expected_version: command.expectedSceneVersion,
        p_package_id: command.packageId,
        p_transforms: command.transformaciones.map((item) => ({
          itemId: item.itemId,
          rotationDeg: item.rotacionDeg,
          x: item.posicion.x,
          y: item.posicion.y,
          z: item.posicion.z,
        })),
        p_user_id: command.userId,
      });

      if (error) {
        return err(toDomainError(error));
      }

      if (typeof data !== "number") {
        return err(persistenceError(null, "RPC save_package_scene returned no version"));
      }

      return ok(data);
    } catch (cause) {
      return err(persistenceError(cause, "Error inesperado al guardar la escena"));
    }
  }
}
