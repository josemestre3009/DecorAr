import { createCatalogController } from "../../../composition/server";

export async function GET(): Promise<Response> {
  const controller = await createCatalogController();
  return controller.handleGetModules();
}
