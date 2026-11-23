import { describe, expect, it } from "vitest";

import type { DomainError } from "../../../shared/domain/domain-error";
import type { Result } from "../../../shared/domain/result";
import { crearActivo3DCompartido, type DatosActivo3D } from "./activo-3d-compartido";
import {
  calcularPosicionesDisposicion,
  calcularRotacionGesto,
  colocarEnEscena,
  crearEscenaWebXR,
  deseleccionarEnEscena,
  evaluarEscalaReal,
  LIMITE_INSTANCIAS_POR_DEFECTO,
  moverSeleccionado,
  resetearEscena,
  rotarSeleccionado,
  seleccionarEnEscena,
  type EscenaWebXR,
} from "./escena-webxr";

const DATOS_MESA: DatosActivo3D = {
  assetId: "mesa-test",
  depthM: 1.19,
  glbUrl: "https://example.com/mesa.glb",
  heightM: 0.94,
  posterUrl: "https://example.com/poster.webp",
  usdzUrl: "https://example.com/mesa.usdz",
  version: 1,
  widthM: 2,
};

const activoResult = crearActivo3DCompartido(DATOS_MESA);
if (!activoResult.ok) throw new Error("Fallo creando activo para prueba");
const ACTIVO = activoResult.value;

function valorDe<T>(resultado: Result<T, DomainError>): T {
  expect(resultado.ok).toBe(true);
  if (!resultado.ok) throw new Error(`Resultado inesperado: ${resultado.error.code}`);
  return resultado.value;
}

function codigoDeError<T>(resultado: Result<T, DomainError>): string {
  expect(resultado.ok).toBe(false);
  if (resultado.ok) throw new Error("Se esperaba un error de dominio");
  return resultado.error.code;
}

