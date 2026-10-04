import { randomUUID } from "node:crypto";

import { type GetActiveCatalogModulesUseCase } from "../../modules/catalog/application/use-cases/get-active-catalog-modules.use-case";

export class CatalogController {
  constructor(private readonly getActiveModulesUseCase: GetActiveCatalogModulesUseCase) {}

  async handleGetModules(): Promise<Response> {
    try {
      const result = await this.getActiveModulesUseCase.execute();

      if (!result.ok) {
        const correlationId = randomUUID();
        console.error(
          `[CatalogController] Error retrieving modules (correlationId: ${correlationId}):`,
          result.error,
        );

        return Response.json(
          {
            error: "Internal Server Error",
            correlationId,
          },
          { status: 500 },
        );
      }

      return Response.json(result.value, {
        status: 200,
        headers: {
          "Cache-Control": "public, max-age=60, s-maxage=300",
        },
      });
    } catch (error) {
      const correlationId = randomUUID();
      console.error(
        `[CatalogController] Uncaught error (correlationId: ${correlationId}):`,
        error,
      );

      return Response.json(
        {
          error: "Internal Server Error",
          correlationId,
        },
        { status: 500 },
      );
    }
  }
}
