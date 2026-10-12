import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { Clock, IdGenerator } from "../../../../shared/application/ports";
import type { PackageModuleAddedEvent } from "../../../events/domain/event-contracts";
import type { PackageChangeOutbox } from "../../../events/application/outbox";
import { PaqueteDecoracion } from "../../domain/decoration-package";
import { MAX_BATCH_QUANTITY, type AddedItemDto, type AddModuleToPackageDto } from "../dtos/package.dto";
import type { CatalogModuleReader } from "../ports/catalog-module-reader.port";
import { notifyPackageChange, type PackageChangeConsumer } from "../ports/package-change-consumer.port";
import type { PackageReader } from "../ports/package-reader.port";

export class AddModuleToPackageUseCase {
  constructor(
    private readonly packageReader: PackageReader,
    private readonly catalogReader: CatalogModuleReader,
    private readonly outbox: PackageChangeOutbox,
    private readonly clock: Clock,
    private readonly idGenerator: IdGenerator,
    private readonly changeConsumer?: PackageChangeConsumer,
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

    const quantity = dto.quantity ?? 1;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_BATCH_QUANTITY) {
      return err(
        new DomainError(
          "package.invalid_quantity",
          `La cantidad debe ser un entero entre 1 y ${MAX_BATCH_QUANTITY}`,
        ),
      );
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

    const usedM2 = packageEntityResult.value.espacioUsadoM2;
    if (usedM2 + moduleDetail.areaM2 * quantity > packageDetail.capacityM2) {
      return err(
        new DomainError(
          "package.capacity_exceeded",
          `No se agregó "${moduleDetail.name}": excede la capacidad del espacio (${usedM2 + moduleDetail.areaM2 * quantity}/${packageDetail.capacityM2} m²).`,
        ),
      );
    }

    for (let index = 0; index < quantity; index += 1) {
      const addValidation = packageEntityResult.value.agregarModulo({
        id: `${moduleDetail.id}-${index}`,
        nombre: moduleDetail.name,
        ocupaM2: moduleDetail.areaM2,
        precio: moduleDetail.priceCop,
      });

      if (!addValidation.ok) {
        return err(addValidation.error);
      }
    }

    const occurredAt = this.clock.now().toISOString();
    const events: PackageModuleAddedEvent[] = Array.from({ length: quantity }, () => {
      const itemId = this.idGenerator.generate();
      return {
        eventId: this.idGenerator.generate(),
        occurredAt,
        packageId: dto.packageId,
        payload: { itemId, moduleId: dto.moduleId },
        schemaVersion: 1,
        type: "package.module.added",
        userId: dto.userId,
      };
    });

    const commitResult = quantity === 1
      ? dto.correlationId
        ? await this.outbox.commit(events[0], packageDetail.version, dto.correlationId)
        : await this.outbox.commit(events[0], packageDetail.version)
      : this.outbox.commitBatch
        ? await this.outbox.commitBatch(events, packageDetail.version, dto.correlationId)
        : err(new DomainError("outbox.persistence_error", "La escritura por lotes no está disponible"));
    if (!commitResult.ok) {
      return err(commitResult.error);
    }

    await notifyPackageChange(this.changeConsumer, events[events.length - 1]);

    const itemIds = events.map((event) => event.payload.itemId);

    return ok({
      itemId: itemIds[0],
      itemIds,
      packageVersion: commitResult.value,
    });
  }
}