describe("escena-webxr (dominio puro)", () => {
  it("crea una escena vacía con el límite especificado o por defecto", () => {
    const escenaDefault = valorDe(crearEscenaWebXR());
    expect(escenaDefault.instancias).toEqual([]);
    expect(escenaDefault.limiteInstancias).toBe(LIMITE_INSTANCIAS_POR_DEFECTO);
    expect(escenaDefault.idSeleccionado).toBeNull();
    expect(escenaDefault.siguienteId).toBe(1);

    expect(valorDe(crearEscenaWebXR(5)).limiteInstancias).toBe(5);

    expect(codigoDeError(crearEscenaWebXR(0))).toBe("ar.invalid_instance_limit");
  });

  it("coloca instancias inmutables asignando id incremental y seleccionándolas", () => {
    const escena0 = valorDe(crearEscenaWebXR(3));

    const escena1 = valorDe(colocarEnEscena(escena0, ACTIVO, { x: 1, y: 0, z: 2 }, 45));

    expect(escena1.instancias.length).toBe(1);
    expect(escena1.idSeleccionado).toBe(1);
    expect(escena1.instancias[0].id).toBe(1);
    expect(escena1.instancias[0].instancia.activo).toBe(ACTIVO);
    expect(escena1.instancias[0].instancia.posicion).toEqual({ x: 1, y: 0, z: 2 });
    expect(escena1.instancias[0].instancia.rotacionGrados).toBe(45);
    expect(escena1.siguienteId).toBe(2);

    expect(escena0.instancias.length).toBe(0);

    const escena2 = valorDe(colocarEnEscena(escena1, ACTIVO, { x: 2, y: 0, z: 3 }));

    expect(escena2.instancias.length).toBe(2);
    expect(escena2.idSeleccionado).toBe(2);
    expect(escena2.siguienteId).toBe(3);
  });

  it("respeta el límite configurable de instancias", () => {
    let escena = valorDe(crearEscenaWebXR(2));
    escena = valorDe(colocarEnEscena(escena, ACTIVO, { x: 0, y: 0, z: 0 }));
    escena = valorDe(colocarEnEscena(escena, ACTIVO, { x: 1, y: 0, z: 0 }));

    const excedente = colocarEnEscena(escena, ACTIVO, { x: 2, y: 0, z: 0 });
    expect(codigoDeError(excedente)).toBe("ar.instance_limit_reached");
    expect(escena.instancias.length).toBe(2);
  });

  it("propaga posiciones no finitas al colocar", () => {
    const escena = valorDe(crearEscenaWebXR(3));

    const colocada = colocarEnEscena(escena, ACTIVO, { x: Number.NaN, y: 0, z: 0 });
    expect(codigoDeError(colocada)).toBe("ar.invalid_position");
    expect(escena.instancias.length).toBe(0);
  });

  it("selecciona y deselecciona instancias", () => {
    let escena = valorDe(crearEscenaWebXR(5));
    escena = valorDe(colocarEnEscena(escena, ACTIVO, { x: 0, y: 0, z: 0 }));
    escena = valorDe(colocarEnEscena(escena, ACTIVO, { x: 1, y: 0, z: 0 }));

    const deseleccionada = deseleccionarEnEscena(escena);
    expect(deseleccionada.idSeleccionado).toBeNull();

    const seleccionada1 = seleccionarEnEscena(deseleccionada, 1);
    expect(seleccionada1.idSeleccionado).toBe(1);

    const noExiste = seleccionarEnEscena(seleccionada1, 999);
    expect(noExiste.idSeleccionado).toBe(1);
  });

  it("seleccionarEnEscena(null) deselecciona y es idempotente", () => {
    let escena = valorDe(crearEscenaWebXR(5));
    escena = valorDe(colocarEnEscena(escena, ACTIVO, { x: 0, y: 0, z: 0 }));
    expect(escena.idSeleccionado).toBe(1);

    const deseleccionada = seleccionarEnEscena(escena, null);
    expect(deseleccionada.idSeleccionado).toBeNull();
    expect(escena.idSeleccionado).toBe(1);
    expect(seleccionarEnEscena(deseleccionada, null)).toBe(deseleccionada);
  });

  it("mueve el objeto seleccionado sin alterar los otros", () => {
    let escena = valorDe(crearEscenaWebXR(5));
    escena = valorDe(colocarEnEscena(escena, ACTIVO, { x: 0, y: 0, z: 0 }));
    escena = valorDe(colocarEnEscena(escena, ACTIVO, { x: 5, y: 0, z: 5 }));

    escena = seleccionarEnEscena(escena, 1);
    const movida = valorDe(moverSeleccionado(escena, { x: 10, y: 0, z: 10 }));

    expect(movida.instancias[0].instancia.posicion).toEqual({ x: 10, y: 0, z: 10 });
    expect(movida.instancias[1].instancia.posicion).toEqual({ x: 5, y: 0, z: 5 });

    const sinSeleccion = deseleccionarEnEscena(movida);
    expect(codigoDeError(moverSeleccionado(sinSeleccion, { x: 0, y: 0, z: 0 }))).toBe(
      "ar.no_selection",
    );
  });

  it("moverSeleccionado propaga posiciones no finitas y falla con selección inexistente", () => {
    let escena = valorDe(crearEscenaWebXR(5));
    escena = valorDe(colocarEnEscena(escena, ACTIVO, { x: 0, y: 0, z: 0 }));

    expect(codigoDeError(moverSeleccionado(escena, { x: 0, y: Number.NaN, z: 0 }))).toBe(
      "ar.invalid_position",
    );

    const huerfana: EscenaWebXR = { ...escena, idSeleccionado: 999 };
    expect(codigoDeError(moverSeleccionado(huerfana, { x: 1, y: 0, z: 1 }))).toBe(
      "ar.selection_not_found",
    );
  });

  it("rota el objeto seleccionado normalizando grados", () => {
    let escena = valorDe(crearEscenaWebXR(5));
    escena = valorDe(colocarEnEscena(escena, ACTIVO, { x: 0, y: 0, z: 0 }, 10));

    const rotada = valorDe(rotarSeleccionado(escena, 30));
    expect(rotada.instancias[0].instancia.rotacionGrados).toBe(40);

    const rotadaNegativa = valorDe(rotarSeleccionado(rotada, -50));
    expect(rotadaNegativa.instancias[0].instancia.rotacionGrados).toBe(350);
  });

  it("rotarSeleccionado falla sin selección o con id inexistente", () => {
    let escena = valorDe(crearEscenaWebXR(5));
    escena = valorDe(colocarEnEscena(escena, ACTIVO, { x: 0, y: 0, z: 0 }));

    const sinSeleccion = deseleccionarEnEscena(escena);
    expect(codigoDeError(rotarSeleccionado(sinSeleccion, 15))).toBe("ar.no_selection");

    const huerfana: EscenaWebXR = { ...escena, idSeleccionado: 999 };
    expect(codigoDeError(rotarSeleccionado(huerfana, 15))).toBe("ar.selection_not_found");
  });

  it("rotarSeleccionado propaga rotaciones no finitas", () => {
    let escena = valorDe(crearEscenaWebXR(5));
    escena = valorDe(colocarEnEscena(escena, ACTIVO, { x: 0, y: 0, z: 0 }));

    expect(codigoDeError(rotarSeleccionado(escena, Number.NaN))).toBe("ar.invalid_rotation");
  });

  it("calcula rotación de gesto con dos puntos", () => {
    const inicio = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ] as const;
    const actual = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
    ] as const;

    const delta = calcularRotacionGesto(inicio, actual);
    expect(Math.round(delta)).toBe(90);
  });

  it("calcula rotación de gesto nula con puntos iguales", () => {
    const puntos = [
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ] as const;

    expect(calcularRotacionGesto(puntos, puntos)).toBe(0);
  });

  it("resetea la escena", () => {
    let escena = valorDe(crearEscenaWebXR(10));
    escena = valorDe(colocarEnEscena(escena, ACTIVO, { x: 0, y: 0, z: 0 }));
    expect(escena.instancias.length).toBe(1);

    const reseteada = valorDe(resetearEscena(10));
    expect(reseteada.instancias).toEqual([]);
    expect(reseteada.limiteInstancias).toBe(10);
    expect(reseteada.idSeleccionado).toBeNull();
  });

  it("resetearEscena propaga un límite inválido", () => {
    expect(codigoDeError(resetearEscena(0))).toBe("ar.invalid_instance_limit");
    expect(codigoDeError(resetearEscena(1.5))).toBe("ar.invalid_instance_limit");
    expect(codigoDeError(resetearEscena(Number.NaN))).toBe("ar.invalid_instance_limit");
  });
});

