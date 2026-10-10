import { describe, expect, it } from "vitest";
import { CATALOGO_CANONICO } from "./catalog-fixtures";
import { PaqueteDecoracion } from "./decoration-package";
import { PaqueteDecoracionBuilderImpl } from "./decoration-package-builder-impl";
import { DirectorEvento } from "./director-evento";
import type { TipoEspacio } from "./space-type";

describe("Patrón Builder: PaqueteDecoracion y DirectorEvento", () => {
  it("escenario 1: arma un paquete paso a paso para un salón social", () => {
    const builder = new PaqueteDecoracionBuilderImpl("salonSocial", 100);

    builder
      .agregarMesa()
      .agregarMesa()
      .agregarArco()
      .agregarPistaBaile();

    const paquete = builder.construir();

    expect(paquete.tipoEspacio).toBe("salonSocial");
    expect(paquete.modulos).toHaveLength(4);
    expect(paquete.espacioUsadoM2).toBe(26); // 4 + 4 + 2 + 16
    expect(paquete.presupuestoTotal).toBe(1300000); // 250k + 250k + 200k + 600k
  });

  it("escenario 2: DirectorEvento construye un paquete básico reutilizable para aire libre", () => {
    const builder = new PaqueteDecoracionBuilderImpl("aireLibre", 50);
    const director = new DirectorEvento();

    const paquete = director.construirPaqueteBasico(builder);

    expect(paquete.tipoEspacio).toBe("aireLibre");
    expect(paquete.modulos).toHaveLength(3); // 1 arco + 2 mesas
    expect(paquete.espacioUsadoM2).toBe(10); // 2 + 4 + 4
    expect(paquete.presupuestoTotal).toBe(700000); // 200k + 250k + 250k
  });

  it("escenario 3: valida regla de capacidad con fixture de 30 m² rechazando módulos excedentes", () => {
    const builder = new PaqueteDecoracionBuilderImpl("casa", 30);

    // 1. Agregar primera pista (16 m² -> 16 / 30)
    const add1 = builder.agregarModulo(CATALOGO_CANONICO.pistaBaile);
    expect(add1.ok).toBe(true);

    // 2. Intentar agregar segunda pista (16 + 16 = 32 > 30 -> RECHAZO)
    const add2 = builder.agregarModulo(CATALOGO_CANONICO.pistaBaile);
    expect(add2.ok).toBe(false);
    if (!add2.ok) {
      expect(add2.error.code).toBe("package.capacity_exceeded");
      expect(add2.error.message).toContain("excede la capacidad del espacio (32/30 m²)");
    }

    // 3. Agregar arco floral (16 + 2 = 18 <= 30 -> ACEPTADO)
    const add3 = builder.agregarModulo(CATALOGO_CANONICO.arcoFloral);
    expect(add3.ok).toBe(true);

    const paquete = builder.construir();

    expect(paquete.tipoEspacio).toBe("casa");
    expect(paquete.modulos).toHaveLength(2);
    expect(paquete.espacioUsadoM2).toBe(18);
    expect(paquete.presupuestoTotal).toBe(800000); // 600k + 200k
  });

  it("rechaza tipo de espacio no soportado", () => {
    expect(() => new PaqueteDecoracionBuilderImpl("espacioInvalido" as unknown as TipoEspacio, 30)).toThrowError();

    const result = PaqueteDecoracion.create({
      capacidadM2: 30,
      tipoEspacio: "espacioInvalido" as unknown as TipoEspacio,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("package.invalid_space_type");
    }
  });

  it("rechaza capacidad no positiva, no finita o por encima del máximo", () => {
    for (const invalidCapacity of [0, -10, NaN, Infinity, -Infinity, 1000000]) {
      expect(() => new PaqueteDecoracionBuilderImpl("casa", invalidCapacity)).toThrowError();

      const result = PaqueteDecoracion.create({
        capacidadM2: invalidCapacity,
        tipoEspacio: "casa",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("package.invalid_capacity");
      }
    }
  });

  it("construir() devuelve un snapshot defensivo inmutable ante modificaciones externas", () => {
    const builder = new PaqueteDecoracionBuilderImpl("casa", 30);
    builder.agregarArco();

    const snapshot = builder.construir();
    expect(snapshot.modulos).toHaveLength(1);

    // Agregar otro módulo al builder no altera el snapshot previamente construido
    builder.agregarMesa();
    expect(snapshot.modulos).toHaveLength(1);
    expect(builder.construir().modulos).toHaveLength(2);
  });

  it("removerModulo() descuenta área y presupuesto, o falla si no existe", () => {
    const pkg = PaqueteDecoracion.create({
      capacidadM2: 50,
      modulos: [CATALOGO_CANONICO.mesaRedonda, CATALOGO_CANONICO.arcoFloral],
      tipoEspacio: "casa",
    });
    expect(pkg.ok).toBe(true);
    if (!pkg.ok) return;

    expect(pkg.value.espacioUsadoM2).toBe(6);
    expect(pkg.value.presupuestoTotal).toBe(450000);

    const removeOk = pkg.value.removerModulo("mesa-redonda");
    expect(removeOk.ok).toBe(true);
    expect(pkg.value.espacioUsadoM2).toBe(2);
    expect(pkg.value.presupuestoTotal).toBe(200000);

    const removeFail = pkg.value.removerModulo("inexistente");
    expect(removeFail.ok).toBe(false);
    if (!removeFail.ok) {
      expect(removeFail.error.code).toBe("package.item_not_found");
    }
  });
});
