import { DomainError } from "../../../../shared/domain/domain-error";
import { err, type Result } from "../../../../shared/domain/result";
import type { PackageListReader, PackageSummary } from "../ports/package-reader.port";

export class ListOwnedPackagesUseCase {
  constructor(private readonly reader: PackageListReader) {}

  execute(userId: string): Promise<Result<readonly PackageSummary[], DomainError>> {
    if (userId.trim().length === 0) {
      return Promise.resolve(
        err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar.")),
      );
    }

    return this.reader.listByOwner(userId);
  }
}
