import type { SessionGateway } from "../../../shared/application/ports";
import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { SessionUser } from "../../../shared/domain/session";

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Reads who owns a package. `null` when the package does not exist or is not visible. */
export interface PackageOwnerReader {
  findOwnerId(packageId: string): Promise<Result<string | null, DomainError>>;
}

/**
 * Authorization that every package Route Handler runs before its use case.
 * Ownership is compared here, so it holds even if RLS were disabled: RLS is a
 * second barrier, not this one. A foreign package is reported as
 * `package.not_found` so its existence is not revealed.
 */
export class AuthorizePackageAccessUseCase {
  constructor(
    private readonly session: Pick<SessionGateway, "currentUser">,
    private readonly owners: PackageOwnerReader,
  ) {}

  async execute(packageId: string): Promise<Result<SessionUser, DomainError>> {
    const user = await this.session.currentUser();

    if (!user) {
      return err(new DomainError("auth.unauthenticated", "Inicia sesión para continuar."));
    }

    if (!UUID.test(packageId)) {
      return notFound();
    }

    const owner = await this.owners.findOwnerId(packageId);

    if (!owner.ok) {
      return owner;
    }

    return owner.value === user.id ? ok(user) : notFound();
  }
}

function notFound(): Result<never, DomainError> {
  return err(new DomainError("package.not_found", "No encontramos este paquete."));
}
