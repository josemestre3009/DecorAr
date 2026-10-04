import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import { type CatalogModuleDto } from "../dtos/catalog-module.dto";
import { type CatalogRepository } from "../ports/catalog-repository.port";

export class GetActiveCatalogModulesUseCase {
  constructor(private readonly catalogRepository: CatalogRepository) {}

  async execute(): Promise<Result<CatalogModuleDto[], DomainError>> {
    const modulesResult = await this.catalogRepository.getActiveModules();

    if (!modulesResult.ok) {
      return err(modulesResult.error);
    }

    const dtos: CatalogModuleDto[] = modulesResult.value
      .filter((module) => module.isActive())
      .map((module) => ({
        id: module.id,
        name: module.name,
        priceCop: module.priceCop,
        areaM2: module.areaM2,
        widthM: module.widthM as number,
        heightM: module.heightM as number,
        depthM: module.depthM as number,
        glbUrl: module.glbUrl as string,
        usdzUrl: module.usdzUrl as string,
        posterUrl: module.posterUrl,
        assetId: module.assetId,
        version: module.version,
      }));

    return ok(dtos);
  }
}
