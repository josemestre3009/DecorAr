import { randomUUID } from "node:crypto";

import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { ConfiguracionClonable } from "./configuration-cloneable";
import type { ModuloDecoracion } from "./decoration-module";
import { PaqueteDecoracion } from "./decoration-package";
import { isTipoEspacio, isValidCapacityM2, MAX_CAPACITY_M2, type TipoEspacio } from "./space-type";

export interface PreferenciasEvento {
  readonly style: string;
  readonly colors: readonly string[];
  readonly notes: string;
}

export interface ConfiguracionEventoProps {
  readonly id: string;
  /** Opcional desde DECOR-44: un evento puede no conocer todavía su espacio. */
  readonly tipoEspacio?: TipoEspacio | null;
  /** Opcional desde DECOR-44: el área disponible puede declararse después. */
  readonly capacidadM2?: number | null;
  readonly preferencias: PreferenciasEvento;
  readonly modulos?: readonly ModuloDecoracion[];
}

/**
 * Entidad concreta del patrón Prototype (DECOR-24 / docs/DecorAR.md sección 4.2).
 * Modela una configuración completa reutilizable de evento con sus preferencias
 * profundas (estilo, colores, notas) y elementos modulares asociados.
 */
export class ConfiguracionEvento implements ConfiguracionClonable {
  private readonly _id: string;
  private readonly _tipoEspacio: TipoEspacio | null;
  private readonly _capacidadM2: number | null;
  private _preferencias: {
    style: string;
    colors: string[];
    notes: string;
  };
  private readonly _modulos: ModuloDecoracion[];

  private constructor(
    id: string,
    tipoEspacio: TipoEspacio | null,
    capacidadM2: number | null,
    preferencias: { style: string; colors: string[]; notes: string },
    modulos: ModuloDecoracion[] = [],
  ) {
    this._id = id;
    this._tipoEspacio = tipoEspacio;
    this._capacidadM2 = capacidadM2;
    this._preferencias = preferencias;
    this._modulos = modulos;
  }

  public static create(props: ConfiguracionEventoProps): Result<ConfiguracionEvento, DomainError> {
    if (!props.id || props.id.trim().length === 0) {
      return err(new DomainError("package.invalid_id", "El identificador de configuración no puede estar vacío"));
    }

    const tipoEspacio = props.tipoEspacio ?? null;
    const capacidadM2 = props.capacidadM2 ?? null;

    if (tipoEspacio !== null && !isTipoEspacio(tipoEspacio)) {
      return err(
        new DomainError("package.invalid_space_type", `Tipo de espacio no soportado: ${String(tipoEspacio)}`),
      );
    }

    if (capacidadM2 !== null && !isValidCapacityM2(capacidadM2)) {
      return err(
        new DomainError(
          "package.invalid_capacity",
          `La capacidad debe ser un número positivo, finito y menor o igual a ${MAX_CAPACITY_M2} m²`,
        ),
      );
    }

    const initialModules = props.modulos ? [...props.modulos] : [];

    const prefs = {
      style: props.preferencias?.style ?? "clasico",
      colors: props.preferencias?.colors ? [...props.preferencias.colors] : [],
      notes: props.preferencias?.notes ?? "",
    };

    return ok(new ConfiguracionEvento(props.id, tipoEspacio, capacidadM2, prefs, initialModules));
  }

  get id(): string {
    return this._id;
  }

  get tipoEspacio(): TipoEspacio | null {
    return this._tipoEspacio;
  }

  get capacidadM2(): number | null {
    return this._capacidadM2;
  }

  get preferencias(): PreferenciasEvento {
    return {
      style: this._preferencias.style,
      colors: [...this._preferencias.colors],
      notes: this._preferencias.notes,
    };
  }

  get modulos(): readonly ModuloDecoracion[] {
    return [...this._modulos];
  }

  get espacioUsadoM2(): number {
    return this._modulos.reduce((total, m) => total + m.ocupaM2, 0);
  }

  get presupuestoTotal(): number {
    return this._modulos.reduce((total, m) => total + m.precio, 0);
  }

  /**
   * Operación canónica del patrón Prototype: realiza clonación profunda de
   * estilo, colores, notas y elementos mutables, compartiendo activos 3D inmutables
   * (Flyweight) por assetId + assetVersion y generando nuevos IDs.
   */
  public clonar(nuevoId?: string, generarIdElemento?: () => string): ConfiguracionEvento {
    const idClon = nuevoId ?? randomUUID();
    const idGenerator = generarIdElemento ?? (() => randomUUID());

    // Copia profunda de preferencias mutables
    const preferenciasClonadas = {
      style: this._preferencias.style,
      colors: [...this._preferencias.colors],
      notes: this._preferencias.notes,
    };

    // Copia profunda de instancias modulares mutables, conservando referencias Flyweight
    const modulosClonados: ModuloDecoracion[] = this._modulos.map((m) => ({
      id: idGenerator(),
      nombre: m.nombre,
      precio: m.precio,
      ocupaM2: m.ocupaM2,
      assetId: m.assetId,
      assetVersion: m.assetVersion,
    }));

    return new ConfiguracionEvento(
      idClon,
      this._tipoEspacio,
      this._capacidadM2,
      preferenciasClonadas,
      modulosClonados,
    );
  }

  public actualizarPreferencias(nuevas: Partial<PreferenciasEvento>): void {
    this._preferencias = {
      style: nuevas.style ?? this._preferencias.style,
      colors: nuevas.colors ? [...nuevas.colors] : [...this._preferencias.colors],
      notes: nuevas.notes ?? this._preferencias.notes,
    };
  }

  public agregarModulo(modulo: ModuloDecoracion): Result<void, DomainError> {
    // El exceso de área ya no rechaza (DECOR-44): solo lo informa el diagnóstico.
    this._modulos.push(modulo);
    return ok(undefined);
  }

  public removerModulo(moduloId: string): Result<void, DomainError> {
    const index = this._modulos.findIndex((m) => m.id === moduloId);
    if (index === -1) {
      return err(new DomainError("package.item_not_found", "No encontramos este elemento en el paquete."));
    }

    this._modulos.splice(index, 1);
    return ok(undefined);
  }

  public toPaqueteDecoracion(): Result<PaqueteDecoracion, DomainError> {
    return PaqueteDecoracion.create({
      capacidadM2: this._capacidadM2,
      modulos: this._modulos,
      tipoEspacio: this._tipoEspacio,
    });
  }
}

/**
 * Participante del diagrama de clases en docs/DecorAR.md (sección 4.2).
 * Solicita la clonación a una abstracción ConfiguracionClonable sin depender de detalles concretos.
 */
export class ServicioDeEventos {
  public duplicarEvento(origen: ConfiguracionClonable, nuevoId?: string): ConfiguracionEvento {
    return origen.clonar(nuevoId);
  }
}
