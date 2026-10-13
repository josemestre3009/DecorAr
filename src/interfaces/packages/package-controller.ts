import { randomUUID } from "node:crypto";

import type { DrainOutboxUseCase } from "../../modules/events/application/drain-outbox.use-case";
import type { AuthorizePackageAccessUseCase } from "../../modules/packages/application/authorize-package-access.use-case";
import type { AddModuleToGroupUseCase } from "../../modules/packages/application/use-cases/add-module-to-group.use-case";
import { MAX_BATCH_QUANTITY } from "../../modules/packages/application/dtos/package.dto";
import type { AddModuleToPackageUseCase } from "../../modules/packages/application/use-cases/add-module-to-package.use-case";
import type { ClonePackageUseCase } from "../../modules/packages/application/use-cases/clone-package.use-case";
import type { CreatePackageGroupUseCase } from "../../modules/packages/application/use-cases/create-package-group.use-case";
import type { CreatePackageUseCase } from "../../modules/packages/application/use-cases/create-package.use-case";
import type { UpdatePackageMetadataUseCase } from "../../modules/packages/application/use-cases/update-package-metadata.use-case";
import type { ListOwnedPackagesUseCase } from "../../modules/packages/application/use-cases/list-owned-packages.use-case";
import type { RemoveModuleFromPackageUseCase } from "../../modules/packages/application/use-cases/remove-module-from-package.use-case";
import type { UpdatePackageGroupUseCase } from "../../modules/packages/application/use-cases/update-package-group.use-case";
import type { DeletePackageGroupUseCase } from "../../modules/packages/application/use-cases/delete-package-group.use-case";
import type { MovePackageItemUseCase } from "../../modules/packages/application/use-cases/move-package-item.use-case";
import type { CreatePackageDto, PackageMetadataPatch } from "../../modules/packages/application/dtos/package.dto";
import type { SessionGateway } from "../../shared/application/ports";
import type { SessionUser } from "../../shared/domain/session";
import { checkPackageAccess } from "./package-access";

export type PackageControllerOptions = {
  readonly clonePackageUseCase?: Pick<ClonePackageUseCase, "execute">;
  readonly createPackageGroupUseCase?: Pick<CreatePackageGroupUseCase, "execute">;
  readonly addModuleToGroupUseCase?: Pick<AddModuleToGroupUseCase, "execute">;
  readonly updatePackageGroupUseCase?: Pick<UpdatePackageGroupUseCase, "execute">;
  readonly deletePackageGroupUseCase?: Pick<DeletePackageGroupUseCase, "execute">;
  readonly movePackageItemUseCase?: Pick<MovePackageItemUseCase, "execute">;
  readonly updatePackageMetadataUseCase?: Pick<UpdatePackageMetadataUseCase, "execute">;
  readonly drainOutbox?: Pick<DrainOutboxUseCase, "execute">;
  readonly listOwnedPackagesUseCase?: Pick<ListOwnedPackagesUseCase, "execute">;
  readonly defaultHeaders?: Record<string, string>;
  readonly headers?: Record<string, string>;
};

/** Estado HTTP de los errores de validación de metadatos (DECOR-44). */
function metadataErrorStatus(code: string): number {
  if (code === "auth.unauthenticated") return 401;
  if (code === "package.not_found") return 404;
  if (code === "package.persistence_error") return 500;
  if (code.startsWith("package.invalid")) return 422;
  return 400;
}

/** Conserva el tipo recibido para que el dominio rechace JSON con tipos incorrectos. */
function readOptionalText(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  return value;
}

/** Convierte solo la ausencia explícita en ausente; el dominio valida el resto. */
function readOptionalCapacity(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return null;
  return value;
}

/** Estado HTTP de los errores al agregar elementos o grupos (incluye el Composite, DECOR-25). */
function groupErrorStatus(code: string): number {
  if (
    code === "package.capacity_exceeded" ||
    code === "package.group_depth_exceeded" ||
    code === "package.group_cycle" ||
    code === "package.invalid_group_name" ||
    code === "package.too_many_children"
  ) {
    return 422;
  }
  if (
    code === "package.not_found" ||
    code === "package.module_not_found" ||
    code === "package.group_not_found"
  ) {
    return 404;
  }
  if (code === "package.version_conflict" || code === "event.duplicate") {
    return 409;
  }
  if (code.startsWith("outbox.") || code === "package.persistence_error") {
    return 500;
  }
  return 400;
}

/**
 * Estado HTTP del editor de zonas e ítems (Composite editable). A diferencia de
 * `groupErrorStatus`, un nombre inválido es una regla de dominio (422) y una
 * zona/ítem ajeno o inexistente se oculta como 404.
 */
