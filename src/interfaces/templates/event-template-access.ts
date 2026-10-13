import type {
  EventTemplateDto,
} from "../../modules/packages/application/dtos/event-template.dto";
import type { EventTemplateReader } from "../../modules/packages/application/ports/event-template-repository.port";
import type { SessionUser } from "../../shared/domain/session";

export type EventTemplateAccess =
  | {
      readonly ok: true;
      readonly user: SessionUser;
      readonly template: EventTemplateDto;
    }
  | { readonly ok: false; readonly response: Response };

export type EventTemplateAccessDependencies = {
  readonly currentUser: () => Promise<SessionUser | null>;
  readonly reader: Pick<EventTemplateReader, "getTemplate">;
};

/**
 * HTTP adapter for template ownership. A template Route Handler calls it first
 * and returns `response` untouched when access is denied: 401 without a valid
 * session, 404 for a missing or foreign template (indistinguishable). It also
 * returns the template it looked up, so `GET` does not read it twice.
 */
export async function checkEventTemplateAccess(
  deps: EventTemplateAccessDependencies,
  templateId: string,
  headers: Record<string, string> = {},
): Promise<EventTemplateAccess> {
  let user: SessionUser | null;
  try {
    user = await deps.currentUser();
  } catch (cause) {
    console.error("[event-template-access] session lookup failed", cause);
    return { ok: false, response: internalError(headers) };
  }

  if (!user) {
    return {
      ok: false,
      response: Response.json(
        { error: { code: "auth.unauthenticated", message: "Inicia sesión para continuar." } },
        { headers, status: 401 },
      ),
    };
  }

  let found;
  try {
    found = await deps.reader.getTemplate(templateId, user.id);
  } catch (cause) {
    console.error("[event-template-access] ownership lookup failed", cause);
    return { ok: false, response: internalError(headers) };
  }

  if (!found.ok) {
    console.error("[event-template-access] ownership lookup failed", found.error);
    return { ok: false, response: internalError(headers) };
  }

  if (!found.value) {
    return {
      ok: false,
      response: Response.json(
        { error: { code: "template.not_found", message: "No encontramos esta plantilla." } },
        { headers, status: 404 },
      ),
    };
  }

  return { ok: true, template: found.value, user };
}

function internalError(headers: Record<string, string>): Response {
  return Response.json(
    { error: { code: "internal_error", message: "No pudimos completar la operación." } },
    { headers, status: 500 },
  );
}
