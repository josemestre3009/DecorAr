import { randomUUID } from "node:crypto";

import type { DrainOutboxUseCase } from "../../modules/events/application/drain-outbox.use-case";
import type { AuthorizePackageAccessUseCase } from "../../modules/packages/application/authorize-package-access.use-case";
import type { AddModuleToPackageUseCase } from "../../modules/packages/application/use-cases/add-module-to-package.use-case";
import type { CreatePackageUseCase } from "../../modules/packages/application/use-cases/create-package.use-case";
import type { RemoveModuleFromPackageUseCase } from "../../modules/packages/application/use-cases/remove-module-from-package.use-case";
import type { SessionGateway } from "../../shared/application/ports";
import { checkPackageAccess } from "./package-access";

export class PackageController {
  constructor(
    private readonly sessionGateway: Pick<SessionGateway, "currentUser">,
    private readonly authorizePackageAccess: AuthorizePackageAccessUseCase,
    private readonly createPackageUseCase: CreatePackageUseCase,
    private readonly addModuleToPackageUseCase: AddModuleToPackageUseCase,
    private readonly removeModuleFromPackageUseCase: RemoveModuleFromPackageUseCase,
    private readonly drainOutbox?: Pick<DrainOutboxUseCase, "execute">,
    private readonly defaultHeaders: Record<string, string> = {},
  ) {}

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

      const result = await this.addModuleToPackageUseCase.execute({
        moduleId: moduleId.trim(),
        packageId,
        parentGroupId: typeof parentGroupId === "string" ? parentGroupId : undefined,
        userId: access.user.id,
      });

      if (!result.ok) {
        const { code, message } = result.error;
        let status = 400;

        if (code === "package.capacity_exceeded") {
          status = 422;
        } else if (code === "package.module_not_found" || code === "package.not_found") {
          status = 404;
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
}