describe("evaluarEscalaReal", () => {
  const esperadas = { alto: 1, ancho: 2, profundidad: 1 };

  it("acepta dimensiones dentro de la tolerancia", () => {
    const evaluacion = evaluarEscalaReal(esperadas, { alto: 1.05, ancho: 1.9, profundidad: 1 });

    expect(evaluacion.dentroDeTolerancia).toBe(true);
    expect(evaluacion.desvio.ancho).toBeCloseTo(0.05);
    expect(evaluacion.desvio.alto).toBeCloseTo(0.05);
    expect(evaluacion.desvio.profundidad).toBe(0);
  });

  it("rechaza si algún eje supera la tolerancia", () => {
    const evaluacion = evaluarEscalaReal(esperadas, { alto: 1.2, ancho: 2, profundidad: 1 });

    expect(evaluacion.dentroDeTolerancia).toBe(false);
    expect(evaluacion.desvio.alto).toBeCloseTo(0.2);
  });

  it("acepta exactamente el límite de tolerancia y permite tolerancia personalizada", () => {
    expect(
      evaluarEscalaReal({ alto: 1, ancho: 1, profundidad: 1 }, { alto: 1.5, ancho: 1, profundidad: 1 }, 0.5)
        .dentroDeTolerancia,
    ).toBe(true);
    expect(
      evaluarEscalaReal(esperadas, { alto: 1.2, ancho: 2, profundidad: 1 }, 0.25).dentroDeTolerancia,
    ).toBe(true);
  });

  it("no divide entre cero cuando la dimensión esperada es 0", () => {
    const evaluacion = evaluarEscalaReal(
      { alto: 0, ancho: 1, profundidad: 1 },
      { alto: 0.5, ancho: 1, profundidad: 1 },
    );

    expect(evaluacion.desvio.alto).toBe(0.5);
    expect(evaluacion.dentroDeTolerancia).toBe(false);
  });
});

describe("calcularPosicionesDisposicion", () => {
  const centro = { x: 1, y: 2, z: 3 };

  it("devuelve lista vacía para cantidades no válidas", () => {
    expect(calcularPosicionesDisposicion(0)).toEqual([]);
    expect(calcularPosicionesDisposicion(-3)).toEqual([]);
    expect(calcularPosicionesDisposicion(Number.NaN)).toEqual([]);
  });

  it("con 1 objeto lo coloca en el centro", () => {
    expect(calcularPosicionesDisposicion(1, centro)).toEqual([centro]);
  });

  it.each([5, 10, 20])("con %i objetos: el primero en el centro y el resto en círculo", (cantidad) => {
    const posiciones = calcularPosicionesDisposicion(cantidad, centro);
    const radio = 0.5 + Math.sqrt(cantidad) * 0.25;

    expect(posiciones).toHaveLength(cantidad);
    expect(posiciones[0]).toEqual(centro);
    for (const posicion of posiciones.slice(1)) {
      expect(posicion.y).toBe(centro.y);
      expect(Math.hypot(posicion.x - centro.x, posicion.z - centro.z)).toBeCloseTo(radio);
    }
  });

  it("con 5 objetos reparte los cuatro del círculo a 90 grados", () => {
    const posiciones = calcularPosicionesDisposicion(5);
    const radio = 0.5 + Math.sqrt(5) * 0.25;

    expect(posiciones[1].x).toBeCloseTo(radio);
    expect(posiciones[1].z).toBeCloseTo(0);
    expect(posiciones[2].x).toBeCloseTo(0, 5);
    expect(posiciones[2].z).toBeCloseTo(radio);
    expect(posiciones[3].x).toBeCloseTo(-radio);
  });

  it("usa el origen como centro por defecto", () => {
    expect(calcularPosicionesDisposicion(1)).toEqual([{ x: 0, y: 0, z: 0 }]);
  });
});
