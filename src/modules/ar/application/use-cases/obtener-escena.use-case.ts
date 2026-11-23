import type { DomainError } from "../../../../shared/domain/domain-error";
import type { Result } from "../../../../shared/domain/result";
import type { EscenaRecord, EscenaRepository } from "../ports/escena-repository.port";

/**
 * `GET /api/packages/{packageId}/scene` (DECOR-46). El Route Handler ya
 * verificó sesión y propiedad con `checkPackageAccess`; aquí solo se lee.
 */
export class ObtenerEscenaUseCase {
  constructor(private readonly escenas: Pick<EscenaRepository, "leer">) {}

  async execute(packageId: string): Promise<Result<EscenaRecord, DomainError>> {
    return this.escenas.leer(packageId);
  }
}