function structureErrorStatus(code: string): number {
  if (code === "package.version_conflict" || code === "event.duplicate") {
    return 409;
  }
  if (
    code === "package.not_found" ||
    code === "package.group_not_found" ||
    code === "package.item_not_found" ||
    code === "package.module_not_found"
  ) {
    return 404;
  }
  if (code.startsWith("outbox.") || code === "package.persistence_error") {
    return 500;
  }
  if (
    code === "package.invalid_group_name" ||
    code === "package.group_cycle" ||
    code === "package.group_depth_exceeded" ||
    code === "package.capacity_exceeded"
  ) {
    return 422;
  }
  return 400;
}

/** Mismo formato de uuid que `AuthorizePackageAccessUseCase` para los ids del cuerpo. */
const BODY_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * `expectedVersion` es obligatorio en las mutaciones del editor y debe ser un
 * entero seguro >= 1. `null` significa "forma inválida" (400) antes de persistir.
 */
function readExpectedVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : null;
}

/** Respuesta 400 del editor: el cuerpo no llegó a invocar una mutación persistente. */
function invalidStructureBody(
  headers: Record<string, string>,
  code: string,
  message: string,
): Response {
  return Response.json({ error: { code, message } }, { headers, status: 400 });
}

function isPackageControllerOptions(
  arg: unknown,
): arg is PackageControllerOptions {
  if (typeof arg !== "object" || arg === null) return false;
  return (
    "clonePackageUseCase" in arg ||
    "createPackageGroupUseCase" in arg ||
    "addModuleToGroupUseCase" in arg ||
    "updatePackageGroupUseCase" in arg ||
    "deletePackageGroupUseCase" in arg ||
    "movePackageItemUseCase" in arg ||
    "updatePackageMetadataUseCase" in arg ||
    "drainOutbox" in arg ||
    "listOwnedPackagesUseCase" in arg ||
    "defaultHeaders" in arg ||
    "headers" in arg
  );
}

const CORRELATION_ID_HEADER = "x-correlation-id";

/**
 * Reads `x-correlation-id` from the request or generates one (DECOR-31), so
 * every package mutation can be traced from the HTTP request through the
 * outbox row, its retries and any reconciliation, without changing the
 * versioned event contract (DECOR-29).
 */
function correlationIdFor(request: Request): string {
  const provided = request.headers.get(CORRELATION_ID_HEADER);
  return provided && provided.trim().length > 0 ? provided.trim() : randomUUID();
}

/**
 * Dependencias mínimas de `GET /api/packages` (DECOR-41): sesión bajo RLS y
 * el caso de uso de listado. No hay cliente service_role ni `PackageController`.
 */
export type PackageListHandlerDependencies = {
  readonly currentUser: () => Promise<SessionUser | null>;
  readonly listOwnedPackages?: Pick<ListOwnedPackagesUseCase, "execute">;
  readonly defaultHeaders?: Record<string, string>;
};

/**
 * Contrato de `GET /api/packages`, compartido por `PackageController` y el
 * handler mínimo (DECOR-41): 200 con el listado propio, 401 sin sesión, 500
 * con error genérico, siempre con `x-correlation-id` y los encabezados de
 * refresh/anti-cache que entrega el cliente de sesión.
 */
export async function handleListPackagesRequest(
  request: Request,
  deps: PackageListHandlerDependencies,
): Promise<Response> {
  const correlationId = correlationIdFor(request);
  const responseHeaders = () => ({
    ...deps.defaultHeaders,
    [CORRELATION_ID_HEADER]: correlationId,
  });

  try {
    const user = await deps.currentUser();
    if (!user) {
      return Response.json(
        { error: { code: "auth.unauthenticated", message: "Inicia sesión para continuar." } },
        { headers: responseHeaders(), status: 401 },
      );
    }

    if (!deps.listOwnedPackages) {
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: responseHeaders(), status: 500 },
      );
    }

    const result = await deps.listOwnedPackages.execute(user.id);
    if (!result.ok) {
      console.error(`[PackageController.list] Error de persistencia (${correlationId}):`, result.error.code);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: responseHeaders(), status: 500 },
      );
    }

    return Response.json({ packages: result.value }, { headers: responseHeaders() });
  } catch (cause) {
    console.error(`[PackageController.list] Error inesperado (${correlationId}):`, cause);
    return Response.json(
      { error: { code: "internal_error", message: "No pudimos completar la operación." } },
      { headers: responseHeaders(), status: 500 },
    );
  }
}

