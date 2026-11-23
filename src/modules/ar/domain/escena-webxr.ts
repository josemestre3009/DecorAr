import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import type { Activo3DCompartido } from "./activo-3d-compartido";
import { InstanciaDecorativa, type Posicion3D } from "./instancia-decorativa";

export interface InstanciaEscenaWebXR {
  readonly id: number;
  readonly instancia: InstanciaDecorativa;
}

export interface EscenaWebXR {
  readonly instancias: readonly InstanciaEscenaWebXR[];
  readonly siguienteId: number;
  readonly idSeleccionado: number | null;
  readonly limiteInstancias: number;
}

export const LIMITE_INSTANCIAS_POR_DEFECTO = 20;

export function crearEscenaWebXR(
  limiteInstancias: number = LIMITE_INSTANCIAS_POR_DEFECTO,
): Result<EscenaWebXR, DomainError> {
  if (!Number.isInteger(limiteInstancias) || limiteInstancias < 1) {
    return err(
      new DomainError(
        "ar.invalid_instance_limit",
        "El límite de instancias debe ser un número entero mayor o igual a 1.",
      ),
    );
  }

  return ok(
    Object.freeze({
      idSeleccionado: null,
      instancias: Object.freeze([]),
      limiteInstancias,
      siguienteId: 1,
    }),
  );
}

export function colocarEnEscena(
  escena: EscenaWebXR,
  activo: Activo3DCompartido,
  posicion: Posicion3D,
  rotacionGrados = 0,
): Result<EscenaWebXR, DomainError> {
  if (escena.instancias.length >= escena.limiteInstancias) {
    return err(
      new DomainError(
        "ar.instance_limit_reached",
        `Se ha alcanzado el límite de ${escena.limiteInstancias} instancias en la escena.`,
      ),
    );
  }

  const instanciaResult = InstanciaDecorativa.crear(activo, {
    posicion,
    rotacionGrados,
  });

  if (!instanciaResult.ok) {
    return instanciaResult;
  }

  const nuevaInstancia: InstanciaEscenaWebXR = Object.freeze({
    id: escena.siguienteId,
    instancia: instanciaResult.value,
  });

  return ok(
    Object.freeze({
      ...escena,
      idSeleccionado: nuevaInstancia.id,
      instancias: Object.freeze([...escena.instancias, nuevaInstancia]),
      siguienteId: escena.siguienteId + 1,
    }),
  );
}

export function seleccionarEnEscena(
  escena: EscenaWebXR,
  id: number | null,
): EscenaWebXR {
  if (id === null) {
    return escena.idSeleccionado === null
      ? escena
      : Object.freeze({ ...escena, idSeleccionado: null });
  }

  const existe = escena.instancias.some((item) => item.id === id);
  if (!existe) {
    return escena;
  }

  return escena.idSeleccionado === id
    ? escena
    : Object.freeze({ ...escena, idSeleccionado: id });
}

export function deseleccionarEnEscena(escena: EscenaWebXR): EscenaWebXR {
  return seleccionarEnEscena(escena, null);
}

export function moverSeleccionado(
  escena: EscenaWebXR,
  posicion: Posicion3D,
): Result<EscenaWebXR, DomainError> {
  if (escena.idSeleccionado === null) {
    return err(
      new DomainError("ar.no_selection", "No hay ningún objeto seleccionado para mover."),
    );
  }

  const objetivo = escena.instancias.find((item) => item.id === escena.idSeleccionado);
  if (!objetivo) {
    return err(
      new DomainError("ar.selection_not_found", "El objeto seleccionado no existe en la escena."),
    );
  }

  const movidoResult = objetivo.instancia.mover(posicion);
  if (!movidoResult.ok) {
    return movidoResult;
  }

  const nuevasInstancias = escena.instancias.map((item) =>
    item.id === escena.idSeleccionado
      ? Object.freeze({ id: item.id, instancia: movidoResult.value })
      : item,
  );

  return ok(
    Object.freeze({
      ...escena,
      instancias: Object.freeze(nuevasInstancias),
    }),
  );
}

export function rotarSeleccionado(
  escena: EscenaWebXR,
  grados: number,
): Result<EscenaWebXR, DomainError> {
  if (escena.idSeleccionado === null) {
    return err(
      new DomainError("ar.no_selection", "No hay ningún objeto seleccionado para rotar."),
    );
  }

  const objetivo = escena.instancias.find((item) => item.id === escena.idSeleccionado);
  if (!objetivo) {
    return err(
      new DomainError("ar.selection_not_found", "El objeto seleccionado no existe en la escena."),
    );
  }

  const rotadoResult = objetivo.instancia.rotar(grados);
  if (!rotadoResult.ok) {
    return rotadoResult;
  }

  const nuevasInstancias = escena.instancias.map((item) =>
    item.id === escena.idSeleccionado
      ? Object.freeze({ id: item.id, instancia: rotadoResult.value })
      : item,
  );

  return ok(
    Object.freeze({
      ...escena,
      instancias: Object.freeze(nuevasInstancias),
    }),
  );
}

export function calcularRotacionGesto(
  inicio: readonly [Posicion3D, Posicion3D],
  actual: readonly [Posicion3D, Posicion3D],
): number {
  const angulo = (puntos: readonly [Posicion3D, Posicion3D]) =>
    Math.atan2(puntos[1].z - puntos[0].z, puntos[1].x - puntos[0].x);
  return ((angulo(actual) - angulo(inicio)) * 180) / Math.PI;
}

export function resetearEscena(
  limiteInstancias: number = LIMITE_INSTANCIAS_POR_DEFECTO,
): Result<EscenaWebXR, DomainError> {
  return crearEscenaWebXR(limiteInstancias);
}

export interface DimensionesMetros {
  readonly ancho: number;
  readonly alto: number;
  readonly profundidad: number;
}

export interface EvaluacionEscalaReal {
  readonly dentroDeTolerancia: boolean;
  readonly desvio: DimensionesMetros;
}

export const TOLERANCIA_ESCALA_REAL = 0.1;

export function evaluarEscalaReal(
  esperadas: DimensionesMetros,
  medidas: DimensionesMetros,
  tolerancia: number = TOLERANCIA_ESCALA_REAL,
): EvaluacionEscalaReal {
  const desvioEje = (medida: number, esperada: number) =>
    Math.abs(medida - esperada) / (esperada || 1);

  const desvio: DimensionesMetros = Object.freeze({
    alto: desvioEje(medidas.alto, esperadas.alto),
    ancho: desvioEje(medidas.ancho, esperadas.ancho),
    profundidad: desvioEje(medidas.profundidad, esperadas.profundidad),
  });

  return Object.freeze({
    dentroDeTolerancia:
      desvio.ancho <= tolerancia && desvio.alto <= tolerancia && desvio.profundidad <= tolerancia,
    desvio,
  });
}

export function calcularPosicionesDisposicion(
  cantidad: number,
  centro: Posicion3D = { x: 0, y: 0, z: 0 },
): Posicion3D[] {
  if (!Number.isInteger(cantidad) || cantidad < 1) {
    return [];
  }

  const radio = 0.5 + Math.sqrt(cantidad) * 0.25;

  return Array.from({ length: cantidad }, (_, i) => {
    if (i === 0) {
      return { x: centro.x, y: centro.y, z: centro.z };
    }
    const angulo = (2 * Math.PI * (i - 1)) / (cantidad - 1);
    return {
      x: centro.x + Math.cos(angulo) * radio,
      y: centro.y,
      z: centro.z + Math.sin(angulo) * radio,
    };
  });
}
