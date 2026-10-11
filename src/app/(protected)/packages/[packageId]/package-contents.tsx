"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type { PackageDetailNode } from "@/modules/packages/application/dtos/package-detail.dto";

import { rowSubtotal, toContentRows, type ContentRow } from "../_lib/configurator-view";
import { formatAreaM2, formatCop } from "../_lib/format";
import { getPackagesClient, type PackagesClient } from "../_lib/packages-client";

type PackageContentsProps = {
  readonly packageId: string;
  readonly nodes: readonly PackageDetailNode[];
  /** Inyectable para las pruebas. */
  readonly client?: PackagesClient;
};

type LeavesRow = Extract<ContentRow, { kind: "leaves" }>;

/**
 * Contenido del paquete (DECOR-22): hojas sueltas y grupos (Composite) tal como
 * los guarda el servidor. Quitar llama a `DELETE /items/{itemId}` y, si sale
 * bien, vuelve a pedir la página al servidor; si falla, no cambia nada y
 * muestra el error junto al elemento.
 */
export function PackageContents({ packageId, nodes, client }: PackageContentsProps) {
  const router = useRouter();
  const packages = client ?? getPackagesClient();
  const rows = useMemo(() => toContentRows(nodes), [nodes]);
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [announcement, setAnnouncement] = useState("");
  const [, startTransition] = useTransition();

  async function removeOne(key: string, row: LeavesRow) {
    if (removingKey !== null) {
      return;
    }

    const itemId = row.itemIds[row.itemIds.length - 1];
    setRemovingKey(key);
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setAnnouncement(`Quitando ${row.name}…`);

    const result = await packages.removeItem(packageId, itemId);
    setRemovingKey(null);

    if (result.ok) {
      setAnnouncement(`Se quitó una unidad de ${row.name}.`);
      startTransition(() => router.refresh());
      return;
    }

    if (result.error.kind === "unauthorized") {
      router.push("/login");
      return;
    }

    setErrors((current) => ({ ...current, [key]: result.error.message }));
    setAnnouncement("");
  }

  function renderRows(list: readonly ContentRow[], parentKey: string) {
    return (
      <ul className="content-list">
        {list.map((row) => {
          if (row.kind === "group") {
            const key = `g:${row.groupId}`;
            const isOpen = expanded[key] ?? false;
            const childrenId = `group-${row.groupId}-children`;
            const subtotal = rowSubtotal(row);

            return (
              <li key={key}>
                <div className="content-row content-group">
                  <button
                    aria-controls={childrenId}
                    aria-expanded={isOpen}
                    className="group-toggle"
                    onClick={() => setExpanded((current) => ({ ...current, [key]: !isOpen }))}
                    type="button"
                  >
                    <span aria-hidden="true" className="group-caret">
                      {isOpen ? "▾" : "▸"}
                    </span>
                    <span className="content-name">{row.name}</span>
                    <span className="content-qty">
                      {row.leafCount} {row.leafCount === 1 ? "elemento" : "elementos"}
                    </span>
                  </button>
                  <p className="content-subtotal">
                    {formatCop(subtotal.priceCop)} · {formatAreaM2(subtotal.areaM2)}
                  </p>
                </div>
                <div className="content-children" hidden={!isOpen} id={childrenId}>
                  {row.children.length > 0 ? (
                    renderRows(row.children, key)
                  ) : (
                    <p className="content-empty">Este grupo no tiene elementos.</p>
                  )}
                </div>
              </li>
            );
          }

          const key = `${parentKey}/m:${row.moduleId}`;
          const isRemoving = removingKey === key;
          const error = errors[key];
          const errorId = `${key.replace(/[^a-zA-Z0-9-]/g, "-")}-error`;
          const subtotal = rowSubtotal(row);

          return (
            <li key={key}>
              <div className="content-row">
                <p className="content-main">
                  <span className="content-name">{row.name}</span>
                  <span className="content-qty">×{row.itemIds.length}</span>
                </p>
                <p className="content-subtotal">
                  {formatCop(subtotal.priceCop)} · {formatAreaM2(subtotal.areaM2)}
                </p>
                <button
                  aria-busy={isRemoving}
                  aria-describedby={error ? errorId : undefined}
                  aria-disabled={removingKey !== null}
                  aria-label={isRemoving ? `Quitando ${row.name}` : `Quitar una unidad de ${row.name}`}
                  className="secondary-button content-remove"
                  onClick={() => removeOne(key, row)}
                  type="button"
                >
                  {isRemoving ? "Quitando…" : "Quitar uno"}
                </button>
                {error ? (
                  <p className="auth-error" id={errorId} role="alert">
                    {error}
                  </p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section aria-labelledby="package-contents-title" className="configurator-card package-contents">
      <h2 className="section-title" id="package-contents-title">
        Contenido del paquete
      </h2>
      <p className="content-hint">Los subtotales son informativos; el total confirmado lo calcula Presupuesto.</p>

      {rows.length === 0 ? (
        <p className="content-empty">Tu paquete todavía no tiene elementos. Agrégalos desde el catálogo.</p>
      ) : (
        renderRows(rows, "root")
      )}

      <p aria-live="polite" className="visually-hidden" role="status">
        {announcement}
      </p>
    </section>
  );
}
