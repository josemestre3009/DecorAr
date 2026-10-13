"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";

import type { PackageDetailNode } from "@/modules/packages/application/dtos/package-detail.dto";
import type { Result } from "@/shared/domain/result";

import type { ApiFailure } from "../_lib/api-error";
import { rowSubtotal, toContentRows, type ContentRow } from "../_lib/configurator-view";
import { formatAreaM2, formatCop } from "../_lib/format";
import {
  getPackageGroupsClient,
  type CreatedGroup,
  type PackageGroupsClient,
} from "../_lib/package-groups-client";
import { getPackagesClient, type PackagesClient } from "../_lib/packages-client";
import {
  buildZoneTree,
  flattenZones,
  MAX_ZONE_DEPTH,
  validMoveTargets,
  zoneLabel,
  zoneNameError,
  type ZoneOption,
} from "../_lib/zone-tree";
import { NewZoneForm } from "./new-zone-form";

type PackageContentsProps = {
  readonly packageId: string;
  readonly nodes: readonly PackageDetailNode[];
  /** Versión del paquete leída del servidor; un error solo se muestra para la versión en la que ocurrió. */
  readonly version: number;
  /** Inyectables para las pruebas. */
  readonly client?: PackagesClient;
  readonly groupsClient?: PackageGroupsClient;
};

type LeavesRow = Extract<ContentRow, { kind: "leaves" }>;
type RowError = { readonly message: string; readonly version: number };

/** Una sola acción activa a la vez: renombrar, crear subzona, mover o eliminar. */
type Editor =
  | { readonly kind: "rename"; readonly groupId: string }
  | { readonly kind: "subzone"; readonly groupId: string }
  | { readonly kind: "moveZone"; readonly groupId: string }
  | { readonly kind: "deleteZone"; readonly groupId: string }
  | { readonly kind: "moveItem"; readonly itemId: string; readonly rowKey: string };

function focusSlug(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "-");
}

/**
 * Contenido del evento (DECOR-22 + zonas editables): hojas sueltas y zonas
 * jerárquicas tal como las guarda el servidor. Todas las mutaciones pasan por
 * los clientes HTTP (nunca por las tablas de negocio) y, si salen bien, vuelven
 * a pedir la página; si fallan, muestran el error junto a la fila sin cambiar
 * nada.
 */
