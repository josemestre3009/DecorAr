"use client";

import Link from "next/link";
import { useState } from "react";

import type { CatalogModuleDto } from "@/modules/catalog/application/dtos/catalog-module.dto";

import { formatAreaM2, formatCop } from "../_lib/format";

export type AddState =
  | { readonly status: "idle" }
  | { readonly status: "adding" }
  | { readonly status: "added"; readonly count: number }
  | { readonly status: "error"; readonly message: string };

type ModuleCardProps = {
  readonly module: CatalogModuleDto;
  readonly packageId: string;
  readonly addState: AddState;
  readonly onAdd: (module: CatalogModuleDto) => void;
};

export function ModuleCard({ module, packageId, addState, onAdd }: ModuleCardProps) {
  const [posterFailed, setPosterFailed] = useState(false);
  const errorId = `module-${module.id}-error`;
  const showPoster = module.posterUrl !== null && !posterFailed;
  const adding = addState.status === "adding";

  return (
    <article aria-labelledby={`module-${module.id}-name`} className="module-card">
      {showPoster ? (
        // Los posters llegan de dominios externos (Cloudinary, fixture) que
        // next/image no tiene autorizados; un <img> con tamaño fijo por CSS
        // evita configurar dominios que aún no están decididos.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          alt={`Vista previa de ${module.name}`}
          className="module-poster"
          decoding="async"
          loading="lazy"
          onError={() => setPosterFailed(true)}
          src={module.posterUrl ?? undefined}
        />
      ) : (
        <div className="module-poster module-poster-empty" role="img" aria-label={`${module.name} sin imagen`}>
          <span aria-hidden="true">Sin imagen</span>
        </div>
      )}

      <div className="module-body">
        <h2 className="module-name" id={`module-${module.id}-name`}>
          {module.name}
        </h2>

        <dl className="module-facts">
          <div>
            <dt>Precio</dt>
            <dd>{formatCop(module.priceCop)}</dd>
          </div>
          <div>
            <dt>Área</dt>
            <dd>{formatAreaM2(module.areaM2)}</dd>
          </div>
        </dl>

        {/*
          aria-disabled en lugar de disabled: un botón deshabilitado pierde el
          foco, y quien usa el teclado quedaría fuera de la tarjeta tras pulsar
          "Agregar". Se ignoran los clics mientras la petición está en curso.
        */}
        <button
          aria-describedby={addState.status === "error" ? errorId : undefined}
          aria-disabled={adding ? true : undefined}
          aria-label={adding ? `Agregando ${module.name}` : `Agregar ${module.name}`}
          className="auth-submit module-add"
          onClick={() => {
            if (!adding) onAdd(module);
          }}
          type="button"
        >
          {adding ? "Agregando…" : "Agregar"}
        </button>

        <Link
          aria-label={`Ver ${module.name} en 3D`}
          className="secondary-link module-view"
          href={`/packages/${encodeURIComponent(packageId)}/modules/${encodeURIComponent(module.id)}`}
        >
          Ver en 3D
        </Link>

        {addState.status === "added" ? (
          <p className="module-added">
            {addState.count === 1 ? "Agregado a tu paquete" : `Agregado ${addState.count} veces`}
          </p>
        ) : null}

        {addState.status === "error" ? (
          <p className="auth-error" id={errorId} role="alert">
            {addState.message}
          </p>
        ) : null}
      </div>
    </article>
  );
}