export class PackageController {
  private readonly clonePackageUseCase?: Pick<ClonePackageUseCase, "execute">;
  private readonly createPackageGroupUseCase?: Pick<CreatePackageGroupUseCase, "execute">;
  private readonly addModuleToGroupUseCase?: Pick<AddModuleToGroupUseCase, "execute">;
  private readonly updatePackageGroupUseCase?: Pick<UpdatePackageGroupUseCase, "execute">;
  private readonly deletePackageGroupUseCase?: Pick<DeletePackageGroupUseCase, "execute">;
  private readonly movePackageItemUseCase?: Pick<MovePackageItemUseCase, "execute">;
  private readonly updatePackageMetadataUseCase?: Pick<UpdatePackageMetadataUseCase, "execute">;
  private readonly drainOutbox?: Pick<DrainOutboxUseCase, "execute">;
  private readonly listOwnedPackagesUseCase?: Pick<ListOwnedPackagesUseCase, "execute">;
  private readonly defaultHeaders: Record<string, string>;

  constructor(
    private readonly sessionGateway: Pick<SessionGateway, "currentUser">,
    private readonly authorizePackageAccess: AuthorizePackageAccessUseCase,
    private readonly createPackageUseCase: CreatePackageUseCase,
    private readonly addModuleToPackageUseCase: AddModuleToPackageUseCase,
    private readonly removeModuleFromPackageUseCase: RemoveModuleFromPackageUseCase,
    optionsOrCloneOrDrain?:
      | PackageControllerOptions
      | Pick<ClonePackageUseCase, "execute">
      | Pick<DrainOutboxUseCase, "execute">,
    drainOrHeaders?: Pick<DrainOutboxUseCase, "execute"> | Record<string, string>,
    headersOrEmpty: Record<string, string> = {},
  ) {
    if (isPackageControllerOptions(optionsOrCloneOrDrain)) {
      this.clonePackageUseCase = optionsOrCloneOrDrain.clonePackageUseCase;
      this.createPackageGroupUseCase = optionsOrCloneOrDrain.createPackageGroupUseCase;
      this.addModuleToGroupUseCase = optionsOrCloneOrDrain.addModuleToGroupUseCase;
      this.updatePackageGroupUseCase = optionsOrCloneOrDrain.updatePackageGroupUseCase;
      this.deletePackageGroupUseCase = optionsOrCloneOrDrain.deletePackageGroupUseCase;
      this.movePackageItemUseCase = optionsOrCloneOrDrain.movePackageItemUseCase;
      this.updatePackageMetadataUseCase = optionsOrCloneOrDrain.updatePackageMetadataUseCase;
      this.drainOutbox = optionsOrCloneOrDrain.drainOutbox;
      this.listOwnedPackagesUseCase = optionsOrCloneOrDrain.listOwnedPackagesUseCase;
      this.defaultHeaders =
        optionsOrCloneOrDrain.headers ??
        optionsOrCloneOrDrain.defaultHeaders ??
        {};
      return;
    }

    if (
      drainOrHeaders &&
      typeof (drainOrHeaders as Record<string, unknown>).execute === "function"
    ) {
      this.clonePackageUseCase = optionsOrCloneOrDrain as Pick<ClonePackageUseCase, "execute">;
      this.drainOutbox = drainOrHeaders as Pick<DrainOutboxUseCase, "execute">;
      this.defaultHeaders = headersOrEmpty;
    } else if (
      optionsOrCloneOrDrain &&
      typeof (optionsOrCloneOrDrain as Record<string, unknown>).execute === "function"
    ) {
      this.drainOutbox = optionsOrCloneOrDrain as Pick<DrainOutboxUseCase, "execute">;
      this.defaultHeaders = (drainOrHeaders as Record<string, string>) ?? {};
    } else {
      this.defaultHeaders = headersOrEmpty;
    }
  }


  handleListPackages(request: Request): Promise<Response> {
    return handleListPackagesRequest(request, {
      currentUser: () => this.sessionGateway.currentUser(),
      defaultHeaders: this.defaultHeaders,
      listOwnedPackages: this.listOwnedPackagesUseCase,
    });
  }


