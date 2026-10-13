import { describe, expect, it } from "vitest";
import { CATALOGO_CANONICO } from "./catalog-fixtures";
import { ModuloCompuesto } from "./composite-module";
import type { ComponenteDecorativo } from "./decorative-component";
import { ElementoDecorativo } from "./decorative-element";
import { PaqueteDecoracion } from "./decoration-package";

function grupo(id: string, nombre = id): ModuloCompuesto {
  const result = ModuloCompuesto.crear(id, nombre);
  if (!result.ok) throw result.error;
  return result.value;
}

function hoja(id: string, modulo = CATALOGO_CANONICO.mesaRedonda): ElementoDecorativo {
  return new ElementoDecorativo({ ...modulo, id });
}

function paquete(componentes: ComponenteDecorativo[]): PaqueteDecoracion {
  const result = PaqueteDecoracion.create({ capacidadM2: 100, componentes, tipoEspacio: "salonSocial" });
  if (!result.ok) throw result.error;
  return result.value;
}

describe("ModuloCompuesto.renombrar", () => {
  it("renombra recortando espacios y conserva id, padre, subzonas y hojas", () => {
    const raiz = grupo("z1", "Zona");
    const sub = grupo("z2", "Sub");
    const mesa = hoja("item-1");
    expect(sub.agregar(mesa).ok).toBe(true);
    expect(raiz.agregar(sub).ok).toBe(true);

    expect(raiz.renombrar("  Recepción  ").ok).toBe(true);
    expect(raiz.nombre).toBe("Recepción");
    expect(raiz.id).toBe("z1");
    expect(raiz.hijos).toHaveLength(1);
    expect(raiz.calcularPrecio()).toBe(mesa.calcularPrecio());
  });

  it("rechaza un nombre vacío o mayor a 80 sin cambiar el anterior", () => {
    const z = grupo("z1", "Original");

    for (const invalido of ["", "   ", "x".repeat(81)]) {
      const result = z.renombrar(invalido);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("package.invalid_group_name");
    }

    expect(z.nombre).toBe("Original");
  });
});

