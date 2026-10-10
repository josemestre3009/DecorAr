import { randomUUID } from "node:crypto";

import { createBudgetQueryDependencies, createPackageAccessDependencies } from "@/composition/server";
import { checkPackageAccess } from "@/interfaces/packages/package-access";

type RouteParams = { readonly params: Promise<{ readonly packageId: string }> };

/**
 * Resync endpoint for the confirmed budget (DECOR-33). Mei 4/6 (DECOR-21)
 * calls this on gap/reconnect/online/visibilitychange, in addition to the
 * live `budget.recalculated` Broadcast. Ownership follows the same
 * three-layer authorization as every other package endpoint (DECOR-30):
 * `checkPackageAccess` runs first and RLS filters the read as a second
 * barrier.
 */
export async function GET(_request: Request, { params }: RouteParams): Promise<Response> {
  const pendingHeaders: Record<string, string> = {};

  try {
    const { packageId } = await params;
    const { authorizePackageAccess } = await createPackageAccessDependencies({
      onHeaders: (headers) => {
        Object.assign(pendingHeaders, headers);
      },
    });

    const access = await checkPackageAccess(authorizePackageAccess, packageId, pendingHeaders);

    if (!access.ok) {
      return access.response;
    }

    const { getBudget } = await createBudgetQueryDependencies({
      onHeaders: (headers) => {
        Object.assign(pendingHeaders, headers);
      },
    });

    const budget = await getBudget.execute(packageId);

    if (!budget.ok) {
      const status = budget.error.code === "budget.not_found" ? 404 : 500;
      const body =
        status === 500
          ? { code: "internal_error", message: "No pudimos completar la operación." }
          : { code: budget.error.code, message: budget.error.message };

      if (status === 500) {
        console.error("[GET /api/packages/:id/budget] unexpected failure", budget.error);
      }

      return Response.json({ error: body }, { status, headers: pendingHeaders });
    }

    return Response.json(
      {
        totalCop: budget.value.totalCop,
        currency: budget.value.currency,
        packageVersion: budget.value.packageVersion,
        updatedAt: budget.value.updatedAt,
      },
      { status: 200, headers: pendingHeaders },
    );
  } catch (error) {
    const correlationId = randomUUID();
    console.error(
      `[GET /api/packages/:id/budget] Uncaught error (correlationId: ${correlationId}):`,
      error,
    );

    return Response.json(
      { error: { code: "internal_error", message: "No pudimos completar la operación." } },
      { status: 500, headers: pendingHeaders },
    );
  }
}
