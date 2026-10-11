import { describe, expect, it } from "vitest";
import { CATALOGO_CANONICO } from "./catalog-fixtures";
import { ModuloCompuesto } from "./composite-module";
import type { ComponenteDecorativo } from "./decorative-component";
import { ElementoDecorativo } from "./decorative-element";
import { PaqueteDecoracion } from "./decoration-package";
import { PaqueteDecoracionBuilderImpl } from "./decoration-package-builder-impl";
import { crearZonaBienvenida, NOMBRE_ZONA_BIENVENIDA } from "./welcome-zone";

function grupo(id: string, nombre = id): ModuloCompuesto {
  const result = ModuloCompuesto.crear(id, nombre);
  if (!result.ok) throw result.error;
  return result.value;
}

function hoja(modulo = CATALOGO_CANONICO.mesaRedonda): ElementoDecorativo {
  return new ElementoDecorativo(modulo);
}

/** Arma grupo1 > grupo2 > grupo3 (tres niveles) con una mesa en el más profundo. */
function tresNiveles(): { nivel1: ModuloCompuesto; nivel2: ModuloCompuesto; nivel3: ModuloCompuesto } {
  const nivel1 = grupo("nivel-1");
  const nivel2 = grupo("nivel-2");
  const nivel3 = grupo("nivel-3");
  expect(nivel3.agregar(hoja()).ok).toBe(true);
  expect(nivel2.agregar(nivel3).ok).toBe(true);
  expect(nivel1.agregar(nivel2).ok).toBe(true);
  return { nivel1, nivel2, nivel3 };
}

describe("Patrón Composite: ComponenteDecorativo, ElementoDecorativo y ModuloCompuesto", () => {
  it("Zona de bienvenida = arco floral + mesa redonda, con suma de precio y área", () => {
    const zona = crearZonaBienvenida("zona-1");
    expect(zona.ok).toBe(true);
    if (!zona.ok) return;

    expect(zona.value.nombre).toBe(NOMBRE_ZONA_BIENVENIDA);
    expect(zona.value.hijos.map((h) => h.nombre)).toEqual([
      CATALOGO_CANONICO.arcoFloral.nombre,
      CATALOGO_CANONICO.mesaRedonda.nombre,
    ]);
    expect(zona.value.calcularPrecio()).toBe(450000); // 200k + 250k
    expect(zona.value.calcularAreaM2()).toBe(6); // 2 + 4
    expect(zona.value.profundidad()).toBe(1);
  });

  it("hoja y grupo se recorren igual a través del contrato común", () => {
    const zona = crearZonaBienvenida("zona-1");
    if (!zona.ok) throw zona.error;
    const componentes: ComponenteDecorativo[] = [hoja(CATALOGO_CANONICO.pistaBaile), zona.value];

    const total = componentes.reduce((acc, c) => acc + c.calcularPrecio(), 0);
    const area = componentes.reduce((acc, c) => acc + c.calcularAreaM2(), 0);

    expect(total).toBe(1050000); // 600k + 450k
    expect(area).toBe(22); // 16 + 6
    expect(componentes.flatMap((c) => c.obtenerModulos())).toHaveLength(3);
  });

  it("suma recursiva correcta en tres niveles; un grupo vacío suma cero", () => {
    const { nivel1, nivel2 } = tresNiveles();
    expect(nivel2.agregar(hoja(CATALOGO_CANONICO.arcoFloral)).ok).toBe(true);
    expect(nivel1.agregar(grupo("vacio")).ok).toBe(true);

    expect(nivel1.calcularPrecio()).toBe(450000); // mesa (nivel 3) + arco (nivel 2)
    expect(nivel1.calcularAreaM2()).toBe(6);
    expect(nivel1.profundidad()).toBe(3);
    expect(grupo("solo").calcularPrecio()).toBe(0);
  });

  it("admite tres niveles de grupos y rechaza un cuarto sin modificar el árbol", () => {
    const { nivel1, nivel3 } = tresNiveles();
    expect(nivel3.nivel()).toBe(3);

    const nivel4 = grupo("nivel-4");
    const result = nivel3.agregar(nivel4);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.group_depth_exceeded");
    expect(nivel3.hijos).toHaveLength(1);
    expect(nivel4.padre).toBeNull();
    expect(nivel1.profundidad()).toBe(3);
  });

  it("rechaza un cuarto nivel también cuando se agrega un subárbol completo", () => {
    const { nivel1 } = tresNiveles();
    const raiz = grupo("raiz");

    const result = raiz.agregar(nivel1); // raiz(1) + 3 niveles = 4

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.group_depth_exceeded");
    expect(nivel1.padre).toBeNull();
  });

  it("rechaza ciclos: un grupo dentro de sí mismo o dentro de un descendiente", () => {
    const { nivel1, nivel3 } = tresNiveles();

    const enSiMismo = nivel1.agregar(nivel1);
    expect(enSiMismo.ok).toBe(false);
    if (!enSiMismo.ok) expect(enSiMismo.error.code).toBe("package.group_cycle");

    const enDescendiente = nivel3.agregar(nivel1);
    expect(enDescendiente.ok).toBe(false);
    if (!enDescendiente.ok) expect(enDescendiente.error.code).toBe("package.group_cycle");

    expect(nivel1.profundidad()).toBe(3);
  });

  it("un componente sólo puede estar en un grupo", () => {
    const mesa = hoja();
    expect(grupo("a").agregar(mesa).ok).toBe(true);

    const result = grupo("b").agregar(mesa);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.component_already_grouped");
  });

  it("valida el nombre y el id del grupo", () => {
    for (const nombre of ["", "   ", "x".repeat(81)]) {
      const result = ModuloCompuesto.crear("g", nombre);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("package.invalid_group_name");
    }

    const sinId = ModuloCompuesto.crear(" ", "Grupo");
    expect(sinId.ok).toBe(false);
    if (!sinId.ok) expect(sinId.error.code).toBe("package.invalid_group");
  });

  it("copiar() crea un árbol independiente con los mismos ids", () => {
    const { nivel1 } = tresNiveles();
    const copia = nivel1.copiar();

    expect(copia).not.toBe(nivel1);
    expect(copia.id).toBe(nivel1.id);
    expect(copia.calcularPrecio()).toBe(nivel1.calcularPrecio());

    expect(copia.agregar(hoja()).ok).toBe(true);
    expect(copia.calcularPrecio()).not.toBe(nivel1.calcularPrecio());
  });
});

