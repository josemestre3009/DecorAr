import type { AuthorizePackageAccessUseCase } from "../../modules/packages/application/authorize-package-access.use-case";
import type { SessionUser } from "../../shared/domain/session";

export type PackageAccess =
  | { readonly ok: true; readonly user: SessionUser }
  | { readonly ok: false; readonly response: Response };

/**
 * HTTP adapter for package ownership. A package Route Handler calls it first
 * and returns `response` untouched when access is denied:
 * 401 without a valid session, 404 for a missing or foreign package.
 */
export async function checkPackageAccess(
  useCase: Pick<AuthorizePackageAccessUseCase, "execute">,
  packageId: string,
  headers: Record<string, string> = {},
): Promise<PackageAccess> {
  const result = await useCase.execute(packageId);

  if (result.ok) {
    return { ok: true, user: result.value };
  }

  const { code, message } = result.error;
  const status =
    code === "auth.unauthenticated" ? 401 : code === "package.not_found" ? 404 : 500;
  const body =
    status === 500
      ? { code: "internal_error", message: "No pudimos completar la operación." }
      : { code, message };

  if (status === 500) {
    console.error("[package-access] authorization lookup failed", result.error);
  }

  return { ok: false, response: Response.json({ error: body }, { status, headers }) };
}
