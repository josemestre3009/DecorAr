import { randomUUID } from "node:crypto";

import type { AuthorizePackageAccessUseCase } from "../../modules/packages/application/authorize-package-access.use-case";
import type { CreateEventTemplateUseCase } from "../../modules/packages/application/use-cases/create-event-template.use-case";
import type { DeleteEventTemplateUseCase } from "../../modules/packages/application/use-cases/delete-event-template.use-case";
import type { InstantiateEventFromTemplateUseCase } from "../../modules/packages/application/use-cases/instantiate-event-from-template.use-case";
import type { ListOwnedEventTemplatesUseCase } from "../../modules/packages/application/use-cases/list-owned-event-templates.use-case";
import type { RenameEventTemplateUseCase } from "../../modules/packages/application/use-cases/rename-event-template.use-case";
import type { EventTemplateReader } from "../../modules/packages/application/ports/event-template-repository.port";
import type { SessionGateway } from "../../shared/application/ports";
import { checkPackageAccess } from "../packages/package-access";
import { checkEventTemplateAccess } from "./event-template-access";

const CORRELATION_ID_HEADER = "x-correlation-id";

export type EventTemplateControllerDependencies = {
  readonly sessionGateway: Pick<SessionGateway, "currentUser">;
  readonly authorizePackageAccess: Pick<AuthorizePackageAccessUseCase, "execute">;
  readonly eventTemplateReader: Pick<EventTemplateReader, "getTemplate">;
  readonly listEventTemplates: Pick<ListOwnedEventTemplatesUseCase, "execute">;
  readonly createEventTemplate: Pick<CreateEventTemplateUseCase, "execute">;
  readonly instantiateEvent: Pick<InstantiateEventFromTemplateUseCase, "execute">;
  readonly renameEventTemplate: Pick<RenameEventTemplateUseCase, "execute">;
  readonly deleteEventTemplate: Pick<DeleteEventTemplateUseCase, "execute">;
  readonly defaultHeaders?: Record<string, string>;
};

/** Reads `x-correlation-id` from the request or generates one (DECOR-31). */
function correlationIdFor(request: Request): string {
  const provided = request.headers.get(CORRELATION_ID_HEADER);
  return provided && provided.trim().length > 0 ? provided.trim() : randomUUID();
}

/** Estado HTTP de los errores de plantilla; el detalle de un 500 nunca se filtra. */
function templateErrorStatus(code: string): number {
  if (code === "auth.unauthenticated") return 401;
  if (code === "template.not_found" || code === "package.not_found") return 404;
  if (
    code === "template.persistence_error" ||
    code === "package.persistence_error" ||
    code === "internal_error"
  ) {
    return 500;
  }
  if (code === "template.invalid_body" || code === "template.invalid_source") return 400;
  if (code.startsWith("template.") || code.startsWith("package.")) return 422;
  return 400;
}

async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

/**
 * HTTP boundary for private event templates (DECOR-44). Ownership is checked in
 * two places: here (package access before saving, template access before every
 * operation) and inside the service-role RPC. A foreign or missing resource is
 * always reported as 404, indistinguishable from one that does not exist.
 */
export class EventTemplateController {
  private readonly defaultHeaders: Record<string, string>;

  constructor(private readonly deps: EventTemplateControllerDependencies) {
    this.defaultHeaders = deps.defaultHeaders ?? {};
  }

  private headers(correlationId: string): Record<string, string> {
    return { ...this.defaultHeaders, [CORRELATION_ID_HEADER]: correlationId };
  }