  async handleCreatePackage(request: Request): Promise<Response> {
    const correlationId = correlationIdFor(request);
    const responseHeaders = { ...this.defaultHeaders, [CORRELATION_ID_HEADER]: correlationId };

    try {
      const user = await this.sessionGateway.currentUser();
      if (!user) {
        return Response.json(
          { error: { code: "auth.unauthenticated", message: "Inicia sesión para continuar." } },
          { headers: responseHeaders, status: 401 },
        );
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { error: { code: "package.invalid_body", message: "Cuerpo de solicitud JSON inválido." } },
          { headers: responseHeaders, status: 400 },
        );
      }

      if (typeof body !== "object" || body === null) {
        return Response.json(
          { error: { code: "package.invalid_body", message: "Se requiere un objeto JSON." } },
          { headers: responseHeaders, status: 400 },
        );
      }

      const { name, clientName, eventDate, venue, eventType, spaceType, capacityM2 } =
        body as Record<string, unknown>;

      const dto: CreatePackageDto = {
        capacityM2: readOptionalCapacity(capacityM2),
        clientName: readOptionalText(clientName),
        eventDate: readOptionalText(eventDate),
        eventType: readOptionalText(eventType),
        name,
        spaceType: spaceType === undefined || spaceType === null ? null : spaceType,
        userId: user.id,
        venue: readOptionalText(venue),
      };

      const result = await this.createPackageUseCase.execute(dto);

      if (!result.ok) {
        const { code, message } = result.error;
        const status = metadataErrorStatus(code);

        return Response.json(
          { error: { code, message } },
          { headers: responseHeaders, status },
        );
      }

      return Response.json(result.value, {
        headers: responseHeaders,
        status: 201,
      });
    } catch (cause) {
      const errorCorrelationId = randomUUID();
      console.error(`[PackageController.create] Error inesperado (${errorCorrelationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: responseHeaders, status: 500 },
      );
    }
  }

  /**
   * `PATCH /api/packages/{packageId}` (DECOR-44): actualiza los metadatos del
   * evento sin tocar la configuración decorativa. Solo el propietario; un
   * evento ajeno o inexistente responde 404.
   */
  async handleUpdatePackage(request: Request, packageId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    const responseHeaders = { ...this.defaultHeaders, [CORRELATION_ID_HEADER]: correlationId };

    try {
      const access = await checkPackageAccess(
        this.authorizePackageAccess,
        packageId,
        responseHeaders,
      );
      if (!access.ok) {
        return access.response;
      }

      if (!this.updatePackageMetadataUseCase) {
        return Response.json(
          { error: { code: "internal_error", message: "Caso de uso de metadatos no disponible." } },
          { headers: responseHeaders, status: 500 },
        );
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { error: { code: "package.invalid_body", message: "Cuerpo de solicitud JSON inválido." } },
          { headers: responseHeaders, status: 400 },
        );
      }

      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return Response.json(
          { error: { code: "package.invalid_body", message: "Se requiere un objeto JSON." } },
          { headers: responseHeaders, status: 400 },
        );
      }

      const raw = body as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const key of ["name", "clientName", "eventDate", "venue", "eventType", "spaceType", "capacityM2"]) {
        if (Object.prototype.hasOwnProperty.call(raw, key)) {
          patch[key] = raw[key];
        }
      }

      const result = await this.updatePackageMetadataUseCase.execute({
        packageId,
        patch: patch as PackageMetadataPatch,
        userId: access.user.id,
      });

      if (!result.ok) {
        const { code, message } = result.error;
        return Response.json(
          { error: { code, message } },
          { headers: responseHeaders, status: metadataErrorStatus(code) },
        );
      }

      return Response.json(result.value, { headers: responseHeaders, status: 200 });
    } catch (cause) {
      const errorCorrelationId = randomUUID();
      console.error(`[PackageController.update] Error inesperado (${errorCorrelationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: responseHeaders, status: 500 },
      );
    }
  }

