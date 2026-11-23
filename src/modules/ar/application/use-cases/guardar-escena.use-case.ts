import { err, type Result } from "../../../../shared/domain/result";
import type { DomainError } from "../../../../shared/domain/domain-error";
import { EscenaMontaje, type TransformacionItem } from "../../domain/escena-montaje";
import type { EscenaRepository } from "../ports/escena-repository.port";

export interface GuardarEscenaDto {
  readonly packageId: string;
  readonly userId: string;
  readonly transformaciones: readonly TransformacionItem[];
  /** Obligatoria: sin ella no se puede detectar un guardado concurrente. */
  readonly expectedSceneVersion: number;
}

/**
 * `PUT /api/packages/{packageId}/scene` (DECOR-46). Valida la escena completa
 * en dominio antes de persistir, para que el repositorio nunca reciba datos
 * fuera de límites. No notifica a `PackageChangeConsumer`: guardar la escena
 * no afecta al presupuesto ni a `packages.version`.
 */
export class GuardarEscenaUseCase {
  constructor(private readonly escenas: Pick<EscenaRepository, "guardar">) {}

  async execute(dto: GuardarEscenaDto): Promise<Result<number, DomainError>> {
    const escena = EscenaMontaje.crear(dto.transformaciones);
    if (!escena.ok) {
      return err(escena.error);
    }

    return this.escenas.guardar({
      expectedSceneVersion: dto.expectedSceneVersion,
      packageId: dto.packageId,
      transformaciones: escena.value.transformaciones,
      userId: dto.userId,
    });
  }
}
