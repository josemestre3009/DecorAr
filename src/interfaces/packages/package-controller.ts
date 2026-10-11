import { randomUUID } from "node:crypto";

import type { DrainOutboxUseCase } from "../../modules/events/application/drain-outbox.use-case";
import type { AuthorizePackageAccessUseCase } from "../../modules/packages/application/authorize-package-access.use-case";
import type { AddModuleToGroupUseCase } from "../../modules/packages/application/use-cases/add-module-to-group.use-case";
import type { AddModuleToPackageUseCase } from "../../modules/packages/application/use-cases/add-module-to-package.use-case";
import type { ClonePackageUseCase } from "../../modules/packages/application/use-cases/clone-package.use-case";
import type { CreatePackageGroupUseCase } from "../../modules/packages/application/use-cases/create-package-group.use-case";
import type { CreatePackageUseCase } from "../../modules/packages/application/use-cases/create-package.use-case";
import type { RemoveModuleFromPackageUseCase } from "../../modules/packages/application/use-cases/remove-module-from-package.use-case";
import type { SessionGateway } from "../../shared/application/ports";
import { checkPackageAccess } from "./package-access";

export type PackageControllerOptions = {
  readonly clonePackageUseCase?: Pick<ClonePackageUseCase, "execute">;
  readonly createPackageGroupUseCase?: Pick<CreatePackageGroupUseCase, "execute">;
  readonly addModuleToGroupUseCase?: Pick<AddModuleToGroupUseCase, "execute">;
  readonly drainOutbox?: Pick<DrainOutboxUseCase, "execute">;
  readonly defaultHeaders?: Record<string, string>;
  readonly headers?: Record<string, string>;
};

/** Estado HTTP de los errores al agregar elementos o grupos (incluye el Composite, DECOR-25). */
function groupErrorStatus(code: string): number {
  if (
    code === "package.capacity_exceeded" ||
    code === "package.group_depth_exceeded" ||
    code === "package.group_cycle"
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
    "drainOutbox" in arg ||
    "defaultHeaders" in arg ||
    "headers" in arg
  );
}

export class PackageController {
  private readonly clonePackageUseCase?: Pick<ClonePackageUseCase, "execute">;
  private readonly createPackageGroupUseCase?: Pick<CreatePackageGroupUseCase, "execute">;
  private readonly addModuleToGroupUseCase?: Pick<AddModuleToGroupUseCase, "execute">;
  private readonly drainOutbox?: Pick<DrainOutboxUseCase, "execute">;
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
      this.drainOutbox = optionsOrCloneOrDrain.drainOutbox;
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


  async handleCreatePackage(request: Request): Promise<Response> {
    try {
      const user = await this.sessionGateway.currentUser();
      if (!user) {
        return Response.json(
          { error: { code: "auth.unauthenticated", message: "Inicia sesión para continuar." } },
          { headers: this.defaultHeaders, status: 401 },
        );
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
          { headers: this.defaultHeaders, status },
        );
      }

      return Response.json(result.value, {
        headers: this.defaultHeaders,
        status: 201,
      });
    } catch (cause) {
      const correlationId = randomUUID();
      console.error(`[PackageController.create] Error inesperado (${correlationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: this.defaultHeaders, status: 500 },
      );
    }
  }

  async handleAddItem(request: Request, packageId: string): Promise<Response> {
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

      const { moduleId, parentGroupId } = body as Record<string, unknown>;
      if (typeof moduleId !== "string" || moduleId.trim().length === 0) {
        return Response.json(
          { error: { code: "package.invalid_module", message: "El módulo no es válido" } },
          { headers: this.defaultHeaders, status: 400 },
        );
      }

      if (parentGroupId !== undefined && parentGroupId !== null && typeof parentGroupId !== "string") {
        return Response.json(
          { error: { code: "package.invalid_group", message: "El grupo no es válido" } },
          { headers: this.defaultHeaders, status: 400 },
        );
      }

      // Con parentGroupId la hoja entra en un grupo existente (Composite, DECOR-25).
      const groupId = typeof parentGroupId === "string" ? parentGroupId.trim() : "";
      if (groupId.length > 0 && !this.addModuleToGroupUseCase) {
        return Response.json(
          { error: { code: "internal_error", message: "Caso de uso de grupos no disponible." } },
          { headers: this.defaultHeaders, status: 500 },
        );
      }

      const result =
        groupId.length > 0 && this.addModuleToGroupUseCase
          ? await this.addModuleToGroupUseCase.execute({
              groupId,
              moduleId: moduleId.trim(),
              packageId,
              userId: access.user.id,
            })
          : await this.addModuleToPackageUseCase.execute({
              moduleId: moduleId.trim(),
              packageId,
              userId: access.user.id,
            });

      if (!result.ok) {
        const { code, message } = result.error;
        const status = groupErrorStatus(code);

        return Response.json(
          { error: { code, message } },
          { headers: this.defaultHeaders, status },
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
        headers: this.defaultHeaders,
        status: 201,
      });
    } catch (cause) {
      const correlationId = randomUUID();
      console.error(`[PackageController.addItem] Error inesperado (${correlationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: this.defaultHeaders, status: 500 },
      );
    }
  }

  async handleRemoveItem(packageId: string, itemId: string): Promise<Response> {
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
          { headers: this.defaultHeaders, status: 400 },
        );
      }

      const result = await this.removeModuleFromPackageUseCase.execute({
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
          { headers: this.defaultHeaders, status },
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
        headers: this.defaultHeaders,
        status: 204,
      });
    } catch (cause) {
      const correlationId = randomUUID();
      console.error(`[PackageController.removeItem] Error inesperado (${correlationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: this.defaultHeaders, status: 500 },
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
    try {
      const access = await checkPackageAccess(
        this.authorizePackageAccess,
        packageId,
        this.defaultHeaders,
      );
      if (!access.ok) {
        return access.response;
      }

      if (!this.createPackageGroupUseCase) {
        return Response.json(
          { error: { code: "internal_error", message: "Caso de uso de grupos no disponible." } },
          { headers: this.defaultHeaders, status: 500 },
        );
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

      const { children, name, parentGroupId } = body as Record<string, unknown>;

      if (typeof name !== "string") {
        return Response.json(
          { error: { code: "package.invalid_group_name", message: "El nombre del grupo es obligatorio" } },
          { headers: this.defaultHeaders, status: 400 },
        );
      }

      if (parentGroupId !== undefined && parentGroupId !== null && typeof parentGroupId !== "string") {
        return Response.json(
          { error: { code: "package.invalid_group", message: "El grupo no es válido" } },
          { headers: this.defaultHeaders, status: 400 },
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
          { headers: this.defaultHeaders, status: 400 },
        );
      }

      const result = await this.createPackageGroupUseCase.execute({
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
          { headers: this.defaultHeaders, status: groupErrorStatus(code) },
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
        headers: this.defaultHeaders,
        status: 201,
      });
    } catch (cause) {
      const correlationId = randomUUID();
      console.error(`[PackageController.createGroup] Error inesperado (${correlationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: this.defaultHeaders, status: 500 },
      );
    }
  }
}
