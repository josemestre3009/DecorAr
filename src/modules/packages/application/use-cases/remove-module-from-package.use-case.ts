import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { Clock, IdGenerator } from "../../../../shared/application/ports";
import type { PackageModuleRemovedEvent } from "../../../events/domain/event-contracts";
import type { PackageChangeOutbox } from "../../../events/application/outbox";
import type { RemoveModuleFromPackageDto } from "../dtos/package.dto";
import type { PackageReader } from "../ports/package-reader.port";

export class RemoveModuleFromPackageUseCase {
  constructor(
    private readonly packageReader: PackageReader,
    private readonly outbox: PackageChangeOutbox,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(dto: RemoveModuleFromPackageDto): Promise<Result<void, DomainError>> {
    if (!dto.packageId || dto.packageId.trim().length === 0) {
      return err(new DomainError("package.invalid", "Identificador de paquete inválido"));
    }

    if (!dto.userId || dto.userId.trim().length === 0) {
      return err(new DomainError("package.invalid_user", "Identificador de usuario inválido"));
    }

    if (!dto.itemId || dto.itemId.trim().length === 0) {
      return err(new DomainError("package.invalid_item", "Identificador de elemento inválido"));
    }

    const itemResult = await this.packageReader.getItemModuleId(dto.packageId, dto.itemId);
    if (!itemResult.ok) {
      return err(itemResult.error);
    }
    const moduleId = itemResult.value;
    if (!moduleId) {
      return err(new DomainError("package.item_not_found", "No encontramos este elemento en el paquete."));
    }

    const eventId = this.idGenerator.generate();

    const event: PackageModuleRemovedEvent = {
      eventId,
      occurredAt: this.clock.now().toISOString(),
      packageId: dto.packageId,
      payload: {
        itemId: dto.itemId,
        moduleId,
      },
      schemaVersion: 1,
      type: "package.module.removed",
      userId: dto.userId,
    };

    const commitResult = await this.outbox.commit(event);
    if (!commitResult.ok) {
      return err(commitResult.error);
    }

    return ok(undefined);
  }
}
