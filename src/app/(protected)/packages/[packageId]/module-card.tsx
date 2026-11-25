"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { CatalogModuleDto } from "@/modules/catalog/application/dtos/catalog-module.dto";
import { MAX_BATCH_QUANTITY } from "@/modules/packages/application/dtos/package.dto";

import { Icon } from "../../_ui/icon";
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

/** Tiempo de la animación de cierre de la hoja (coincide con el CSS). */
const SHEET_CLOSE_MS = 180;

/**
 * Tarjeta del catálogo (rediseño visual móvil): compacta, con la foto, el
 * botón 3D sobre la imagen y un "+" que abre la hoja inferior para elegir
 * zona y cantidad. La hoja es un `<dialog>` modal nativo: atrapa el foco,
 * deja el fondo inerte y se cierra con Escape. Las reglas de cantidad
 * (DECOR-42) y de zona (DECOR-43) no cambian.
 */
export function ModuleCard({ module, packageId, addState, onAdd, remainingM2, zones }: ModuleCardProps) {
  const [posterFailed, setPosterFailed] = useState(false);
  const [quantity, setQuantity] = useState(1);
  const [destination, setDestination] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const titleId = `module-${module.id}-sheet-title`;
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
  // Una subzona recibe una única instancia por operación: el contador se
  // oculta y se agrega de a uno.
  const effectiveQuantity = inZone ? 1 : selectedQuantity;
  const noSpace = maxQuantity === 0;
  const capacityHintId = `module-${module.id}-capacity`;
  const hasZones = Boolean(zones && zones.length > 0);

  // Abre la hoja como modal nativo; jsdom (pruebas) no implementa showModal.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !sheetOpen) return;

    if (!dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }

    // En iPhone el fondo seguiría desplazándose debajo de la hoja.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [sheetOpen]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  function openSheet() {
    setQuantity(1);
    setDestination("");
    setClosing(false);
    setSheetOpen(true);
  }

  function closeSheet() {
    if (!sheetOpen || closing) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      const dialog = dialogRef.current;
      if (dialog?.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
      setSheetOpen(false);
      setClosing(false);
      triggerRef.current?.focus();
    }, SHEET_CLOSE_MS);
  }

  async function confirm() {
    if (adding || (!inZone && noSpace)) return;
    if (await onAdd(module, effectiveQuantity, inZone ? destination : null)) {
      setQuantity(1);
      closeSheet();
    }
  }

  const addedCount = addState.status === "added" ? addState.count : 0;

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

        <Link
          aria-label={`Ver ${module.name} en 3D`}
          className="module-view-3d"
          href={`/packages/${encodeURIComponent(packageId)}/modules/${encodeURIComponent(module.id)}`}
        >
          <Icon name="cube" size={20} />
        </Link>

        {addedCount > 0 ? (
          <p className="module-added" key={addedCount}>
            {addedCount === 1 ? "Agregado a tu evento" : `Agregado ${addedCount} veces`}
          </p>
        ) : null}
      </div>

      <div className="module-body">
        <h2 className="module-name" id={`module-${module.id}-name`}>
          {module.name}
        </h2>
        <p className="module-area">{formatAreaM2(module.areaM2)}</p>

        <div className="module-foot">
          <p className="module-price">{formatCop(module.priceCop)}</p>
          {/*
            aria-disabled en lugar de disabled: el botón conserva el foco y
            quien usa el teclado no queda fuera de la tarjeta.
          */}
          <button
            aria-busy={adding ? true : undefined}
            aria-haspopup="dialog"
            aria-label={`Agregar ${module.name}`}
            className="module-add-trigger"
            onClick={() => (sheetOpen ? undefined : openSheet())}
            ref={triggerRef}
            type="button"
          >
            <Icon name="plus" size={22} />
          </button>
        </div>
      </div>

      {sheetOpen ? (
        <dialog
          aria-labelledby={titleId}
          className={closing ? "add-sheet add-sheet-closing" : "add-sheet"}
          onCancel={(event) => {
            event.preventDefault();
            closeSheet();
          }}
          onClick={(event) => {
            // Un toque en el fondo oscurecido (fuera del panel) cierra la hoja.
            if (event.target === event.currentTarget) closeSheet();
          }}
          ref={dialogRef}
        >
          <div className="add-sheet-panel">
            <span aria-hidden="true" className="add-sheet-handle" />
            <div className="add-sheet-head">
              {showPoster ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img alt="" className="add-sheet-thumb" src={posterUrl} />
              ) : (
                <span aria-hidden="true" className="add-sheet-thumb add-sheet-thumb-empty">
                  <Icon name="cube" />
                </span>
              )}
              <div className="add-sheet-title-block">
                <h3 className="add-sheet-title" id={titleId}>
                  {module.name}
                </h3>
                <p className="add-sheet-meta">
                  {formatCop(module.priceCop)} c/u · {formatAreaM2(module.areaM2)}
                </p>
              </div>
              <button aria-label="Cerrar" className="icon-button" onClick={closeSheet} type="button">
                <Icon name="x" />
              </button>
            </div>

            {hasZones ? (
              <fieldset className="add-sheet-zones">
                <legend>Zona</legend>
                <div className="chip-group">
                  <label className="chip">
                    <input
                      checked={destination === ""}
                      name={`module-${module.id}-zone`}
                      onChange={() => setDestination("")}
                      type="radio"
                      value=""
                    />
                    <span>Sin zona</span>
                  </label>
                  {zones!.map((zone) => (
                    <label className="chip" key={zone.groupId}>
                      <input
                        checked={destination === zone.groupId}
                        name={`module-${module.id}-zone`}
                        onChange={() => setDestination(zone.groupId)}
                        type="radio"
                        value={zone.groupId}
                      />
                      <span>{zoneLabel(zone)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {inZone ? (
              <p className="add-sheet-note">En una zona se agrega una unidad por vez.</p>
            ) : (
              <div className="add-sheet-quantity">
                <p aria-hidden="true" className="add-sheet-label">
                  Cantidad
                </p>
                <div aria-label={`Cantidad de ${module.name}`} className="stepper" role="group">
                  <button
                    aria-disabled={selectedQuantity === 1 ? true : undefined}
                    aria-label={`Reducir cantidad de ${module.name}`}
                    className="stepper-button"
                    onClick={() => setQuantity(Math.max(1, selectedQuantity - 1))}
                    type="button"
                  >
                    <Icon name="minus" size={22} />
                  </button>
                  <output aria-live="polite" className="stepper-value" key={selectedQuantity}>
                    {selectedQuantity}
                  </output>
                  <button
                    aria-describedby={remainingM2 !== undefined && selectedQuantity >= maxQuantity ? capacityHintId : undefined}
                    aria-disabled={selectedQuantity >= maxQuantity ? true : undefined}
                    aria-label={`Aumentar cantidad de ${module.name}`}
                    className="stepper-button stepper-button-primary"
                    onClick={() => setQuantity(Math.max(1, Math.min(maxQuantity, selectedQuantity + 1)))}
                    type="button"
                  >
                    <Icon name="plus" size={22} />
                  </button>
                </div>
                {remainingM2 !== undefined ? (
                  <p className="field-hint" id={capacityHintId}>
                    {noSpace ? "No queda espacio para otra unidad." : `Máximo ${maxQuantity} según el espacio disponible.`}
                  </p>
                ) : null}
              </div>
            )}

            <div className="add-sheet-total">
              <span>
                {effectiveQuantity} × {formatCop(module.priceCop)}
              </span>
              <strong>{formatCop(module.priceCop * effectiveQuantity)}</strong>
            </div>

            {addState.status === "error" ? (
              <p className="auth-error" id={errorId} role="alert">
                {addState.message}
              </p>
            ) : null}

            <button
              aria-busy={adding ? true : undefined}
              aria-describedby={addState.status === "error" ? errorId : !inZone && noSpace ? capacityHintId : undefined}
              aria-disabled={adding || (!inZone && noSpace) ? true : undefined}
              aria-label={adding
                ? effectiveQuantity === 1 ? `Agregando ${module.name}` : `Agregando ${effectiveQuantity} unidades de ${module.name}`
                : effectiveQuantity === 1 ? `Agregar ${module.name}` : `Agregar ${effectiveQuantity} unidades de ${module.name}`}
              className="auth-submit add-sheet-confirm"
              onClick={() => void confirm()}
              type="button"
            >
              <Icon name="plus" />
              {adding ? "Agregando…" : effectiveQuantity === 1 ? "Agregar" : `Agregar ${effectiveQuantity}`}
            </button>
          </div>
        </dialog>
      ) : null}
    </article>
  );
}
