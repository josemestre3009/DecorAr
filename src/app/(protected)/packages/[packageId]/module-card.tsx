"use client";

import Link from "next/link";
import { useState } from "react";

import type { CatalogModuleDto } from "@/modules/catalog/application/dtos/catalog-module.dto";
import { MAX_BATCH_QUANTITY } from "@/modules/packages/application/dtos/package.dto";

import { formatAreaM2, formatCop } from "../_lib/format";
import { zoneLabel, type ZoneOption } from "../_lib/zone-tree";

export type AddState =
  | { readonly status: "idle" }
  | { readonly status: "adding" }
  | { readonly status: "added"; readonly count: number }
  | { readonly status: "error"; readonly message: string };

type ModuleCardProps = {
  readonly module: CatalogModuleDto;
  readonly packageId: string;
  readonly addState: AddState;
  /** Zona destino elegida; el destino rápido sigue siendo la raíz (`null`). */
  readonly onAdd: (module: CatalogModuleDto, quantity: number, groupId: string | null) => Promise<boolean>;
  readonly remainingM2?: number;
  readonly zones?: readonly ZoneOption[];
};

export function ModuleCard({ module, packageId, addState, onAdd, remainingM2, zones }: ModuleCardProps) {
  const [posterFailed, setPosterFailed] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [destination, setDestination] = useState("");
  const destinationId = `module-${module.id}-zone`;
  const errorId = `module-${module.id}-error`;
  const posterUrl = module.posterUrl?.trim() || null;
  const showPoster = posterUrl !== null && !posterFailed;
  const adding = addState.status === "adding";
  const inZone = destination !== "";
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
  // Una subzona recibe una única instancia por operación: el selector de
  // cantidad se oculta y se agrega de a uno.
  const effectiveQuantity = inZone ? 1 : selectedQuantity;
  const noSpace = maxQuantity === 0;
  const capacityHintId = `module-${module.id}-capacity`;

  return (
    <article aria-labelledby={`module-${module.id}-name`} className="module-card">
      <div className="module-preview">
        {showPoster ? (
          // Los posters llegan de dominios externos aún no configurados en next/image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            alt={`Vista previa de ${module.name}`}
            className="module-poster"
            decoding="async"
            loading="lazy"
            onError={() => setPosterFailed(true)}
            src={posterUrl}
          />
        ) : (
          <div aria-label={`${module.name} sin imagen`} className="module-poster module-poster-empty" role="img">
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

        {zones && zones.length > 0 ? (
          <div className="zone-field module-destination">
            <label htmlFor={destinationId}>Zona</label>
            <select
              id={destinationId}
              onChange={(event) => setDestination(event.target.value)}
              value={destination}
            >
              <option value="">Sin zona (raíz)</option>
              {zones.map((zone) => (
                <option key={zone.groupId} value={zone.groupId}>
                  {zoneLabel(zone)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {inZone ? null : (
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
        )}
        {remainingM2 !== undefined && !inZone ? (
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
          aria-describedby={addState.status === "error" ? errorId : !inZone && noSpace ? capacityHintId : undefined}
          aria-busy={adding ? true : undefined}
          aria-disabled={adding || (!inZone && noSpace) ? true : undefined}
          aria-label={adding
            ? effectiveQuantity === 1 ? `Agregando ${module.name}` : `Agregando ${effectiveQuantity} unidades de ${module.name}`
            : effectiveQuantity === 1 ? `Agregar ${module.name}` : `Agregar ${effectiveQuantity} unidades de ${module.name}`}
          className="auth-submit module-add"
          onClick={async () => {
            if (!adding && (inZone || !noSpace) && await onAdd(module, effectiveQuantity, inZone ? destination : null)) {
              setQuantity(1);
            }
          }}
          type="button"
        >
          {adding ? "Agregando…" : effectiveQuantity === 1 ? "Agregar" : `Agregar ${effectiveQuantity}`}
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
            {addState.count === 1 ? "Agregado a tu evento" : `Agregado ${addState.count} veces`}
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
