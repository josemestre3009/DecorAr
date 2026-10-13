"use client";

import Link from "next/link";
import { useState } from "react";

import type { PackageSummary } from "@/modules/packages/application/ports/package-reader.port";

import { spaceTypeLabel } from "./_lib/configurator-view";
import { formatAreaM2, formatEventDate } from "./_lib/format";

const EVENTS_PER_PAGE = 4;

function summaryLine(pkg: PackageSummary): string {
  const parts = [
    pkg.clientName,
    pkg.spaceType ? spaceTypeLabel(pkg.spaceType) : null,
    pkg.capacityM2 === null ? null : formatAreaM2(pkg.capacityM2),
  ].filter((part): part is string => Boolean(part));

  return parts.length > 0 ? parts.join(" · ") : "Sin datos del cliente";
}

export function EventHistory({ packages }: { readonly packages: readonly PackageSummary[] }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.ceil(packages.length / EVENTS_PER_PAGE);
  const lastPage = Math.max(0, pageCount - 1);
  const currentPage = Math.min(page, lastPage);
  const visiblePackages = packages.slice(currentPage * EVENTS_PER_PAGE, (currentPage + 1) * EVENTS_PER_PAGE);

  return (
    <>
      <ul className="package-history-list" role="list">
        {visiblePackages.map((pkg) => (
          <li className="package-history-card" key={pkg.id}>
            <div>
              <h3>{pkg.name || "Evento sin nombre"}</h3>
              <p className="package-history-meta">{summaryLine(pkg)}</p>
            </div>
            <p className="package-history-date">
              Actualizado el {formatEventDate(pkg.updatedAt) ?? "—"}
            </p>
            <Link
              aria-label={`Continuar con ${pkg.name || "evento sin nombre"}`}
              className="secondary-button package-history-link"
              href={`/packages/${pkg.id}`}
            >
              Continuar
            </Link>
          </li>
        ))}
      </ul>

      {pageCount > 1 ? (
        <nav aria-label="Paginación de eventos" className="package-pagination">
          <button
            className="secondary-button"
            disabled={currentPage === 0}
            onClick={() => setPage((current) => current - 1)}
            type="button"
          >
            Anterior
          </button>
          <p aria-live="polite">
            Página {currentPage + 1} de {pageCount}
          </p>
          <button
            className="secondary-button"
            disabled={currentPage === lastPage}
            onClick={() => setPage((current) => current + 1)}
            type="button"
          >
            Siguiente
          </button>
        </nav>
      ) : null}
    </>
  );
}
