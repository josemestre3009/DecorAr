import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../../shared/domain/result";
import type { DatosActivo3D } from "../../domain/activo-3d-compartido";
import type { CapacidadesAR } from "../../domain/capacidades-ar";
import { crearElementoAR, type ElementoAR } from "../../domain/elemento-ar";
import type { FabricaActivos3D } from "../../domain/fabrica-activos-3d";
import { InstanciaDecorativa } from "../../domain/instancia-decorativa";
import {
  elegirRenderizador,
  RENDERIZADORES_AR,
  type ConfiguracionVisor,
  type RenderizadorAR,
} from "../../domain/renderizador-ar";

/**
 * Campos del catálogo que la vista AR necesita. `CatalogModuleDto` los cumple
 * por estructura; el módulo AR no depende del módulo de catálogo.
 */
export interface ModuloParaAR extends DatosActivo3D {
  readonly name: string;
}

export interface VistaAR {
  readonly elemento: ElementoAR;
  readonly configuracion: ConfiguracionVisor;
}

/**
 * Prepara lo que la pantalla 3D muestra:
 * 1. Flyweight: la fábrica entrega el activo compartido por `assetId`+`version`.
 * 2. La instancia decorativa guarda el estado propio de esta copia.
 * 3. Bridge: se elige el renderizador según el dispositivo y el elemento
 *    (MesaAR, ArcoAR o PistaAR) delega en él su presentación.
 */
export class PrepararVistaARUseCase {
  constructor(
    private readonly fabrica: FabricaActivos3D,
    private readonly renderizadores: readonly RenderizadorAR[] = RENDERIZADORES_AR,
  ) {}

  execute(modulo: ModuloParaAR, capacidades: CapacidadesAR): Result<VistaAR, DomainError> {
    const nombre = modulo.name.trim();

    if (nombre.length === 0) {
      return err(new DomainError("ar.invalid_name", "El módulo no tiene nombre."));
    }

    const activo = this.fabrica.obtener(modulo);

    if (!activo.ok) {
      return activo;
    }

    const instancia = InstanciaDecorativa.crear(activo.value);

    if (!instancia.ok) {
      return instancia;
    }

    const renderizador = elegirRenderizador(capacidades, this.renderizadores);
    const elemento = crearElementoAR(nombre, instancia.value, renderizador);

    if (!elemento.ok) {
      return elemento;
    }

    return ok({ configuracion: elemento.value.presentar(), elemento: elemento.value });
  }
}