describe("Builder y PaqueteDecoracion usan el contrato común del Composite", () => {
  it("el Builder agrega la Zona de bienvenida y cuenta su precio y área como cualquier hoja", () => {
    const paquete = new PaqueteDecoracionBuilderImpl("salonSocial", 30)
      .agregarZonaBienvenida()
      .agregarPistaBaile()
      .construir();

    expect(paquete.componentes).toHaveLength(2);
    expect(paquete.modulos).toHaveLength(3); // arco + mesa + pista
    expect(paquete.espacioUsadoM2).toBe(22); // 6 + 16
    expect(paquete.presupuestoTotal).toBe(1050000); // 450k + 600k
  });

  it("la capacidad se valida igual para un grupo: se rechaza si no cabe", () => {
    const builder = new PaqueteDecoracionBuilderImpl("casa", 20);
    builder.agregarPistaBaile(); // 16 / 20

    const zona = crearZonaBienvenida("zona-1"); // 6 m²
    if (!zona.ok) throw zona.error;
    const result = builder.agregarComponente(zona.value);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("package.capacity_exceeded");
    expect(builder.construir().modulos).toHaveLength(1);
  });

  it("construir() copia los grupos: cambiar el builder no altera el snapshot", () => {
    const zona = crearZonaBienvenida("zona-1");
    if (!zona.ok) throw zona.error;
    const builder = new PaqueteDecoracionBuilderImpl("casa", 50);
    builder.agregarComponente(zona.value);

    const snapshot = builder.construir();
    expect(zona.value.agregar(hoja()).ok).toBe(true);

    expect(snapshot.modulos).toHaveLength(2);
    expect(builder.construir().modulos).toHaveLength(3);
  });

  it("agrega una hoja dentro de un grupo existente del paquete", () => {
    const zona = crearZonaBienvenida("zona-1");
    if (!zona.ok) throw zona.error;
    const pkg = PaqueteDecoracion.create({ capacidadM2: 50, componentes: [zona.value], tipoEspacio: "casa" });
    if (!pkg.ok) throw pkg.error;

    expect(pkg.value.agregarComponente(hoja(), "zona-1").ok).toBe(true);
    expect(pkg.value.buscarGrupo("zona-1")?.hijos).toHaveLength(3);
    expect(pkg.value.espacioUsadoM2).toBe(10);

    const sinGrupo = pkg.value.agregarComponente(hoja(), "no-existe");
    expect(sinGrupo.ok).toBe(false);
    if (!sinGrupo.ok) expect(sinGrupo.error.code).toBe("package.group_not_found");
  });

  it("removerModulo() quita una hoja que está dentro de un grupo", () => {
    const zona = crearZonaBienvenida("zona-1");
    if (!zona.ok) throw zona.error;
    const pkg = PaqueteDecoracion.create({ capacidadM2: 50, componentes: [zona.value], tipoEspacio: "casa" });
    if (!pkg.ok) throw pkg.error;

    expect(pkg.value.removerModulo(CATALOGO_CANONICO.mesaRedonda.id).ok).toBe(true);
    expect(pkg.value.presupuestoTotal).toBe(200000);
    expect(pkg.value.buscarGrupo("zona-1")?.hijos).toHaveLength(1);
  });

  it("PaqueteDecoracion.create rechaza un árbol de más de tres niveles", () => {
    const { nivel1 } = tresNiveles();
    const raiz = grupo("raiz");
    // Se fuerza el árbol inválido saltando la validación de agregar().
    (raiz as unknown as { _hijos: ComponenteDecorativo[] })._hijos.push(nivel1);

    const pkg = PaqueteDecoracion.create({ capacidadM2: 50, componentes: [raiz], tipoEspacio: "casa" });
    expect(pkg.ok).toBe(false);
    if (!pkg.ok) expect(pkg.error.code).toBe("package.group_depth_exceeded");
  });
});
