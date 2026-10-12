import { randomUUID } from "node:crypto";

import type { DrainOutboxUseCase } from "../../modules/events/application/drain-outbox.use-case";
import type { AuthorizePackageAccessUseCase } from "../../modules/packages/application/authorize-package-access.use-case";
import type { AddModuleToGroupUseCase } from "../../modules/packages/application/use-cases/add-module-to-group.use-case";
import { MAX_BATCH_QUANTITY } from "../../modules/packages/application/dtos/package.dto";
import type { AddModuleToPackageUseCase } from "../../modules/packages/application/use-cases/add-module-to-package.use-case";
import type { ClonePackageUseCase } from "../../modules/packages/application/use-cases/clone-package.use-case";
import type { CreatePackageGroupUseCase } from "../../modules/packages/application/use-cases/create-package-group.use-case";
import type { CreatePackageUseCase } from "../../modules/packages/application/use-cases/create-package.use-case";
import type { DeletePackageGroupUseCase } from "../../modules/packages/application/use-cases/delete-package-group.use-case";
import type { ListOwnedPackagesUseCase } from "../../modules/packages/application/use-cases/list-owned-packages.use-case";
import type { RemoveModuleFromPackageUseCase } from "../../modules/packages/application/use-cases/remove-module-from-package.use-case";
import type { RenamePackageGroupUseCase } from "../../modules/packages/application/use-cases/rename-package-group.use-case";
import type { SessionGateway } from "../../shared/application/ports";
import type { SessionUser } from "../../shared/domain/session";
import { checkPackageAccess } from "./package-access";

export type PackageControllerOptions = {
  readonly clonePackageUseCase?: Pick<ClonePackageUseCase, "execute">;
  readonly createPackageGroupUseCase?: Pick<CreatePackageGroupUseCase, "execute">;
  readonly addModuleToGroupUseCase?: Pick<AddModuleToGroupUseCase, "execute">;
  readonly renamePackageGroupUseCase?: Pick<RenamePackageGroupUseCase, "execute">;
  readonly deletePackageGroupUseCase?: Pick<DeletePackageGroupUseCase, "execute">;
  readonly drainOutbox?: Pick<DrainOutboxUseCase, "execute">;
  readonly listOwnedPackagesUseCase?: Pick<ListOwnedPackagesUseCase, "execute">;
  readonly defaultHeaders?: Record<string, string>;
  readonly headers?: Record<string, string>;
};

/**
 * Estado HTTP de los errores al agregar elementos o grupos (incluye el
 * Composite, DECOR-25) y al renombrar o eliminar grupos (DECOR-43).
 */
function groupErrorStatus(code: string): number {
  if (
    code === "package.capacity_exceeded" ||
    code === "package.group_depth_exceeded" ||
    code === "package.group_cycle" ||
    code === "package.group_integrity"
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

function isPackageControllerOptions(
  arg: unknown,
): arg is PackageControllerOptions {
  if (typeof arg !== "object" || arg === null) return false;
  return (
    "clonePackageUseCase" in arg ||
    "createPackageGroupUseCase" in arg ||
    "addModuleToGroupUseCase" in arg ||
    "renamePackageGroupUseCase" in arg ||
    "deletePackageGroupUseCase" in arg ||
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
  private readonly renamePackageGroupUseCase?: Pick<RenamePackageGroupUseCase, "execute">;
  private readonly deletePackageGroupUseCase?: Pick<DeletePackageGroupUseCase, "execute">;
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
      this.renamePackageGroupUseCase = optionsOrCloneOrDrain.renamePackageGroupUseCase;
      this.deletePackageGroupUseCase = optionsOrCloneOrDrain.deletePackageGroupUseCase;
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

      const { capacityM2, spaceType } = body as Record<string, unknown>;

      const result = await this.createPackageUseCase.execute({
        capacityM2: Number(capacityM2),
        spaceType: String(spaceType ?? ""),
        userId: user.id,
      });

      if (!result.ok) {
        const { code, message } = result.error;
        const status =
          code === "package.invalid_space_type" || code === "package.invalid_capacity"
            ? 422
            : code === "package.persistence_error"
              ? 500
              : 400;

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

      const { children, name, parentGroupId } = body as Record<string, unknown>;

      if (typeof name !== "string") {
        return Response.json(
          { error: { code: "package.invalid_group_name", message: "El nombre del grupo es obligatorio" } },
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
   * PATCH /api/packages/{packageId}/groups/{groupId} (DECOR-43): renombra un
   * grupo. 200 con `{groupId, name, structureVersion}`. No emite eventos, así
   * que no hay outbox que drenar.
   */
  async handleRenameGroup(request: Request, packageId: string, groupId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    const responseHeaders = { ...this.defaultHeaders, [CORRELATION_ID_HEADER]: correlationId };

    try {
      const access = await checkPackageAccess(this.authorizePackageAccess, packageId, responseHeaders);
      if (!access.ok) {
        return access.response;
      }

      if (!this.renamePackageGroupUseCase) {
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

      const { name } = body as Record<string, unknown>;
      if (typeof name !== "string") {
        return Response.json(
          { error: { code: "package.invalid_group_name", message: "El nombre del grupo es obligatorio" } },
          { headers: responseHeaders, status: 400 },
        );
      }

      const result = await this.renamePackageGroupUseCase.execute({
        groupId,
        name,
        packageId,
        userId: access.user.id,
      });

      if (!result.ok) {
        const { code, message } = result.error;
        return Response.json(
          { error: { code, message } },
          { headers: responseHeaders, status: groupErrorStatus(code) },
        );
      }

      return Response.json(result.value, { headers: responseHeaders, status: 200 });
    } catch (cause) {
      console.error(`[PackageController.renameGroup] Error inesperado (${correlationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: responseHeaders, status: 500 },
      );
    }
  }

  /**
   * DELETE /api/packages/{packageId}/groups/{groupId} (DECOR-43): elimina el
   * grupo y promueve su contenido al padre en una transacción. 204 sin
   * cuerpo, como el DELETE de elementos. No emite eventos de módulo.
   */
  async handleDeleteGroup(request: Request, packageId: string, groupId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    const responseHeaders = { ...this.defaultHeaders, [CORRELATION_ID_HEADER]: correlationId };

    try {
      const access = await checkPackageAccess(this.authorizePackageAccess, packageId, responseHeaders);
      if (!access.ok) {
        return access.response;
      }

      if (!this.deletePackageGroupUseCase) {
        return Response.json(
          { error: { code: "internal_error", message: "Caso de uso de grupos no disponible." } },
          { headers: responseHeaders, status: 500 },
        );
      }

      const result = await this.deletePackageGroupUseCase.execute({
        groupId,
        packageId,
        userId: access.user.id,
      });

      if (!result.ok) {
        const { code, message } = result.error;
        return Response.json(
          { error: { code, message } },
          { headers: responseHeaders, status: groupErrorStatus(code) },
        );
      }

      return new Response(null, { headers: responseHeaders, status: 204 });
    } catch (cause) {
      console.error(`[PackageController.deleteGroup] Error inesperado (${correlationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: responseHeaders, status: 500 },
      );
    }
  }
}