describe("PaqueteDecoracion: renombrar y mover zonas/hojas conservando identidad", () => {
  it("renombrarGrupo valida el grupo y el nombre", () => {
    const pkg = paquete([grupo("z1", "Zona")]);

    expect(pkg.renombrarGrupo("z1", "Nueva").ok).toBe(true);
    expect(pkg.buscarGrupo("z1")?.nombre).toBe("Nueva");

    const inexistente = pkg.renombrarGrupo("otro", "X");
    expect(inexistente.ok).toBe(false);
    if (!inexistente.ok) expect(inexistente.error.code).toBe("package.group_not_found");

    const invalido = pkg.renombrarGrupo("z1", "");
    expect(invalido.ok).toBe(false);
    if (!invalido.ok) expect(invalido.error.code).toBe("package.invalid_group_name");
  });

  it("mueve un subárbol válido bajo otra zona conservando ids, contenido y profundidad", () => {
    const destino = grupo("destino", "Destino");
    const origen = grupo("origen", "Origen");
    const sub = grupo("sub", "Sub");
    expect(sub.agregar(hoja("item-1")).ok).toBe(true);
    expect(origen.agregar(sub).ok).toBe(true);

    const pkg = paquete([destino, origen]);

    expect(pkg.moverGrupo("origen", "destino").ok).toBe(true);
    expect(pkg.buscarGrupo("destino")?.hijos.map((h) => h.id)).toEqual(["origen"]);
    expect(pkg.buscarGrupo("origen")?.hijos.map((h) => h.id)).toEqual(["sub"]);
    expect(pkg.buscarGrupo("origen")?.nivel()).toBe(2);
    expect(pkg.buscarGrupo("sub")?.nivel()).toBe(3);
    expect(pkg.buscarComponente("item-1")).not.toBeNull();
  });

  it("mueve una zona a la raíz y conserva su subárbol", () => {
    const padre = grupo("padre", "Padre");
    const hijo = grupo("hijo", "Hijo");
    expect(padre.agregar(hijo).ok).toBe(true);
    const pkg = paquete([padre]);

    expect(pkg.moverGrupo("hijo", null).ok).toBe(true);
    expect(pkg.componentes.map((c) => c.id)).toEqual(["padre", "hijo"]);
    expect(pkg.buscarGrupo("hijo")?.nivel()).toBe(1);
  });

  it("rechaza mover una zona dentro de sí misma o de un descendiente sin tocar el árbol", () => {
    const raiz = grupo("raiz", "Raíz");
    const sub = grupo("sub", "Sub");
    expect(sub.agregar(hoja("item-1")).ok).toBe(true);
    expect(raiz.agregar(sub).ok).toBe(true);
    const pkg = paquete([raiz]);

    const enSiMisma = pkg.moverGrupo("raiz", "raiz");
    expect(enSiMisma.ok).toBe(false);
    if (!enSiMisma.ok) expect(enSiMisma.error.code).toBe("package.group_cycle");

    const enDescendiente = pkg.moverGrupo("raiz", "sub");
    expect(enDescendiente.ok).toBe(false);
    if (!enDescendiente.ok) expect(enDescendiente.error.code).toBe("package.group_cycle");

    expect(pkg.componentes.map((c) => c.id)).toEqual(["raiz"]);
    expect(pkg.buscarGrupo("raiz")?.hijos.map((h) => h.id)).toEqual(["sub"]);
  });

  it("rechaza un movimiento que supere tres niveles y restaura el árbol", () => {
    const destino = grupo("destino", "Destino");
    const nivel1 = grupo("n1", "N1");
    const nivel2 = grupo("n2", "N2");
    const nivel3 = grupo("n3", "N3");
    expect(nivel2.agregar(nivel3).ok).toBe(true);
    expect(nivel1.agregar(nivel2).ok).toBe(true);
    const pkg = paquete([destino, nivel1]);

    const result = pkg.moverGrupo("n1", "destino"); // 1 + 3 = 4

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.group_depth_exceeded");
    expect(pkg.componentes.map((c) => c.id)).toEqual(["destino", "n1"]);
    expect(pkg.buscarGrupo("n1")?.nivel()).toBe(1);
    expect(pkg.buscarGrupo("n3")?.nivel()).toBe(3);
  });

  it("conserva la misma instancia al mover una hoja entre raíz y zonas", () => {
    const zona = grupo("zona", "Zona");
    const mesa = hoja("mesa-1");
    const pkg = paquete([zona, mesa]);

    expect(pkg.moverComponente("mesa-1", "zona").ok).toBe(true);
    const dentro = pkg.buscarComponente("mesa-1");
    expect(dentro).toBe(mesa);
    expect(dentro?.padre?.id).toBe("zona");

    expect(pkg.moverComponente("mesa-1", null).ok).toBe(true);
    expect(pkg.buscarComponente("mesa-1")).toBe(mesa);
    expect(pkg.buscarComponente("mesa-1")?.padre).toBeNull();
  });

  it("no toca el árbol al mover a un destino inexistente o una hoja inexistente", () => {
    const zona = grupo("zona", "Zona");
    const mesa = hoja("mesa-1");
    const pkg = paquete([zona, mesa]);

    const destinoAjeno = pkg.moverComponente("mesa-1", "no-existe");
    expect(destinoAjeno.ok).toBe(false);
    if (!destinoAjeno.ok) expect(destinoAjeno.error.code).toBe("package.group_not_found");

    const hojaAjena = pkg.moverComponente("no-existe", "zona");
    expect(hojaAjena.ok).toBe(false);
    if (!hojaAjena.ok) expect(hojaAjena.error.code).toBe("package.item_not_found");

    expect(pkg.buscarComponente("mesa-1")?.padre).toBeNull();
  });

  it("mover a la misma ubicación es un no-op", () => {
    const zona = grupo("zona", "Zona");
    const mesa = hoja("mesa-1");
    expect(zona.agregar(mesa).ok).toBe(true);
    const pkg = paquete([zona]);

    expect(pkg.moverComponente("mesa-1", "zona").ok).toBe(true);
    expect(pkg.buscarComponente("mesa-1")?.padre?.id).toBe("zona");
  });
});
