import { randomUUID } from "node:crypto";

import type { AuthorizePackageAccessUseCase } from "../../modules/packages/application/authorize-package-access.use-case";
import type { ObtenerEscenaUseCase } from "../../modules/ar/application/use-cases/obtener-escena.use-case";
import type { GuardarEscenaUseCase } from "../../modules/ar/application/use-cases/guardar-escena.use-case";
import type { TransformacionItem } from "../../modules/ar/domain/escena-montaje";
import { checkPackageAccess } from "../packages/package-access";

const CORRELATION_ID_HEADER = "x-correlation-id";
const BODY_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const MAX_ITEMS = 100;

function correlationIdFor(request: Request): string {
  const provided = request.headers.get(CORRELATION_ID_HEADER);
  return provided && provided.trim().length > 0 ? provided.trim() : randomUUID();
}

/** Estado HTTP de los errores de la escena (DECOR-46). */
function sceneErrorStatus(code: string): number {
  if (code === "scene.version_conflict") return 409;
  if (code === "package.not_found" || code === "scene.item_not_found") return 404;
  if (code.startsWith("scene.persistence_error") || code === "scene.invalid_body") return 500;
  if (
    code === "ar.scene_too_many_items" ||
    code === "ar.scene_invalid_item" ||
    code === "ar.scene_duplicate_item" ||
    code === "ar.scene_position_out_of_bounds" ||
    code === "ar.invalid_position" ||
    code === "ar.invalid_rotation" ||
    code === "scene.too_many_items"
  ) {
    return 422;
  }
  return 400;
}

function invalidBody(headers: Record<string, string>, message: string): Response {
  return Response.json(
    { error: { code: "scene.invalid_body", message } },
    { headers, status: 400 },
  );
}

/**
 * `expectedSceneVersion` es obligatoria en el cuerpo (mismo patrón que
 * `readExpectedVersion` en `package-controller.ts`): sin ella no se puede
 * detectar un guardado concurrente. Debe ser un entero >= 0 (0 = escena
 * nueva, sin fila en `package_scenes` todavía). `null` significa "forma
 * inválida" (400) antes de persistir.
 */
function readExpectedSceneVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readTransforms(value: unknown): readonly TransformacionItem[] | null {
  if (!Array.isArray(value) || value.length > MAX_ITEMS) return null;

  const items: TransformacionItem[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const row = raw as Record<string, unknown>;

    if (typeof row.itemId !== "string" || !BODY_UUID.test(row.itemId.trim())) return null;
    if (typeof row.x !== "number" || typeof row.y !== "number" || typeof row.z !== "number") return null;
    if (typeof row.rotationDeg !== "number") return null;

    items.push({
      itemId: row.itemId.trim(),
      posicion: { x: row.x, y: row.y, z: row.z },
      rotacionDeg: row.rotationDeg,
    });
  }

  return items;
}

/**
 * `GET|PUT /api/packages/{packageId}/scene` (DECOR-46): persistencia de la
 * posición y rotación horizontal de cada unidad. Sigue el mismo patrón de
 * autorización que el resto de endpoints de paquete: `checkPackageAccess`
 * primero, RLS como segunda barrera. Nunca toca `packages.version`, el
 * outbox ni el presupuesto.
 */
export class SceneController {
  private readonly defaultHeaders: Record<string, string>;

  constructor(
    private readonly authorizePackageAccess: AuthorizePackageAccessUseCase,
    private readonly obtenerEscenaUseCase: ObtenerEscenaUseCase,
    private readonly guardarEscenaUseCase: GuardarEscenaUseCase,
    defaultHeaders: Record<string, string> = {},
  ) {
    this.defaultHeaders = defaultHeaders;
  }

  async handleGet(request: Request, packageId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    const responseHeaders = { ...this.defaultHeaders, [CORRELATION_ID_HEADER]: correlationId };

    try {
      const access = await checkPackageAccess(this.authorizePackageAccess, packageId, responseHeaders);
      if (!access.ok) {
        return access.response;
      }

      const result = await this.obtenerEscenaUseCase.execute(packageId);

      if (!result.ok) {
        const { code, message } = result.error;
        return Response.json(
          { error: { code, message } },
          { headers: responseHeaders, status: sceneErrorStatus(code) },
        );
      }

      return Response.json(
        {
          sceneVersion: result.value.sceneVersion,
          transforms: result.value.transformaciones.map((item) => ({
            itemId: item.itemId,
            rotationDeg: item.rotacionDeg,
            x: item.posicion.x,
            y: item.posicion.y,
            z: item.posicion.z,
          })),
        },
        { headers: responseHeaders, status: 200 },
      );
    } catch (cause) {
      const errorCorrelationId = randomUUID();
      console.error(`[SceneController.handleGet] Error inesperado (${errorCorrelationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: responseHeaders, status: 500 },
      );
    }
  }

  async handlePut(request: Request, packageId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    const responseHeaders = { ...this.defaultHeaders, [CORRELATION_ID_HEADER]: correlationId };

    try {
      const access = await checkPackageAccess(this.authorizePackageAccess, packageId, responseHeaders);
      if (!access.ok) {
        return access.response;
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return invalidBody(responseHeaders, "Cuerpo de solicitud JSON inválido.");
      }

      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return invalidBody(responseHeaders, "Se requiere un objeto JSON.");
      }

      const raw = body as Record<string, unknown>;
      const transforms = readTransforms(raw.transforms);
      if (transforms === null) {
        return invalidBody(
          responseHeaders,
          `transforms debe ser una lista de hasta ${MAX_ITEMS} posiciones válidas.`,
        );
      }

      const expectedSceneVersion = readExpectedSceneVersion(raw.expectedSceneVersion);
      if (expectedSceneVersion === null) {
        return invalidBody(
          responseHeaders,
          "expectedSceneVersion es obligatorio y debe ser un entero mayor o igual a 0.",
        );
      }

      const result = await this.guardarEscenaUseCase.execute({
        expectedSceneVersion,
        packageId,
        transformaciones: transforms,
        userId: access.user.id,
      });

      if (!result.ok) {
        const { code, message } = result.error;
        const currentSceneVersion = result.error.metadata.currentSceneVersion;
        return Response.json(
          {
            error: { code, message },
            ...(code === "scene.version_conflict" && typeof currentSceneVersion === "number"
              ? { currentSceneVersion }
              : {}),
          },
          { headers: responseHeaders, status: sceneErrorStatus(code) },
        );
      }

      return Response.json({ sceneVersion: result.value }, { headers: responseHeaders, status: 200 });
    } catch (cause) {
      const errorCorrelationId = randomUUID();
      console.error(`[SceneController.handlePut] Error inesperado (${errorCorrelationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: responseHeaders, status: 500 },
      );
    }
  }
}
