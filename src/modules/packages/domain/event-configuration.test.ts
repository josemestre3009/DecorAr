import { describe, expect, it } from "vitest";

import type { Result } from "../../../shared/domain/result";
import type { ModuloDecoracion } from "./decoration-module";
import {
  ConfiguracionEvento,
  ServicioDeEventos,
} from "./event-configuration";

function unwrap<T>(result: Result<T, unknown>): T {
  if (!result.ok) {
    throw new Error(`Expected ok result, got error: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}


describe("Patrón Prototype: ConfiguracionEvento y ConfiguracionClonable (DECOR-24)", () => {
  const moduloMesa: ModuloDecoracion = {
    assetId: "mesa-redonda-v1",
    assetVersion: 1,
    id: "item-mesa-1",
    nombre: "Mesa redonda",
    ocupaM2: 4,
    precio: 150000,
  };

  const moduloArco: ModuloDecoracion = {
    assetId: "arco-flores-v1",
    assetVersion: 2,
    id: "item-arco-1",
    nombre: "Arco floral",
    ocupaM2: 6,
    precio: 400000,
  };

  it("crea una configuración válida de evento con sus preferencias y módulos", () => {
    const configResult = ConfiguracionEvento.create({
      capacidadM2: 30,
      id: "conf-original",
      modulos: [moduloMesa, moduloArco],
      preferencias: {
        colors: ["#ffffff", "#ffd700"],
        notes: "Ubicación cerca al jardín",
        style: "bohemio",
      },
      tipoEspacio: "aireLibre",
    });

    expect(configResult.ok).toBe(true);
    if (!configResult.ok) return;

    const config = configResult.value;
    expect(config.id).toBe("conf-original");
    expect(config.capacidadM2).toBe(30);
    expect(config.espacioUsadoM2).toBe(10);
    expect(config.presupuestoTotal).toBe(550000);
    expect(config.preferencias.style).toBe("bohemio");
    expect(config.preferencias.colors).toEqual(["#ffffff", "#ffd700"]);
    expect(config.preferencias.notes).toBe("Ubicación cerca al jardín");
  });

  it("clonar realiza copia profunda de preferencias (style, colors, notes) con IDs distintos", () => {
    const config = unwrap(
      ConfiguracionEvento.create({
        capacidadM2: 30,
        id: "conf-original",
        modulos: [moduloMesa],
        preferencias: {
          colors: ["#ffffff", "#ff0000"],
          notes: "Notas iniciales",
          style: "clasico",
        },
        tipoEspacio: "salonSocial",
      }),
    );

    const clon = config.clonar("conf-clon-1");

    // Identificadores distintos
    expect(clon.id).toBe("conf-clon-1");
    expect(clon.id).not.toBe(config.id);

    // Valores idénticos inicialmente
    expect(clon.capacidadM2).toBe(config.capacidadM2);
    expect(clon.tipoEspacio).toBe(config.tipoEspacio);
    expect(clon.preferencias.style).toBe(config.preferencias.style);
    expect(clon.preferencias.colors).toEqual(config.preferencias.colors);
    expect(clon.preferencias.notes).toBe(config.preferencias.notes);

    // Independencia de mutaciones en preferencias
    clon.actualizarPreferencias({
      colors: ["#000000"],
      notes: "Notas actualizadas sólo en clon",
      style: "moderno",
    });

    expect(clon.preferencias.style).toBe("moderno");
    expect(clon.preferencias.colors).toEqual(["#000000"]);
    expect(clon.preferencias.notes).toBe("Notas actualizadas sólo en clon");

    expect(config.preferencias.style).toBe("clasico");
    expect(config.preferencias.colors).toEqual(["#ffffff", "#ff0000"]);
    expect(config.preferencias.notes).toBe("Notas iniciales");
  });

  it("clonar genera nuevos IDs para cada módulo y comparte activos 3D inmutables (Flyweight)", () => {
    const config = unwrap(
      ConfiguracionEvento.create({
        capacidadM2: 30,
        id: "conf-original",
        modulos: [moduloMesa, moduloArco],
        preferencias: {
          colors: ["#123456"],
          notes: "",
          style: "vintage",
        },
        tipoEspacio: "casa",
      }),
    );

    let seq = 100;
    const clon = config.clonar("conf-clon-2", () => `item-nuevo-${seq++}`);

    expect(clon.modulos).toHaveLength(2);
    expect(clon.modulos[0].id).toBe("item-nuevo-100");
    expect(clon.modulos[1].id).toBe("item-nuevo-101");

    // Ningún módulo del clon tiene el ID del módulo original
    expect(clon.modulos[0].id).not.toBe(config.modulos[0].id);
    expect(clon.modulos[1].id).not.toBe(config.modulos[1].id);

    // Los activos 3D se comparten (Flyweight) por assetId + version
    expect(clon.modulos[0].assetId).toBe(moduloMesa.assetId);
    expect(clon.modulos[0].assetVersion).toBe(moduloMesa.assetVersion);
    expect(clon.modulos[1].assetId).toBe(moduloArco.assetId);
    expect(clon.modulos[1].assetVersion).toBe(moduloArco.assetVersion);
  });

  it("mutar los elementos del clon no afecta al original (independencia total)", () => {
    const config = unwrap(
      ConfiguracionEvento.create({
        capacidadM2: 30,
        id: "conf-original",
        modulos: [moduloMesa],
        preferencias: {
          colors: [],
          notes: "",
          style: "minimalista",
        },
        tipoEspacio: "salonSocial",
      }),
    );

    const clon = config.clonar("conf-clon-mutacion");

    // Agregamos un arco sólo al clon
    const addResult = clon.agregarModulo(moduloArco);
    expect(addResult.ok).toBe(true);

    expect(clon.modulos).toHaveLength(2);
    expect(clon.espacioUsadoM2).toBe(10);
    expect(clon.presupuestoTotal).toBe(550000);

    // El original permanece inalterado
    expect(config.modulos).toHaveLength(1);
    expect(config.espacioUsadoM2).toBe(4);
    expect(config.presupuestoTotal).toBe(150000);
  });

  it("ServicioDeEventos delega la duplicación a la abstracción ConfiguracionClonable", () => {
    const config = unwrap(
      ConfiguracionEvento.create({
        capacidadM2: 20,
        id: "conf-servicio",
        modulos: [moduloMesa],
        preferencias: {
          colors: ["#abcdef"],
          notes: "Evento corporativo",
          style: "ejecutivo",
        },
        tipoEspacio: "salonSocial",
      }),
    );

    const servicio = new ServicioDeEventos();
    const clon = servicio.duplicarEvento(config, "conf-duplicada");

    expect(clon.id).toBe("conf-duplicada");
    expect(clon.preferencias.style).toBe("ejecutivo");
    expect(clon.preferencias.notes).toBe("Evento corporativo");
  });

  it("toPaqueteDecoracion produce un PaqueteDecoracion coherente con los módulos y capacidad", () => {
    const config = unwrap(
      ConfiguracionEvento.create({
        capacidadM2: 25,
        id: "conf-paquete",
        modulos: [moduloMesa, moduloArco],
        preferencias: {
          colors: [],
          notes: "",
          style: "rustico",
        },
        tipoEspacio: "aireLibre",
      }),
    );

    const paqueteResult = config.toPaqueteDecoracion();
    expect(paqueteResult.ok).toBe(true);
    if (!paqueteResult.ok) return;

    const paquete = paqueteResult.value;
    expect(paquete.capacidadM2).toBe(25);
    expect(paquete.espacioUsadoM2).toBe(10);
    expect(paquete.presupuestoTotal).toBe(550000);
    expect(paquete.modulos).toHaveLength(2);
  });
});