export function PackageContents({
  packageId,
  nodes,
  version,
  client,
  groupsClient,
}: PackageContentsProps) {
  const router = useRouter();
  const packages = client ?? getPackagesClient();
  const groups = groupsClient ?? getPackageGroupsClient();
  const rows = useMemo(() => toContentRows(nodes), [nodes]);
  const zones = useMemo(() => flattenZones(buildZoneTree(nodes)), [nodes]);
  const zoneById = useMemo(() => new Map(zones.map((zone) => [zone.groupId, zone])), [zones]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftParent, setDraftParent] = useState("");
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, RowError>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [announcement, setAnnouncement] = useState("");
  const focusTargetRef = useRef<string | null>(null);
  const [isRefreshing, startTransition] = useTransition();
  // Mientras llega la página nueva los itemIds en pantalla ya no son fiables:
  // ninguna mutación se acepta hasta que termine el refresco.
  const isBusy = pendingKey !== null || isRefreshing;

  function refreshFromServer() {
    startTransition(() => router.refresh());
  }

  // El foco vuelve a la acción de la fila cuando el control que la originó
  // desaparece (editor inline). Se resuelve en la referencia del botón, sin
  // setState dentro de un efecto.
  function focusRef(key: string) {
    return (element: HTMLButtonElement | null) => {
      if (element && focusTargetRef.current === key) {
        element.focus();
        focusTargetRef.current = null;
      }
    };
  }

  function closeEditor(focusKey: string) {
    focusTargetRef.current = focusKey;
    setEditor(null);
  }

  function errorFor(key: string): string | null {
    const stored = errors[key];

    return stored && stored.version === version ? stored.message : null;
  }

  async function runMutation<T>(
    key: string,
    action: () => Promise<Result<T, ApiFailure>>,
    successMessage: string,
    after?: () => void,
  ) {
    if (isBusy) {
      return;
    }

    setPendingKey(key);
    setErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    setAnnouncement("Guardando cambios…");

    const result = await action();

    setPendingKey(null);

    if (result.ok) {
      setEditor(null);
      setAnnouncement(successMessage);
      after?.();
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
    if (
      result.error.code === "package.group_not_found" ||
      result.error.code === "package.item_not_found" ||
      result.error.code === "package.not_found"
    ) {
      refreshFromServer();
    }
  }

  function parentOf(zone: ZoneOption): string | null {
    return zone.ancestorIds[zone.ancestorIds.length - 1] ?? null;
  }

  function handleZoneCreated(created: CreatedGroup) {
    if (created.parentGroupId) {
      setExpanded((current) => ({ ...current, [`g:${created.parentGroupId}`]: true }));
    }

    setEditor(null);
    setAnnouncement(`La zona ${created.name} se creó.`);
    focusTargetRef.current = `zone-${created.groupId}`;
    refreshFromServer();
  }

  function openRename(groupId: string, currentName: string) {
    if (isBusy) return;
    setDraftName(currentName);
    setEditor({ groupId, kind: "rename" });
  }

  function openSubzone(groupId: string) {
    const zone = zoneById.get(groupId);

    if (isBusy || !zone || zone.depth >= MAX_ZONE_DEPTH) {
      return;
    }

    setEditor({ groupId, kind: "subzone" });
  }

  function openMoveZone(zone: ZoneOption) {
    if (isBusy) return;
    setDraftParent(parentOf(zone) ?? "");
    setEditor({ groupId: zone.groupId, kind: "moveZone" });
  }

  function openDeleteZone(groupId: string) {
    if (isBusy) return;
    setEditor({ groupId, kind: "deleteZone" });
  }

  function openMoveItem(itemId: string, rowKey: string, currentGroupId: string | null) {
    if (isBusy) return;
    setDraftParent(currentGroupId ?? "");
    setEditor({ itemId, kind: "moveItem", rowKey });
  }

  function submitRename(groupId: string) {
    const invalid = zoneNameError(draftName);

    if (invalid) {
      setErrors((current) => ({ ...current, [`zone:${groupId}`]: { message: invalid, version } }));
      setAnnouncement(invalid);
      return;
    }

    void runMutation(
      `zone:${groupId}`,
      () => groups.updateGroup(packageId, groupId, { expectedVersion: version, name: draftName.trim() }),
      "La zona se renombró.",
      () => {
        focusTargetRef.current = `zone-${groupId}`;
      },
    );
  }

  function submitMoveZone(groupId: string) {
    void runMutation(
      `zone:${groupId}`,
      () =>
        groups.updateGroup(packageId, groupId, {
          expectedVersion: version,
          parentGroupId: draftParent === "" ? null : draftParent,
        }),
      "La zona se movió.",
      () => {
        focusTargetRef.current = `zone-${groupId}`;
      },
    );
  }

  function submitDeleteZone(groupId: string, strategy: "move_to_root" | "delete_contents") {
    void runMutation(
      `zone:${groupId}`,
      () => groups.deleteGroup(packageId, groupId, { expectedVersion: version, strategy }),
      "La zona se eliminó.",
      () => headingRef.current?.focus(),
    );
  }

  function submitMoveItem(itemId: string, rowKey: string) {
    void runMutation(
      `move:${rowKey}`,
      () =>
        packages.moveItem(packageId, itemId, {
          expectedVersion: version,
          groupId: draftParent === "" ? null : draftParent,
        }),
      "El elemento se movió de zona.",
      () => {
        focusTargetRef.current = `item-${focusSlug(rowKey)}`;
      },
    );
  }

  async function removeOne(key: string, row: LeavesRow) {
    const itemId = row.itemIds[row.itemIds.length - 1];
    const isLastUnit = row.itemIds.length === 1;

    await runMutation(
      `remove:${key}`,
      () => packages.removeItem(packageId, itemId),
      `Se quitó una unidad de ${row.name}.`,
      () => {
        if (isLastUnit) {
          headingRef.current?.focus();
        }
      },
    );
  }

  function renderZoneEditor(editing: Editor, row: Extract<ContentRow, { kind: "group" }>) {
    const error = errorFor(`zone:${row.groupId}`);
    const isPending = pendingKey === `zone:${row.groupId}`;
    const editorId = `zone-${row.groupId}`;

    if (editing.kind === "rename") {
      return (
        <form
          className="zone-editor"
          onSubmit={(event) => {
            event.preventDefault();
            submitRename(row.groupId);
          }}
        >
          <div className="zone-field">
            <label htmlFor={`${editorId}-rename`}>Nuevo nombre para {row.name}</label>
            <input
              aria-describedby={error ? `${editorId}-error` : undefined}
              aria-invalid={error ? true : undefined}
              autoComplete="off"
              autoFocus
              id={`${editorId}-rename`}
              onChange={(event) => setDraftName(event.target.value)}
              type="text"
              value={draftName}
            />
          </div>
          <div className="zone-editor-actions">
            <button
              aria-busy={isPending ? true : undefined}
              aria-disabled={isPending || isBusy ? true : undefined}
              className="secondary-button"
              type="submit"
            >
              {isPending ? "Guardando…" : "Guardar nombre"}
            </button>
            <button className="text-button" onClick={() => closeEditor(`zone-${row.groupId}`)} type="button">
              Cancelar
            </button>
          </div>
          {error ? (
            <p className="auth-error" id={`${editorId}-error`} role="alert">
              {error}
            </p>
          ) : null}
        </form>
      );
    }

    if (editing.kind === "subzone") {
      return (
        <NewZoneForm
          client={groups}
          autoFocus
          disabled={isBusy}
          expectedVersion={version}
          onCancel={() => closeEditor(`zone-${row.groupId}`)}
          onCreated={handleZoneCreated}
          packageId={packageId}
          parentGroupId={row.groupId}
          parentName={row.name}
          submitLabel="Crear subzona"
          zones={zones}
        />
      );
    }

    if (editing.kind === "moveZone") {
      const zone = zoneById.get(row.groupId);
      const targets = zone ? validMoveTargets(zones, zone) : [];

      return (
        <form
          className="zone-editor"
          onSubmit={(event) => {
            event.preventDefault();
            submitMoveZone(row.groupId);
          }}
        >
          <div className="zone-field">
            <label htmlFor={`${editorId}-move`}>Mover {row.name} a</label>
            <select
              autoFocus
              id={`${editorId}-move`}
              onChange={(event) => setDraftParent(event.target.value)}
              value={draftParent}
            >
              <option value="">Sin zona (raíz)</option>
              {targets.map((target) => (
                <option key={target.groupId} value={target.groupId}>
                  {zoneLabel(target)}
                </option>
              ))}
            </select>
          </div>
          <div className="zone-editor-actions">
            <button
              aria-busy={isPending ? true : undefined}
              aria-disabled={isPending || isBusy ? true : undefined}
              className="secondary-button"
              type="submit"
            >
              {isPending ? "Moviendo…" : "Mover zona"}
            </button>
            <button className="text-button" onClick={() => closeEditor(`zone-${row.groupId}`)} type="button">
              Cancelar
            </button>
          </div>
          {error ? (
            <p className="auth-error" id={`${editorId}-error`} role="alert">
              {error}
            </p>
          ) : null}
        </form>
      );
    }

    return (
      <div className="zone-confirm">
        <p>¿Eliminar {row.name}?</p>
        <div className="zone-editor-actions">
          <button
            aria-busy={isPending ? true : undefined}
            aria-disabled={isPending || isBusy ? true : undefined}
            autoFocus
            className="secondary-button"
            onClick={() => submitDeleteZone(row.groupId, "move_to_root")}
            type="button"
          >
            Mover contenido a la raíz y eliminar zona
          </button>
          <button
            aria-disabled={isPending || isBusy ? true : undefined}
            className="text-button zone-delete"
            onClick={() => submitDeleteZone(row.groupId, "delete_contents")}
            type="button"
          >
            Eliminar zona y todo su contenido
          </button>
          <button className="text-button" onClick={() => closeEditor(`zone-${row.groupId}`)} type="button">
            Cancelar
          </button>
        </div>
        {error ? (
          <p className="auth-error" id={`${editorId}-error`} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  function renderRows(list: readonly ContentRow[], parentKey: string, parentGroupId: string | null) {
    return (
      <ul className="content-list">
        {list.map((row) => {
          if (row.kind === "group") {
            const key = `g:${row.groupId}`;
            const isOpen = expanded[key] ?? false;
            const childrenId = `group-${row.groupId}-children`;
            const subtotal = rowSubtotal(row);
            const zone = zoneById.get(row.groupId);
            const editing = editor && "groupId" in editor && editor.groupId === row.groupId ? editor : null;
            const error = errorFor(`zone:${row.groupId}`);

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

                {editing ? (
                  renderZoneEditor(editing, row)
                ) : (
                  <div className="zone-actions">
                    <button
                      className="text-button"
                      onClick={() => openRename(row.groupId, row.name)}
                      ref={focusRef(`zone-${row.groupId}`)}
                      type="button"
                    >
                      Renombrar
                    </button>
                    <button
                      aria-disabled={(zone?.depth ?? MAX_ZONE_DEPTH) >= MAX_ZONE_DEPTH ? true : undefined}
                      className="text-button"
                      onClick={() => openSubzone(row.groupId)}
                      type="button"
                    >
                      Crear subzona
                    </button>
                    <button className="text-button" onClick={() => zone && openMoveZone(zone)} type="button">
                      Mover
                    </button>
                    <button
                      className="text-button zone-delete"
                      onClick={() => openDeleteZone(row.groupId)}
                      type="button"
                    >
                      Eliminar
                    </button>
                    {zone ? <span className="zone-depth">Nivel {zone.depth}</span> : null}
                  </div>
                )}

                {!editing && error ? (
                  <p className="auth-error" id={`zone-${row.groupId}-error`} role="alert">
                    {error}
                  </p>
                ) : null}

                <div className="content-children" hidden={!isOpen} id={childrenId}>
                  {row.children.length > 0 ? (
                    renderRows(row.children, key, row.groupId)
                  ) : (
                    <p className="content-empty">Esta zona todavía no tiene elementos.</p>
                  )}
                </div>
              </li>
            );
          }

          const key = `${parentKey}/m:${row.moduleId}`;
          const moveError = errorFor(`move:${key}`);
          const removeError = errorFor(`remove:${key}`);
          const moveEditor = editor?.kind === "moveItem" && editor.rowKey === key ? editor : null;
          const isRemoving = pendingKey === `remove:${key}`;
          const removeErrorId = `${focusSlug(key)}-remove-error`;
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
                  aria-busy={isRemoving ? true : undefined}
                  aria-describedby={removeError ? removeErrorId : undefined}
                  aria-disabled={isBusy ? true : undefined}
                  aria-label={isRemoving ? `Quitando ${row.name}` : `Quitar una unidad de ${row.name}`}
                  className="secondary-button content-remove"
                  onClick={() => removeOne(key, row)}
                  type="button"
                >
                  {isRemoving ? "Quitando…" : "Quitar uno"}
                </button>
              </div>

              {removeError ? (
                <p className="auth-error" id={removeErrorId} role="alert">
                  {removeError}
                </p>
              ) : null}

              {zones.length > 0 ? (
                moveEditor ? (
                  <form
                    className="zone-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      submitMoveItem(moveEditor.itemId, key);
                    }}
                  >
                    <div className="zone-field">
                      <label htmlFor={`move-${focusSlug(key)}`}>Mover {row.name} a</label>
                      <select
                        autoFocus
                        id={`move-${focusSlug(key)}`}
                        onChange={(event) => setDraftParent(event.target.value)}
                        value={draftParent}
                      >
                        <option value="">Sin zona (raíz)</option>
                        {zones.map((zone) => (
                          <option key={zone.groupId} value={zone.groupId}>
                            {zoneLabel(zone)}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="zone-editor-actions">
                      <button
                        aria-disabled={isBusy ? true : undefined}
                        className="secondary-button"
                        type="submit"
                      >
                        Mover aquí
                      </button>
                      <button
                        className="text-button"
                        onClick={() => closeEditor(`item-${focusSlug(key)}`)}
                        type="button"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="zone-actions">
                    <button
                      className="text-button"
                      onClick={() => openMoveItem(row.itemIds[row.itemIds.length - 1], key, parentGroupId)}
                      ref={focusRef(`item-${focusSlug(key)}`)}
                      type="button"
                    >
                      Mover de zona
                    </button>
                  </div>
                )
              ) : null}

              {moveError ? (
                <p className="auth-error" id={`move-${focusSlug(key)}-error`} role="alert">
                  {moveError}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section aria-labelledby="package-contents-title" className="configurator-card package-contents">
      {/* Destino de foco cuando desaparece la fila con la que se interactuaba. */}
      <h2 className="section-title page-heading" id="package-contents-title" ref={headingRef} tabIndex={-1}>
        Contenido del evento
      </h2>
      <p className="content-hint">Los subtotales son informativos; el total confirmado lo calcula Presupuesto.</p>

      <NewZoneForm
        allowParentSelect
        client={groups}
        disabled={isBusy}
        expectedVersion={version}
        onCreated={handleZoneCreated}
        packageId={packageId}
        zones={zones}
      />

      {rows.length === 0 ? (
        <p className="content-empty">Tu evento todavía no tiene elementos. Agrégalos desde el catálogo.</p>
      ) : (
        renderRows(rows, "root", null)
      )}

      <p aria-live="polite" className="visually-hidden" role="status">
        {announcement}
      </p>
    </section>
  );
}