  async handleAddItem(request: Request, packageId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    const responseHeaders = { ...this.defaultHeaders, [CORRELATION_ID_HEADER]: correlationId };

    try {
      const access = await checkPackageAccess(
        this.authorizePackageAccess,
        packageId,
        this.defaultHeaders,
      );
      if (!access.ok) {
        return access.response;
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { error: { code: "package.invalid_body", message: "Cuerpo de solicitud JSON inválido." } },
          { headers: this.defaultHeaders, status: 400 },
        );
      }

      if (typeof body !== "object" || body === null) {
        return Response.json(
          { error: { code: "package.invalid_body", message: "Se requiere un objeto JSON." } },
          { headers: this.defaultHeaders, status: 400 },
        );
      }

      const { moduleId, parentGroupId, quantity = 1 } = body as Record<string, unknown>;
      if (typeof moduleId !== "string" || moduleId.trim().length === 0) {
        return Response.json(
          { error: { code: "package.invalid_module", message: "El módulo no es válido" } },
          { headers: this.defaultHeaders, status: 400 },
        );
      }

      if (!Number.isSafeInteger(quantity) || (quantity as number) < 1 || (quantity as number) > MAX_BATCH_QUANTITY) {
        return Response.json(
          { error: { code: "package.invalid_quantity", message: `La cantidad debe ser un entero entre 1 y ${MAX_BATCH_QUANTITY}` } },
          { headers: responseHeaders, status: 400 },
        );
      }

      // Ausente o null = raíz. Un valor presente debe ser un id no vacío: un
      // texto en blanco se rechaza en lugar de caer en la raíz en silencio.
      if (
        parentGroupId !== undefined &&
        parentGroupId !== null &&
        (typeof parentGroupId !== "string" || parentGroupId.trim().length === 0)
      ) {
        return Response.json(
          { error: { code: "package.invalid_group", message: "El grupo no es válido" } },
          { headers: this.defaultHeaders, status: 400 },
        );
      }

      // Con parentGroupId la hoja entra en un grupo existente (Composite, DECOR-25).
      const groupId = typeof parentGroupId === "string" ? parentGroupId.trim() : "";
      if (groupId.length > 0 && quantity !== 1) {
        return Response.json(
          { error: { code: "package.invalid_quantity", message: "Los grupos admiten una unidad por acción" } },
          { headers: responseHeaders, status: 400 },
        );
      }
      if (groupId.length > 0 && !this.addModuleToGroupUseCase) {
        return Response.json(
          { error: { code: "internal_error", message: "Caso de uso de grupos no disponible." } },
          { headers: this.defaultHeaders, status: 500 },
        );
      }

      const result =
        groupId.length > 0 && this.addModuleToGroupUseCase
          ? await this.addModuleToGroupUseCase.execute({
              correlationId,
              groupId,
              moduleId: moduleId.trim(),
              packageId,
              userId: access.user.id,
            })
          : await this.addModuleToPackageUseCase.execute({
              correlationId,
              moduleId: moduleId.trim(),
              packageId,
              quantity: quantity as number,
              userId: access.user.id,
            });

      if (!result.ok) {
        const { code, message } = result.error;
        const status = groupErrorStatus(code);

        return Response.json(
          { error: { code, message } },
          { headers: responseHeaders, status },
        );
      }

      if (this.drainOutbox) {
        try {
          await this.drainOutbox.execute();
        } catch (err) {
          console.error("[PackageController.handleAddItem] Drain outbox error:", err);
        }
      }

      return Response.json(result.value, {
        headers: responseHeaders,
        status: 201,
      });
    } catch (cause) {
      const errorCorrelationId = randomUUID();
      console.error(`[PackageController.addItem] Error inesperado (${errorCorrelationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: responseHeaders, status: 500 },
      );
    }
  }

  async handleRemoveItem(packageId: string, itemId: string, request?: Request): Promise<Response> {
    const correlationId = request ? correlationIdFor(request) : randomUUID();
    const responseHeaders = { ...this.defaultHeaders, [CORRELATION_ID_HEADER]: correlationId };

    try {
      const access = await checkPackageAccess(
        this.authorizePackageAccess,
        packageId,
        this.defaultHeaders,
      );
      if (!access.ok) {
        return access.response;
      }

      if (!itemId || itemId.trim().length === 0) {
        return Response.json(
          { error: { code: "package.invalid_item", message: "Identificador de elemento inválido" } },
          { headers: responseHeaders, status: 400 },
        );
      }

      const result = await this.removeModuleFromPackageUseCase.execute({
        correlationId,
        itemId: itemId.trim(),
        packageId,
        userId: access.user.id,
      });

      if (!result.ok) {
        const { code, message } = result.error;
        let status = 400;

        if (code === "package.item_not_found" || code === "package.not_found") {
          status = 404;
        } else if (code === "package.version_conflict" || code === "event.duplicate") {
          status = 409;
        } else if (code.startsWith("outbox.") || code === "package.persistence_error") {
          status = 500;
        }

        return Response.json(
          { error: { code, message } },
          { headers: responseHeaders, status },
        );
      }

      if (this.drainOutbox) {
        try {
          await this.drainOutbox.execute();
        } catch (err) {
          console.error("[PackageController.handleRemoveItem] Drain outbox error:", err);
        }
      }

      return new Response(null, {
        headers: responseHeaders,
        status: 204,
      });
    } catch (cause) {
      const errorCorrelationId = randomUUID();
      console.error(`[PackageController.removeItem] Error inesperado (${errorCorrelationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: responseHeaders, status: 500 },
      );
    }
  }

