import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";
import { ModuloCompuesto } from "./composite-module";
import type { ComponenteDecorativo } from "./decorative-component";
import { ElementoDecorativo } from "./decorative-element";
import type { ModuloDecoracion } from "./decoration-module";

export interface GrupoGuardado {
  readonly id: string;
  readonly nombre: string;
  readonly grupoPadreId: string | null;
}

export interface HojaGuardada {
  readonly modulo: ModuloDecoracion;
  readonly grupoId: string | null;
}

/**
 * Reconstruye el árbol Composite de un paquete a partir de sus filas
 * (grupos con su padre y hojas con su grupo). Usa `ModuloCompuesto.agregar`,
 * así que un árbol guardado inválido (ciclo, más de tres niveles o un padre
 * inexistente) se rechaza igual que uno nuevo.
 */
export function reconstruirComponentes(
  grupos: readonly GrupoGuardado[],
  hojas: readonly HojaGuardada[],
): Result<ComponenteDecorativo[], DomainError> {
  const raiz: ComponenteDecorativo[] = [];
  const porId = new Map<string, { guardado: GrupoGuardado; modulo: ModuloCompuesto }>();

  for (const guardado of grupos) {
    const modulo = ModuloCompuesto.crear(guardado.id, guardado.nombre);
    if (!modulo.ok) {
      return err(modulo.error);
    }
    porId.set(guardado.id, { guardado, modulo: modulo.value });
  }

  const colocados = new Set<string>();
  const enCurso = new Set<string>();

  const colocar = (grupoId: string): Result<void, DomainError> => {
    if (colocados.has(grupoId)) {
      return ok(undefined);
    }

    const entrada = porId.get(grupoId);
    if (!entrada) {
      return err(new DomainError("package.group_not_found", "No encontramos ese grupo en el paquete."));
    }

    if (enCurso.has(grupoId)) {
      return err(new DomainError("package.group_cycle", "La estructura de grupos guardada contiene un ciclo."));
    }
    enCurso.add(grupoId);

    const { guardado, modulo } = entrada;
    if (guardado.grupoPadreId === null) {
      raiz.push(modulo);
    } else {
      const padre = colocar(guardado.grupoPadreId);
      if (!padre.ok) {
        return padre;
      }

      const agregado = porId.get(guardado.grupoPadreId)!.modulo.agregar(modulo);
      if (!agregado.ok) {
        return agregado;
      }
    }

    enCurso.delete(grupoId);
    colocados.add(grupoId);
    return ok(undefined);
  };

  for (const guardado of grupos) {
    const colocado = colocar(guardado.id);
    if (!colocado.ok) {
      return err(colocado.error);
    }
  }

  for (const hoja of hojas) {
    const elemento = new ElementoDecorativo(hoja.modulo);

    if (hoja.grupoId === null) {
      raiz.push(elemento);
      continue;
    }

    const grupo = porId.get(hoja.grupoId);
    if (!grupo) {
      return err(new DomainError("package.group_not_found", "No encontramos ese grupo en el paquete."));
    }

    const agregado = grupo.modulo.agregar(elemento);
    if (!agregado.ok) {
      return err(agregado.error);
    }
  }

  return ok(raiz);
}
