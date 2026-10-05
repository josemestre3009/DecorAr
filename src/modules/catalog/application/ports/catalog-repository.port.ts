import { DomainError } from "../../../../shared/domain/domain-error";
import { type Result } from "../../../../shared/domain/result";
import { CatalogModule } from "../../domain/catalog-module";

export interface CatalogRepository {
  getActiveModules(): Promise<Result<CatalogModule[], DomainError>>;
}
