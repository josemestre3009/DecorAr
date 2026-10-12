import { randomUUID } from "node:crypto";

import { createPackageController, createPackageListQueryDependencies } from "@/composition/server";
import { handleListPackagesRequest } from "@/interfaces/packages/package-controller";

export async function GET(request: Request): Promise<Response> {
  try {
    // Listado mínimo: sólo sesión + `ListOwnedPackagesUseCase` bajo RLS. No
    // construye `PackageController` ni exige `SUPABASE_SERVICE_ROLE_KEY`.
    const dependencies = await createPackageListQueryDependencies();
    return await handleListPackagesRequest(request, dependencies);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(`[API GET /api/packages] Uncaught error (${correlationId}):`, cause);

    return Response.json(
      {
        correlationId,
        error: { code: "internal_error", message: "No pudimos completar la operación." },
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const controller = await createPackageController();
    return await controller.handleCreatePackage(request);
  } catch (cause) {
    const correlationId = randomUUID();
    console.error(`[API POST /api/packages] Uncaught error (${correlationId}):`, cause);

    return Response.json(
      {
        correlationId,
        error: { code: "internal_error", message: "No pudimos completar la operación." },
      },
      { status: 500 },
    );
  }
}
