import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { Clock, IdGenerator } from "../../../../shared/application/ports";
import type { PackageModuleAddedEvent } from "../../../events/domain/event-contracts";
import type { PackageChangeOutbox } from "../../../events/application/outbox";
import { PaqueteDecoracion } from "../../domain/decoration-package";
import type { AddedItemDto, AddModuleToPackageDto } from "../dtos/package.dto";
import type { CatalogModuleReader } from "../ports/catalog-module-reader.port";
import type { PackageReader } from "../ports/package-reader.port";

export class AddModuleToPackageUseCase {
  constructor(
    private readonly packageReader: PackageReader,
    private readonly catalogReader: CatalogModuleReader,
    private readonly outbox: PackageChangeOutbox,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
  ) {}

  async execute(dto: AddModuleToPackageDto): Promise<Result<AddedItemDto, DomainError>> {
    if (!dto.packageId || dto.packageId.trim().length === 0) {
      return err(new DomainError("package.invalid", "Identificador de paquete inválido"));
    }

    if (!dto.userId || dto.userId.trim().length === 0) {
      return err(new DomainError("package.invalid_user", "Identificador de usuario inválido"));
    }

    if (!dto.moduleId || dto.moduleId.trim().length === 0) {
      return err(new DomainError("package.invalid_module", "El módulo no es válido"));
    }

    const packageResult = await this.packageReader.getPackage(dto.packageId, dto.userId);
    if (!packageResult.ok) {
      return err(packageResult.error);
    }
    const packageDetail = packageResult.value;
    if (!packageDetail) {
      return err(new DomainError("package.not_found", "No encontramos este paquete."));
    }

    const moduleResult = await this.catalogReader.getModuleById(dto.moduleId);
    if (!moduleResult.ok) {
      return err(moduleResult.error);
    }
    const moduleDetail = moduleResult.value;
    if (!moduleDetail) {
      return err(new DomainError("package.module_not_found", "El módulo no existe en el catálogo"));
    }

    const packageEntityResult = PaqueteDecoracion.create({
      capacidadM2: packageDetail.capacityM2,
      modulos: packageDetail.items.map((item) => ({
        id: item.itemId,
        nombre: item.moduleId,
        ocupaM2: item.areaM2,
        precio: 0,
      })),
      tipoEspacio: packageDetail.spaceType,
    });

    if (!packageEntityResult.ok) {
      return err(packageEntityResult.error);
    }

    const addValidation = packageEntityResult.value.agregarModulo({
      id: moduleDetail.id,
      nombre: moduleDetail.name,
      ocupaM2: moduleDetail.areaM2,
      precio: moduleDetail.priceCop,
    });

    if (!addValidation.ok) {
      return err(addValidation.error);
    }

    const itemId = this.idGenerator.generate();
    const eventId = this.idGenerator.generate();

    const event: PackageModuleAddedEvent = {
      eventId,
      occurredAt: this.clock.now().toISOString(),
      packageId: dto.packageId,
      payload: {
        itemId,
        moduleId: dto.moduleId,
      },
      schemaVersion: 1,
      type: "package.module.added",
      userId: dto.userId,
    };

    const commitResult = await this.outbox.commit(event, packageDetail.version);
    if (!commitResult.ok) {
      return err(commitResult.error);
    }

    return ok({
      itemId,
      packageVersion: commitResult.value,
    });
  }
}