  async handleClonePackage(request: Request, packageId: string): Promise<Response> {
    try {
      const access = await checkPackageAccess(
        this.authorizePackageAccess,
        packageId,
        this.defaultHeaders,
      );
      if (!access.ok) {
        return access.response;
      }

      if (!this.clonePackageUseCase) {
        return Response.json(
          { error: { code: "internal_error", message: "Caso de uso de clonación no disponible." } },
          { headers: this.defaultHeaders, status: 500 },
        );
      }

      const result = await this.clonePackageUseCase.execute({
        sourcePackageId: packageId,
        userId: access.user.id,
      });

      if (!result.ok) {
        const { code, message } = result.error;
        let status = 400;

        if (code === "package.not_found") {
          status = 404;
        } else if (code === "auth.unauthenticated") {
          status = 401;
        } else if (code === "package.persistence_error") {
          status = 500;
        }

        return Response.json(
          { error: { code, message } },
          { headers: this.defaultHeaders, status },
        );
      }

      return Response.json(result.value, {
        headers: this.defaultHeaders,
        status: 201,
      });
    } catch (cause) {
      const correlationId = randomUUID();
      console.error(`[PackageController.clone] Error inesperado (${correlationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: this.defaultHeaders, status: 500 },
      );
    }
  }

  /**
   * `POST /api/packages/{packageId}/groups` (DECOR-25; endpoint propuesto,
   * Jose lo confirma en la revisión): crea un grupo decorativo, opcionalmente
   * dentro de otro grupo y con sus hojas, en una sola transacción.
   * Body: `{ name, parentGroupId?, children?: [{ moduleId }] }`.
   */
  async handleCreateGroup(request: Request, packageId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    const responseHeaders = { ...this.defaultHeaders, [CORRELATION_ID_HEADER]: correlationId };

    try {
      const access = await checkPackageAccess(
        this.authorizePackageAccess,
        packageId,
        responseHeaders,
      );
      if (!access.ok) {
        return access.response;
      }

      if (!this.createPackageGroupUseCase) {
        return Response.json(
          { error: { code: "internal_error", message: "Caso de uso de grupos no disponible." } },
          { headers: responseHeaders, status: 500 },
        );
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return Response.json(
          { error: { code: "package.invalid_body", message: "Cuerpo de solicitud JSON inválido." } },
          { headers: responseHeaders, status: 400 },
        );
      }

      if (typeof body !== "object" || body === null) {
        return Response.json(
          { error: { code: "package.invalid_body", message: "Se requiere un objeto JSON." } },
          { headers: responseHeaders, status: 400 },
        );
      }

      const { children, expectedVersion: rawExpectedVersion, name, parentGroupId } = body as Record<string, unknown>;

      if (typeof name !== "string") {
        return Response.json(
          { error: { code: "package.invalid_group_name", message: "El nombre del grupo es obligatorio" } },
          { headers: responseHeaders, status: 400 },
        );
      }

      const expectedVersion = rawExpectedVersion === undefined ? undefined : readExpectedVersion(rawExpectedVersion);
      if (expectedVersion === null) {
        return invalidStructureBody(
          responseHeaders,
          "package.invalid_version",
          "expectedVersion debe ser un entero mayor o igual a 1.",
        );
      }

      // Ausente o null = raíz. Un valor presente debe ser un id no vacío: un
      // texto en blanco se rechaza en lugar de caer en la raíz en silencio.
      if (
        parentGroupId !== undefined &&
        parentGroupId !== null &&
        (typeof parentGroupId !== "string" || parentGroupId.trim().length === 0)
      ) {
        return Response.json(
          { error: { code: "package.invalid_group", message: "El grupo no es válido" } },
          { headers: responseHeaders, status: 400 },
        );
      }

      const childList = children ?? [];
      const moduleIds = Array.isArray(childList)
        ? childList.map((child: unknown) =>
            typeof child === "object" &&
            child !== null &&
            typeof (child as { moduleId?: unknown }).moduleId === "string"
              ? (child as { moduleId: string }).moduleId
              : null,
          )
        : null;

      if (moduleIds === null || moduleIds.some((moduleId) => moduleId === null)) {
        return Response.json(
          { error: { code: "package.invalid_module", message: "Cada elemento debe indicar un moduleId" } },
          { headers: responseHeaders, status: 400 },
        );
      }

      const result = await this.createPackageGroupUseCase.execute({
        correlationId,
        moduleIds: moduleIds as string[],
        name,
        packageId,
        parentGroupId: typeof parentGroupId === "string" ? parentGroupId : null,
        userId: access.user.id,
        ...(expectedVersion === undefined ? {} : { expectedVersion }),
      });

      if (!result.ok) {
        const { code, message } = result.error;
        return Response.json(
          { error: { code, message } },
          { headers: responseHeaders, status: groupErrorStatus(code) },
        );
      }

      // Un grupo sin hojas no escribe eventos: no hay nada que drenar.
      if (result.value.itemIds.length > 0 && this.drainOutbox) {
        try {
          await this.drainOutbox.execute();
        } catch (err) {
          console.error("[PackageController.handleCreateGroup] Drain outbox error:", err);
        }
      }

      return Response.json(result.value, {
        headers: responseHeaders,
        status: 201,
      });
    } catch (cause) {
      const errorCorrelationId = randomUUID();
      console.error(`[PackageController.createGroup] Error inesperado (${errorCorrelationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: responseHeaders, status: 500 },
      );
    }
  }

  /**
   * `PATCH /api/packages/{packageId}/groups/{groupId}`: renombra y/o mueve una
   * zona. Cuerpo `{name?, parentGroupId?, expectedVersion}`; al menos un cambio
   * y `expectedVersion` entero >= 1. Solo el propietario; ajeno o inexistente 404.
   */
  async handleUpdateGroup(request: Request, packageId: string, groupId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    const responseHeaders = { ...this.defaultHeaders, [CORRELATION_ID_HEADER]: correlationId };

    try {
      const access = await checkPackageAccess(
        this.authorizePackageAccess,
        packageId,
        responseHeaders,
      );
      if (!access.ok) {
        return access.response;
      }

      if (!this.updatePackageGroupUseCase) {
        return Response.json(
          { error: { code: "internal_error", message: "Caso de uso de zonas no disponible." } },
          { headers: responseHeaders, status: 500 },
        );
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return invalidStructureBody(responseHeaders, "package.invalid_body", "Cuerpo de solicitud JSON inválido.");
      }

      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return invalidStructureBody(responseHeaders, "package.invalid_body", "Se requiere un objeto JSON.");
      }

      const raw = body as Record<string, unknown>;
      const hasName = Object.prototype.hasOwnProperty.call(raw, "name");
      const hasParent = Object.prototype.hasOwnProperty.call(raw, "parentGroupId");
      if (!hasName && !hasParent) {
        return invalidStructureBody(responseHeaders, "package.invalid_body", "Indica un nombre o un grupo padre.");
      }

      const expectedVersion = readExpectedVersion(raw.expectedVersion);
      if (expectedVersion === null) {
        return invalidStructureBody(
          responseHeaders,
          "package.invalid_version",
          "expectedVersion debe ser un entero mayor o igual a 1.",
        );
      }

      let name: string | undefined;
      if (hasName) {
        if (typeof raw.name !== "string") {
          return invalidStructureBody(responseHeaders, "package.invalid_body", "El nombre debe ser texto.");
        }
        name = raw.name;
      }

      let parentGroupId: string | null | undefined;
      if (hasParent) {
        if (raw.parentGroupId === null) {
          parentGroupId = null;
        } else if (
          typeof raw.parentGroupId === "string" &&
          BODY_UUID.test(raw.parentGroupId.trim())
        ) {
          parentGroupId = raw.parentGroupId.trim();
        } else {
          return invalidStructureBody(responseHeaders, "package.invalid_group", "El grupo no es válido.");
        }
      }

      const result = await this.updatePackageGroupUseCase.execute({
        correlationId,
        expectedVersion,
        groupId,
        packageId,
        userId: access.user.id,
        ...(name === undefined ? {} : { name }),
        ...(parentGroupId === undefined ? {} : { parentGroupId }),
      });

      if (!result.ok) {
        const { code, message } = result.error;
        return Response.json(
          { error: { code, message } },
          { headers: responseHeaders, status: structureErrorStatus(code) },
        );
      }

      return Response.json(result.value, { headers: responseHeaders, status: 200 });
    } catch (cause) {
      const errorCorrelationId = randomUUID();
      console.error(`[PackageController.updateGroup] Error inesperado (${errorCorrelationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: responseHeaders, status: 500 },
      );
    }
  }

  /**
   * `DELETE /api/packages/{packageId}/groups/{groupId}`: elimina una zona con
   * `move_to_root` o `delete_contents`. Cuerpo `{strategy, expectedVersion}`.
   */
  async handleDeleteGroup(request: Request, packageId: string, groupId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    const responseHeaders = { ...this.defaultHeaders, [CORRELATION_ID_HEADER]: correlationId };

    try {
      const access = await checkPackageAccess(
        this.authorizePackageAccess,
        packageId,
        responseHeaders,
      );
      if (!access.ok) {
        return access.response;
      }

      if (!this.deletePackageGroupUseCase) {
        return Response.json(
          { error: { code: "internal_error", message: "Caso de uso de zonas no disponible." } },
          { headers: responseHeaders, status: 500 },
        );
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return invalidStructureBody(responseHeaders, "package.invalid_body", "Cuerpo de solicitud JSON inválido.");
      }

      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return invalidStructureBody(responseHeaders, "package.invalid_body", "Se requiere un objeto JSON.");
      }

      const raw = body as Record<string, unknown>;

      const expectedVersion = readExpectedVersion(raw.expectedVersion);
      if (expectedVersion === null) {
        return invalidStructureBody(
          responseHeaders,
          "package.invalid_version",
          "expectedVersion debe ser un entero mayor o igual a 1.",
        );
      }

      const strategy = raw.strategy;
      if (strategy !== "move_to_root" && strategy !== "delete_contents") {
        return invalidStructureBody(responseHeaders, "package.invalid_strategy", "Elige cómo eliminar la zona.");
      }

      const result = await this.deletePackageGroupUseCase.execute({
        correlationId,
        expectedVersion,
        groupId,
        packageId,
        strategy,
        userId: access.user.id,
      });

      if (!result.ok) {
        const { code, message } = result.error;
        return Response.json(
          { error: { code, message } },
          { headers: responseHeaders, status: structureErrorStatus(code) },
        );
      }

      if (this.drainOutbox) {
        try {
          await this.drainOutbox.execute();
        } catch (err) {
          console.error("[PackageController.handleDeleteGroup] Drain outbox error:", err);
        }
      }

      return Response.json(result.value, { headers: responseHeaders, status: 200 });
    } catch (cause) {
      const errorCorrelationId = randomUUID();
      console.error(`[PackageController.deleteGroup] Error inesperado (${errorCorrelationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: responseHeaders, status: 500 },
      );
    }
  }

  /**
   * `PATCH /api/packages/{packageId}/items/{itemId}`: mueve una instancia
   * existente entre zonas. Cuerpo `{groupId, expectedVersion}`; `groupId` null
   * mueve a la raíz. Conserva `itemId`/`moduleId`.
   */
  async handleMoveItem(request: Request, packageId: string, itemId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    const responseHeaders = { ...this.defaultHeaders, [CORRELATION_ID_HEADER]: correlationId };

    try {
      const access = await checkPackageAccess(
        this.authorizePackageAccess,
        packageId,
        responseHeaders,
      );
      if (!access.ok) {
        return access.response;
      }

      if (!this.movePackageItemUseCase) {
        return Response.json(
          { error: { code: "internal_error", message: "Caso de uso de zonas no disponible." } },
          { headers: responseHeaders, status: 500 },
        );
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return invalidStructureBody(responseHeaders, "package.invalid_body", "Cuerpo de solicitud JSON inválido.");
      }

      if (typeof body !== "object" || body === null || Array.isArray(body)) {
        return invalidStructureBody(responseHeaders, "package.invalid_body", "Se requiere un objeto JSON.");
      }

      const raw = body as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(raw, "groupId")) {
        return invalidStructureBody(responseHeaders, "package.invalid_body", "Indica el grupo destino.");
      }

      const expectedVersion = readExpectedVersion(raw.expectedVersion);
      if (expectedVersion === null) {
        return invalidStructureBody(
          responseHeaders,
          "package.invalid_version",
          "expectedVersion debe ser un entero mayor o igual a 1.",
        );
      }

      let groupId: string | null;
      if (raw.groupId === null) {
        groupId = null;
      } else if (typeof raw.groupId === "string" && BODY_UUID.test(raw.groupId.trim())) {
        groupId = raw.groupId.trim();
      } else {
        return invalidStructureBody(responseHeaders, "package.invalid_group", "El grupo no es válido.");
      }

      const result = await this.movePackageItemUseCase.execute({
        correlationId,
        expectedVersion,
        groupId,
        itemId,
        packageId,
        userId: access.user.id,
      });

      if (!result.ok) {
        const { code, message } = result.error;
        return Response.json(
          { error: { code, message } },
          { headers: responseHeaders, status: structureErrorStatus(code) },
        );
      }

      if (this.drainOutbox) {
        try {
          await this.drainOutbox.execute();
        } catch (err) {
          console.error("[PackageController.handleMoveItem] Drain outbox error:", err);
        }
      }

      return Response.json(result.value, { headers: responseHeaders, status: 200 });
    } catch (cause) {
      const errorCorrelationId = randomUUID();
      console.error(`[PackageController.moveItem] Error inesperado (${errorCorrelationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: responseHeaders, status: 500 },
      );
    }
  }
}
