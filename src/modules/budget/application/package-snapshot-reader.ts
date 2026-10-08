import type { DomainError } from "../../../shared/domain/domain-error";
import type { Result } from "../../../shared/domain/result";
import type { PackageSnapshot } from "../domain/calculate-budget";

/**
 * Rereads a package's priced Composite structure and its current
 * `packageVersion`. `null` when the package does not exist. Implemented in
 * `budget/infrastructure`; `budget` never imports `packages` (see
 * `packages-budget-coupling` in docs/architecture.md), so this port is the
 * only way Presupuesto learns the shape of a package.
 */
export interface PackageSnapshotReader {
  read(packageId: string): Promise<Result<PackageSnapshot | null, DomainError>>;
}
