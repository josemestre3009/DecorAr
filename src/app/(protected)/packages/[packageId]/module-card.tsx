"use client";

import Link from "next/link";
import { useState } from "react";

import type { CatalogModuleDto } from "@/modules/catalog/application/dtos/catalog-module.dto";
import { MAX_BATCH_QUANTITY } from "@/modules/packages/application/dtos/package.dto";

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
  readonly onAdd: (module: CatalogModuleDto, quantity: number) => Promise<boolean>;
  readonly remainingM2?: number;
};

export function ModuleCard({ module, packageId, addState, onAdd, remainingM2 }: ModuleCardProps) {
  const [posterFailed, setPosterFailed] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const errorId = `module-${module.id}-error`;
  const showPoster = module.posterUrl !== null && !posterFailed;
  const adding = addState.status === "adding";
  const maxQuantity = remainingM2 === undefined
    ? MAX_BATCH_QUANTITY
    : module.areaM2 > 0
      ? Math.min(MAX_BATCH_QUANTITY, Math.max(0, Math.floor(remainingM2 / module.areaM2)))
      : 0;
  const [previousMaxQuantity, setPreviousMaxQuantity] = useState(maxQuantity);
  if (maxQuantity !== previousMaxQuantity) {
    setPreviousMaxQuantity(maxQuantity);
    setQuantity((value) => Math.max(1, Math.min(value, maxQuantity)));
  }
  const selectedQuantity = Math.max(1, Math.min(quantity, maxQuantity));
  const noSpace = maxQuantity === 0;
  const capacityHintId = `module-${module.id}-capacity`;

  return (
    <article aria-labelledby={`module-${module.id}-name`} className="module-card">
        <div className="module-preview">
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
          {selectedQuantity > 1 ? <span key={selectedQuantity} className="module-quantity-preview">×{selectedQuantity}</span> : null}
        </div>

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

        <div className="quantity-selector" role="group" aria-label={`Cantidad de ${module.name}`}>
          <button
            aria-disabled={selectedQuantity === 1 ? true : undefined}
            aria-label={`Reducir cantidad de ${module.name}`}
            className="quantity-step"
            onClick={() => setQuantity(Math.max(1, selectedQuantity - 1))}
            type="button"
          >
            −
          </button>
          <output aria-live="polite" className="quantity-value">{selectedQuantity}</output>
          <button
            aria-describedby={remainingM2 !== undefined && selectedQuantity >= maxQuantity ? capacityHintId : undefined}
            aria-disabled={selectedQuantity >= maxQuantity ? true : undefined}
            aria-label={`Aumentar cantidad de ${module.name}`}
            className="quantity-step"
            onClick={() => setQuantity(Math.max(1, Math.min(maxQuantity, selectedQuantity + 1)))}
            type="button"
          >
            +
          </button>
        </div>
        {remainingM2 !== undefined ? (
          <p className="field-hint" id={capacityHintId}>
            {noSpace ? "No queda espacio para otra unidad." : `Máximo ${maxQuantity} según el espacio disponible.`}
          </p>
        ) : null}

        {/*
          aria-disabled en lugar de disabled: un botón deshabilitado pierde el
          foco, y quien usa el teclado quedaría fuera de la tarjeta tras pulsar
          "Agregar". Se ignoran los clics mientras la petición está en curso.
        */}
        <button
          aria-describedby={addState.status === "error" ? errorId : noSpace ? capacityHintId : undefined}
          aria-busy={adding ? true : undefined}
          aria-disabled={adding || noSpace ? true : undefined}
          aria-label={adding
            ? selectedQuantity === 1 ? `Agregando ${module.name}` : `Agregando ${selectedQuantity} unidades de ${module.name}`
            : selectedQuantity === 1 ? `Agregar ${module.name}` : `Agregar ${selectedQuantity} unidades de ${module.name}`}
          className="auth-submit module-add"
          onClick={async () => {
            if (!adding && !noSpace && await onAdd(module, selectedQuantity)) setQuantity(1);
          }}
          type="button"
        >
          {adding ? "Agregando…" : selectedQuantity === 1 ? "Agregar" : `Agregar ${selectedQuantity}`}
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
