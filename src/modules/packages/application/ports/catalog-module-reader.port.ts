import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";

export interface CatalogModuleSummary {
  readonly id: string;
  readonly name: string;
  readonly areaM2: number;
  readonly priceCop: number;
}

export interface CatalogModuleReader {
  getModuleById(moduleId: string): Promise<Result<CatalogModuleSummary | null, DomainError>>;
}
