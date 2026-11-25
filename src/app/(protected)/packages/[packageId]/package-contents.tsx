"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import type { PackageDetailNode } from "@/modules/packages/application/dtos/package-detail.dto";

import { Icon } from "../../_ui/icon";
import { rowSubtotal, toFlatContentRows } from "../_lib/configurator-view";
import { eventSectionHref } from "../_lib/event-sections";
import { formatAreaM2, formatCop } from "../_lib/format";
import { getPackagesClient, type PackagesClient } from "../_lib/packages-client";

type PackageContentsProps = {
  readonly packageId: string;
  readonly nodes: readonly PackageDetailNode[];
  /** Versión del paquete leída del servidor; un error solo se muestra para la versión en la que ocurrió. */
  readonly version: number;
  /** Inyectable para las pruebas. */
  readonly client?: PackagesClient;
};

type LeavesRow = ReturnType<typeof toFlatContentRows>[number];
type RowError = { readonly message: string; readonly version: number };

function focusSlug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/**
 * Contenido del evento (DECOR-22): una fila por módulo con su cantidad y su
 * subtotal informativo, y un botón para quitar una unidad. Las zonas se
 * retiraron de la interfaz; las unidades que el servidor guarde dentro de un
 * grupo se muestran igual, en la misma lista. La mutación pasa por el cliente
 * HTTP y, si sale bien, se vuelve a pedir la página; si falla, el error
 * aparece junto a la fila sin cambiar nada.
 */
export function PackageContents({ packageId, nodes, version, client }: PackageContentsProps) {
  const router = useRouter();
  const packages = client ?? getPackagesClient();
  const rows = useMemo(() => toFlatContentRows(nodes), [nodes]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, RowError>>({});
  const [announcement, setAnnouncement] = useState("");
  const [isRefreshing, startTransition] = useTransition();
  // Mientras llega la página nueva los itemIds en pantalla ya no son fiables:
  // ninguna mutación se acepta hasta que termine el refresco.
  const isBusy = pendingKey !== null || isRefreshing;

  function refreshFromServer() {
    startTransition(() => router.refresh());
  }

  function errorFor(key: string): string | null {
    const stored = errors[key];

    return stored && stored.version === version ? stored.message : null;
  }

  async function removeOne(key: string, row: LeavesRow) {
    if (isBusy) {
      return;
    }

    const itemId = row.itemIds[row.itemIds.length - 1];
    const isLastUnit = row.itemIds.length === 1;

    setPendingKey(key);
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setAnnouncement("Guardando cambios…");

    const result = await packages.removeItem(packageId, itemId);

    setPendingKey(null);

    if (result.ok) {
      setAnnouncement(`Se quitó una unidad de ${row.name}.`);
      // La fila desaparece: el foco pasa al título para no perderse.
      if (isLastUnit) headingRef.current?.focus();
      refreshFromServer();
      return;
    }

    if (result.error.kind === "unauthorized") {
      router.push("/login");
      return;
    }

    setErrors((current) => ({ ...current, [key]: { message: result.error.message, version } }));
    setAnnouncement("");

    // Si el recurso ya no existe, la pantalla está desactualizada: se resincroniza.
    if (result.error.code === "package.item_not_found" || result.error.code === "package.not_found") {
      refreshFromServer();
    }
  }

  return (
    <section aria-labelledby="package-contents-title" className="configurator-card package-contents">
      {/* Destino de foco cuando desaparece la fila con la que se interactuaba. */}
      <h2 className="section-title page-heading" id="package-contents-title" ref={headingRef} tabIndex={-1}>
        Contenido del evento
      </h2>
      <p className="content-hint">Los subtotales son informativos; el total confirmado lo calcula Presupuesto.</p>

      {rows.length === 0 ? (
        <div className="content-empty-state">
          <p className="content-empty">Tu evento todavía no tiene elementos. Agrégalos desde el catálogo.</p>
          <Link className="secondary-link" href={eventSectionHref(packageId, "catalogo")}>
            <Icon name="grid" size={18} />
            Ir al catálogo
          </Link>
        </div>
      ) : (
        <ul className="content-list">
          {rows.map((row) => {
            const key = `m:${row.moduleId}`;
            const removeError = errorFor(key);
            const isRemoving = pendingKey === key;
            const removeErrorId = `${focusSlug(key)}-remove-error`;
            const subtotal = rowSubtotal(row);

            return (
              <li key={key}>
                <div className="content-row content-item">
                  <p className="content-main">
                    <span className="content-name">{row.name}</span>
                    <span className="content-qty">×{row.itemIds.length}</span>
                  </p>
                  <p className="content-subtotal">
                    {formatCop(subtotal.priceCop)} · {formatAreaM2(subtotal.areaM2)}
                  </p>
                  <button
                    aria-busy={isRemoving ? true : undefined}
                    aria-describedby={removeError ? removeErrorId : undefined}
                    aria-disabled={isBusy ? true : undefined}
                    aria-label={isRemoving ? `Quitando ${row.name}` : `Quitar una unidad de ${row.name}`}
                    className="icon-button content-remove"
                    onClick={() => void removeOne(key, row)}
                    type="button"
                  >
                    {isRemoving ? <span aria-hidden="true" className="spinner" /> : <Icon name="minus" />}
                  </button>
                </div>

                {removeError ? (
                  <p className="auth-error" id={removeErrorId} role="alert">
                    {removeError}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p aria-live="polite" className="visually-hidden" role="status">
        {announcement}
      </p>
    </section>
  );
}