  private errorResponse(
    correlationId: string,
    code: string,
    message: string,
    logLabel: string,
  ): Response {
    const status = templateErrorStatus(code);
    const headers = this.headers(correlationId);

    if (status === 500) {
      console.error(`[EventTemplateController.${logLabel}] (${correlationId}):`, code, message);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers, status },
      );
    }

    return Response.json({ error: { code, message } }, { headers, status });
  }

  async handleList(request: Request): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const user = await this.deps.sessionGateway.currentUser();
      if (!user) {
        return this.errorResponse(correlationId, "auth.unauthenticated", "Inicia sesión para continuar.", "list");
      }

      const result = await this.deps.listEventTemplates.execute(user.id);
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error.code, result.error.message, "list");
      }

      return Response.json({ templates: result.value }, { headers: this.headers(correlationId) });
    } catch (cause) {
      console.error(`[EventTemplateController.list] Error inesperado (${correlationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: this.headers(correlationId), status: 500 },
      );
    }
  }

  async handleCreate(request: Request): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const user = await this.deps.sessionGateway.currentUser();
      if (!user) {
        return this.errorResponse(correlationId, "auth.unauthenticated", "Inicia sesión para continuar.", "create");
      }

      const body = await readJsonBody(request);
      if (!body) {
        return this.errorResponse(correlationId, "template.invalid_body", "Se requiere un objeto JSON.", "create");
      }

      const packageId = typeof body.packageId === "string" ? body.packageId.trim() : "";
      if (packageId.length === 0) {
        return this.errorResponse(correlationId, "template.invalid_source", "Selecciona un evento válido.", "create");
      }

      // La propiedad del evento se comprueba en HTTP antes de copiar; el RPC la repite.
      const access = await checkPackageAccess(
        this.deps.authorizePackageAccess,
        packageId,
        this.headers(correlationId),
      );
      if (!access.ok) {
        return access.response;
      }

      const result = await this.deps.createEventTemplate.execute({
        name: typeof body.name === "string" ? body.name : "",
        packageId,
        userId: access.user.id,
      });
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error.code, result.error.message, "create");
      }

      return Response.json(result.value, { headers: this.headers(correlationId), status: 201 });
    } catch (cause) {
      console.error(`[EventTemplateController.create] Error inesperado (${correlationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: this.headers(correlationId), status: 500 },
      );
    }
  }

  async handleGet(request: Request, templateId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const access = await this.access(correlationId, templateId);
      if (!access.ok) return access.response;

      return Response.json(access.template, { headers: this.headers(correlationId) });
    } catch (cause) {
      console.error(`[EventTemplateController.get] Error inesperado (${correlationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: this.headers(correlationId), status: 500 },
      );
    }
  }

  async handleRename(request: Request, templateId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const access = await this.access(correlationId, templateId);
      if (!access.ok) return access.response;

      const body = await readJsonBody(request);
      if (!body) {
        return this.errorResponse(correlationId, "template.invalid_body", "Se requiere un objeto JSON.", "rename");
      }

      const result = await this.deps.renameEventTemplate.execute({
        name: typeof body.name === "string" ? body.name : "",
        templateId,
        userId: access.user.id,
      });
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error.code, result.error.message, "rename");
      }

      return Response.json(result.value, { headers: this.headers(correlationId), status: 200 });
    } catch (cause) {
      console.error(`[EventTemplateController.rename] Error inesperado (${correlationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: this.headers(correlationId), status: 500 },
      );
    }
  }

  async handleDelete(request: Request, templateId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const access = await this.access(correlationId, templateId);
      if (!access.ok) return access.response;

      const result = await this.deps.deleteEventTemplate.execute({
        templateId,
        userId: access.user.id,
      });
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error.code, result.error.message, "delete");
      }

      return new Response(null, { headers: this.headers(correlationId), status: 204 });
    } catch (cause) {
      console.error(`[EventTemplateController.delete] Error inesperado (${correlationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: this.headers(correlationId), status: 500 },
      );
    }
  }

  async handleInstantiate(request: Request, templateId: string): Promise<Response> {
    const correlationId = correlationIdFor(request);
    try {
      const access = await this.access(correlationId, templateId);
      if (!access.ok) return access.response;

      const body = await readJsonBody(request);
      if (!body) {
        return this.errorResponse(correlationId, "template.invalid_body", "Se requiere un objeto JSON.", "instantiate");
      }

      const result = await this.deps.instantiateEvent.execute({
        name: typeof body.name === "string" ? body.name : "",
        templateId,
        userId: access.user.id,
      });
      if (!result.ok) {
        return this.errorResponse(correlationId, result.error.code, result.error.message, "instantiate");
      }

      return Response.json(result.value, { headers: this.headers(correlationId), status: 201 });
    } catch (cause) {
      console.error(`[EventTemplateController.instantiate] Error inesperado (${correlationId}):`, cause);
      return Response.json(
        { error: { code: "internal_error", message: "No pudimos completar la operación." } },
        { headers: this.headers(correlationId), status: 500 },
      );
    }
  }

  private access(correlationId: string, templateId: string) {
    return checkEventTemplateAccess(
      {
        currentUser: () => this.deps.sessionGateway.currentUser(),
        reader: this.deps.eventTemplateReader,
      },
      templateId,
      this.headers(correlationId),
    );
  }
}
